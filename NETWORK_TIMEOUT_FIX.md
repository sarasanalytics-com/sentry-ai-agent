# Network Timeout Fix

## Issue Summary

**Error**: `ETIMEDOUT` when creating ClickUp tickets
**Impact**: Agent crashed and circuit breaker opened
**Root Cause**: No timeout configured on HTTP requests to ClickUp API

## What Happened

```
[ERROR] MCP action failed {"serverName":"clickup","action":"create_task","error":{"code":"ETIMEDOUT"}}
[ERROR] Agent processing failed
[WARN] Circuit breaker opened {"reason":"High failure rate"}
```

The agent tried to create a ClickUp ticket but the HTTP request to ClickUp API timed out. Since no timeout was configured, the request hung indefinitely until the network layer gave up. This caused:

1. **Agent crash** - The error propagated up and killed the processing
2. **Circuit breaker activation** - Multiple failures triggered the circuit breaker
3. **No Slack notification** - Agent crashed before sending notification

## Root Causes

### 1. No Timeout Configuration

**Before:**
```typescript
this.client = axios.create({
  baseURL: 'https://api.clickup.com/api/v2',
  headers: { ... },
  // No timeout configured - waits forever!
});
```

### 2. No Retry Logic

Single network hiccup = complete failure

### 3. No Error Handling

ClickUp failure crashed the entire agent

## Fixes Applied

### 1. ClickUp MCP Server (`src/mcp/clickup.ts`)

**Added timeout:**
```typescript
timeout: 30000, // 30 second timeout
```

**Added retry logic with exponential backoff:**
```typescript
this.client.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Retry on network errors or 5xx server errors
    const shouldRetry = 
      (error.code === 'ETIMEDOUT' || 
       error.code === 'ECONNRESET' ||
       error.code === 'ENOTFOUND' ||
       (error.response && error.response.status >= 500)) &&
      config.retry < 3;
    
    if (shouldRetry) {
      config.retry += 1;
      const delay = Math.min(1000 * Math.pow(2, config.retry), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.client.request(config);
    }
    
    throw error;
  }
);
```

**Retry strategy:**
- Attempt 1: Immediate
- Attempt 2: Wait 2 seconds
- Attempt 3: Wait 4 seconds
- Attempt 4: Wait 5 seconds (max)
- Total: Up to 4 attempts over ~11 seconds

### 2. Action Executor (`src/agent/executor.ts`)

**Added graceful error handling:**
```typescript
try {
  const ticket = await mcpRegistry.execute('clickup', 'create_task', { ... });
  return ticket;
} catch (err) {
  logger.error('Failed to create ClickUp ticket', { error: err });
  
  // Return fallback ticket object so agent can continue
  return {
    id: 'failed',
    url: `https://saras-analytics.sentry.io/issues/${error.id}/`,
  };
}
```

**Benefits:**
- Agent continues processing even if ClickUp fails
- Slack notification still sent
- Sentry comment still added
- No crash, no circuit breaker

### 3. Slack MCP Server (`src/mcp/slack.ts`)

**Added timeout for webhooks:**
```typescript
await axios.post(this.webhookUrl, {
  text: params.text,
  blocks: params.blocks,
}, {
  timeout: 10000, // 10 second timeout
});
```

## Error Handling Flow

### Before (Crash)
```
ClickUp timeout → Error thrown → Agent crash → Circuit breaker opens
```

### After (Graceful)
```
ClickUp timeout → Retry 3 times → Still fails → Log error → Return fallback → Continue processing → Send Slack notification
```

## Retry Behavior

### Network Errors (Retried)
- `ETIMEDOUT` - Connection timeout
- `ECONNRESET` - Connection reset
- `ENOTFOUND` - DNS resolution failed
- `5xx` - Server errors

### Client Errors (Not Retried)
- `4xx` - Bad request, auth errors, etc.
- These indicate a problem with our request, not transient network issues

## Logging

Watch for these new log messages:

**Retry in progress:**
```
[WARN] Retrying ClickUp request {
  "attempt": 2,
  "delay": 2000,
  "error": "ETIMEDOUT"
}
```

**ClickUp failure (graceful):**
```
[ERROR] Failed to create ClickUp ticket {
  "error": "ETIMEDOUT",
  "errorType": "error",
  "fingerprint": "7330539917"
}
```

**Agent continues:**
```
[INFO] Slack notification sent {"type": "ticket_only"}
```

## Testing

### Test Network Resilience

1. **Simulate timeout** (temporarily set very low timeout):
   ```typescript
   timeout: 100, // 100ms - will timeout
   ```

2. **Process an issue**:
   ```bash
   curl -X POST http://localhost:3000/api/process-issue \
     -H "Content-Type: application/json" \
     -d '{"url":"https://saras-analytics.sentry.io/issues/7330539917/"}'
   ```

3. **Expected behavior**:
   - Retries 3 times
   - Logs retry attempts
   - Falls back gracefully
   - Sends Slack notification
   - No crash

### Verify Normal Operation

With normal timeout (30s), ClickUp should work fine:
- Ticket created successfully
- Slack notification sent
- Sentry comment added

## Configuration

### Timeouts

| Service | Timeout | Reason |
|---------|---------|--------|
| ClickUp | 30s | API can be slow, needs time for retries |
| Slack | 10s | Webhooks are fast, should respond quickly |
| GitHub | Default | Uses Octokit defaults (~60s) |
| Sentry | Default | Uses axios defaults |

### Retry Policy

- **Max retries**: 3
- **Backoff**: Exponential (2s, 4s, 5s)
- **Total time**: ~11 seconds max
- **Errors retried**: Network errors and 5xx only

## Benefits

### 1. **Resilience**
- Handles transient network issues
- Automatic retry with backoff
- Graceful degradation

### 2. **Reliability**
- Agent doesn't crash on external API failures
- Circuit breaker stays closed
- Processing continues

### 3. **Observability**
- Clear logging of retries
- Error details captured
- Fallback behavior logged

### 4. **User Experience**
- Slack notifications always sent (even if ClickUp fails)
- Sentry issues still tracked
- No silent failures

## Future Enhancements

### 1. **Configurable Timeouts**
Add to `.env`:
```bash
CLICKUP_TIMEOUT=30000
SLACK_TIMEOUT=10000
MAX_RETRIES=3
```

### 2. **Circuit Breaker Per Service**
Separate circuit breakers for ClickUp, Slack, GitHub

### 3. **Metrics**
Track:
- Retry rates
- Timeout frequencies
- Success/failure rates per service

### 4. **Fallback Strategies**
- Queue failed tickets for later retry
- Store in database if ClickUp unavailable
- Email notification if Slack fails

## Summary

**Problem**: Network timeouts crashed the agent

**Solution**: 
- ✅ Added 30s timeout to ClickUp requests
- ✅ Added retry logic with exponential backoff
- ✅ Added graceful error handling
- ✅ Added 10s timeout to Slack webhooks
- ✅ Agent continues processing even if external APIs fail

**Result**: Resilient, reliable agent that handles network issues gracefully! 🚀

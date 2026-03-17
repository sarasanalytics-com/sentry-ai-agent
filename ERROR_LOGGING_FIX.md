# Error Logging Fix

## What Happened

```
[INFO] Mapped minified error to source file {"minifiedFile":"main.8250bcdd8faf9a17.js","sourceFile":"src/app/account/services/subscription-business.service.ts","sourceLine":819}
[INFO] Analyzing error with AI {"fingerprint":"7329347868"}
[ERROR] Agent processing failed {"fingerprint":"7329347868","error":{}}
[WARN] Circuit breaker opened {"reason":"High failure rate"}
```

**The Problem:**
1. ✅ Code search worked - successfully mapped minified file to source
2. ✅ AI analysis started
3. ❌ Agent crashed with **empty error object** `{"error":{}}`
4. ❌ Circuit breaker opened due to failure

## Root Cause

The error object was **not serializing properly** in the logs. When JavaScript errors are logged with JSON.stringify (which Winston logger uses), circular references or non-enumerable properties result in empty objects `{}`.

This made it impossible to diagnose what actually went wrong.

## Likely Actual Errors

Based on the flow, the crash likely happened due to one of:

### 1. **Prompt Too Large**
With breadcrumbs, request data, and file content, the prompt may exceed token limits:
- OpenAI GPT-4: ~8K tokens input
- Claude Sonnet 4.5: ~200K tokens input

If using OpenAI and the prompt is too large, it would fail.

### 2. **AI Response Parsing Error**
The AI might return:
- Malformed JSON
- No JSON at all
- JSON with unexpected structure

### 3. **Breadcrumbs Data Issue**
The new breadcrumbs extraction might have:
- Circular references
- Undefined values causing crashes
- Invalid data types

## Fixes Applied

### 1. Better Error Serialization

**File**: `src/agent/analyzer.ts`

**Before:**
```typescript
catch (error) {
  logger.error('AI analysis failed', { error });
  throw error;
}
```

**After:**
```typescript
catch (error) {
  logger.error('AI analysis failed', { 
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : error,
    errorString: String(error),
  });
  throw error;
}
```

Now we'll see:
```json
{
  "error": {
    "message": "Prompt exceeds maximum token limit",
    "stack": "Error: Prompt exceeds...\n  at AIAnalyzer.analyzeError...",
    "name": "Error"
  },
  "errorString": "Error: Prompt exceeds maximum token limit"
}
```

### 2. Added Prompt Size Logging

**File**: `src/agent/analyzer.ts`

```typescript
logger.debug('AI prompt built', {
  promptLength: prompt.length,
  hasBreadcrumbs: !!context.error.breadcrumbs,
  breadcrumbCount: context.error.breadcrumbs?.length || 0,
});
```

This will show:
```
[DEBUG] AI prompt built {
  "promptLength": 15234,
  "hasBreadcrumbs": true,
  "breadcrumbCount": 47
}
```

### 3. Added Response Parsing Logging

**File**: `src/agent/analyzer.ts`

```typescript
logger.debug('Parsing AI response', {
  responseLength: response.length,
  responsePreview: response.substring(0, 200),
});
```

This will show if AI returned valid JSON or garbage.

### 4. Improved Core Error Logging

**File**: `src/agent/core.ts`

Same pattern - serialize error properly:
```typescript
logger.error('Agent processing failed', { 
  fingerprint: error.fingerprint, 
  error: err instanceof Error ? {
    message: err.message,
    stack: err.stack,
    name: err.name,
  } : err,
  errorString: String(err),
});
```

## Testing the Fix

Restart the agent and process the same issue:

```bash
curl -X POST http://localhost:3000/api/process-issue \
  -H "Content-Type: application/json" \
  -d '{"url":"https://saras-analytics.sentry.io/issues/7329347868/"}'
```

Now you'll see **actual error details** instead of `{"error":{}}`:

### Example: Prompt Too Large
```
[DEBUG] AI prompt built {"promptLength": 25000, "breadcrumbCount": 50}
[ERROR] AI analysis failed {
  "error": {
    "message": "This model's maximum context length is 8192 tokens",
    "name": "Error"
  }
}
```

### Example: JSON Parsing Error
```
[DEBUG] Parsing AI response {"responseLength": 500, "responsePreview": "I apologize, but I cannot..."}
[ERROR] No JSON found in AI response {"response": "I apologize, but I cannot..."}
```

### Example: Breadcrumbs Issue
```
[ERROR] AI analysis failed {
  "error": {
    "message": "Cannot read property 'data' of undefined",
    "stack": "TypeError: Cannot read property 'data' of undefined\n  at buildPrompt..."
  }
}
```

## Potential Solutions (Based on Actual Error)

### If Prompt Too Large

**Option 1: Limit Breadcrumbs**
```typescript
// Only last 5 breadcrumbs instead of 10
const recentBreadcrumbs = error.breadcrumbs.slice(-5);
```

**Option 2: Summarize Breadcrumbs**
```typescript
// Just categories and timestamps, not full data
breadcrumbs.forEach(b => {
  prompt += `${idx + 1}. [${b.category}] ${b.type}\n`;
  // Skip b.data to save tokens
});
```

**Option 3: Switch to Claude**
Claude Sonnet 4.5 has 200K token context vs OpenAI's 8K.

### If JSON Parsing Error

Add fallback parsing:
```typescript
// Try to extract JSON even if wrapped in markdown
const jsonMatch = response.match(/```json\s*(\{[\s\S]*\})\s*```/) || 
                  response.match(/\{[\s\S]*\}/);
```

### If Breadcrumbs Data Issue

Add null checks:
```typescript
if (error.breadcrumbs && Array.isArray(error.breadcrumbs)) {
  const recentBreadcrumbs = error.breadcrumbs
    .filter(b => b && b.category) // Filter out invalid breadcrumbs
    .slice(-10);
}
```

## Next Steps

1. **Run the test again** and check logs for actual error
2. **Look for these new log messages**:
   - `[DEBUG] AI prompt built` - Check prompt size
   - `[DEBUG] Parsing AI response` - Check if AI returned valid JSON
   - `[ERROR] AI analysis failed` - Now shows actual error message
3. **Apply appropriate fix** based on actual error

## Summary

**Problem**: Empty error objects made debugging impossible

**Fix**: Proper error serialization with message, stack, and name

**Result**: You'll now see **actual error details** to diagnose and fix the issue

The agent successfully mapped the minified file to source (which is great!), but then crashed during AI analysis. With proper error logging, we'll know exactly why and can fix it. 🔍

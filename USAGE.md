# Sentry AI Agent - Usage Guide

## Quick Start

### 1. Configure Your Environment

Edit `.env` with your credentials:

```bash
# Required
SENTRY_WEBHOOK_SECRET=your_webhook_secret
OPENAI_API_KEY=sk-your-openai-key
GITHUB_TOKEN=ghp_your-github-token
GITHUB_OWNER=your-org
GITHUB_DEFAULT_REPO=your-repo

# Optional
CLICKUP_API_TOKEN=pk_your-clickup-token
SLACK_BOT_TOKEN=xoxb-your-slack-token

# Optional: Sentry API for bidirectional communication
SENTRY_AUTH_TOKEN=sntrys_your-auth-token
```

> **New!** Enable bidirectional Sentry communication by setting `SENTRY_AUTH_TOKEN`. See [SENTRY_MCP_INTEGRATION.md](./SENTRY_MCP_INTEGRATION.md) for details.

### 2. Start the Server

```bash
npm run dev
```

The server will start on port 3000 (or your configured PORT).

### 3. Configure Sentry Webhook

1. Go to your Sentry project settings
2. Navigate to **Integrations** → **Webhooks**
3. Add a new webhook with URL: `http://your-server:3000/webhook/sentry`
4. Set the webhook secret to match `SENTRY_WEBHOOK_SECRET` in your `.env`
5. Enable events: `issue.created`, `issue.reopened`

## How It Works

### The Perceive-Think-Act-Learn Loop

1. **Perceive**: Webhook receives Sentry error (+ enriches with Sentry API)
2. **Think**: AI analyzes error and suggests fix
3. **Act**: Creates PR, ticket, or suggestion based on confidence
4. **Learn**: Records outcomes for future improvements (+ updates Sentry issue)

### Bidirectional Sentry Communication

When `SENTRY_AUTH_TOKEN` is configured, the agent:
- ✅ Adds comments to Sentry issues when tickets/PRs are created
- ✅ Tags issues with AI processing metadata
- ✅ Enriches context with issue occurrence counts
- ✅ Can auto-resolve issues when PRs are merged

See [SENTRY_MCP_INTEGRATION.md](./SENTRY_MCP_INTEGRATION.md) for full details.

### Operational Modes

Configure via `OPERATIONAL_MODE` in `.env`:

- **`ticket-only`**: Only creates ClickUp tickets (safest)
- **`suggestion`**: Creates tickets + Slack suggestions
- **`pr-creation`**: Automatically creates PRs (requires high confidence)

### Safety Constraints

The agent has multiple safety layers:

#### 1. Confidence Thresholds
```bash
SAFETY_MIN_CONFIDENCE_FOR_PR=0.85      # High bar for auto-PRs
SAFETY_MIN_CONFIDENCE_FOR_SUGGESTION=0.60
```

#### 2. File Restrictions
```bash
SAFETY_MAX_FILES_MODIFIED=2
SAFETY_MAX_LINES_CHANGED=50
SAFETY_ALLOWED_EXTENSIONS=.ts,.tsx,.js,.jsx
SAFETY_FORBIDDEN_FILES=package.json,.env
```

#### 3. Rate Limiting
```bash
SAFETY_MAX_PRS_PER_HOUR=5
SAFETY_MAX_PRS_PER_DAY=20
SAFETY_MAX_ERRORS_PER_MINUTE=10
```

#### 4. Circuit Breaker
Automatically stops processing if:
- Failure rate exceeds 50%
- Validation failure rate exceeds 70%
- Cooldown: 60 minutes (configurable)

## API Endpoints

### Health Check
```bash
GET /health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": 1234567890,
  "version": "1.0.0",
  "checks": {
    "database": true,
    "configuration": true,
    "github": true
  },
  "uptime": 3600000
}
```

### Sentry Webhook
```bash
POST /webhook/sentry
```

Receives Sentry error events and processes them automatically.

## Monitoring

### View Logs
```bash
# Development
npm run dev

# Production
npm start | tee -a logs/agent.log
```

### Database Queries

The SQLite database is at `./data/sentry-ai-agent.db`:

```sql
-- View recent errors
SELECT * FROM errors ORDER BY last_seen DESC LIMIT 10;

-- View fix attempts
SELECT * FROM fix_attempts ORDER BY timestamp DESC LIMIT 10;

-- View audit logs
SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10;
```

### Metrics

Access metrics programmatically:

```typescript
import { metricsCollector } from './src/utils/metrics';

const metrics = metricsCollector.getMetrics();
console.log(metrics);
```

## Configuration Examples

### Conservative (Recommended for Start)
```bash
OPERATIONAL_MODE=ticket-only
FEATURE_AUTO_PR_CREATION=false
SAFETY_MIN_CONFIDENCE_FOR_PR=0.90
SAFETY_MAX_FILES_MODIFIED=1
SAFETY_MAX_LINES_CHANGED=25
```

### Moderate
```bash
OPERATIONAL_MODE=suggestion
FEATURE_AUTO_PR_CREATION=false
SAFETY_MIN_CONFIDENCE_FOR_PR=0.85
SAFETY_MAX_FILES_MODIFIED=2
SAFETY_MAX_LINES_CHANGED=50
```

### Aggressive (Use with Caution)
```bash
OPERATIONAL_MODE=pr-creation
FEATURE_AUTO_PR_CREATION=true
SAFETY_MIN_CONFIDENCE_FOR_PR=0.75
SAFETY_MAX_FILES_MODIFIED=3
SAFETY_MAX_LINES_CHANGED=100
```

## Troubleshooting

### Agent Not Processing Errors

1. Check webhook configuration in Sentry
2. Verify `SENTRY_WEBHOOK_SECRET` matches
3. Check logs for errors: `npm run dev`
4. Verify circuit breaker is not open: check `/health` endpoint

### PRs Not Being Created

1. Check `FEATURE_AUTO_PR_CREATION=true`
2. Verify `OPERATIONAL_MODE=pr-creation`
3. Check confidence threshold: `SAFETY_MIN_CONFIDENCE_FOR_PR`
4. Verify rate limits not exceeded
5. Check GitHub token permissions

### Low Confidence Scores

The AI may give low confidence if:
- Error is complex or ambiguous
- Insufficient context in stack trace
- File content is missing or incomplete
- No similar errors in history

Solutions:
- Ensure Sentry captures full stack traces
- Add source maps for better file resolution
- Lower `SAFETY_MIN_CONFIDENCE_FOR_SUGGESTION` to see AI reasoning

### Circuit Breaker Open

Reset the circuit breaker:
```typescript
import { circuitBreaker } from './src/safety/circuit-breaker';
circuitBreaker.reset();
```

Or wait for cooldown period (default: 60 minutes).

## Best Practices

1. **Start Conservative**: Begin with `ticket-only` mode
2. **Monitor Closely**: Watch first 10-20 errors carefully
3. **Tune Confidence**: Adjust thresholds based on your codebase
4. **Review PRs**: Always enable `PR_REQUIRE_HUMAN_REVIEW=true`
5. **Use Drafts**: Keep `PR_ALWAYS_DRAFT=true` initially
6. **Enable Validation**: Set `VALIDATION_ENABLED=true` for safety

## Advanced Features

### Custom Fix Types

Add custom fix types to `SAFETY_ALLOWED_FIX_TYPES`:
```bash
SAFETY_ALLOWED_FIX_TYPES=null-check,optional-chaining,type-guard,undefined-check,custom-fix
```

### Validation Modes

**Local Validation** (faster):
```bash
VALIDATION_MODE=local
VALIDATION_REQUIRE_TESTS_PASS=true
VALIDATION_REQUIRE_LINT_PASS=true
```

**CI Validation** (more reliable):
```bash
VALIDATION_MODE=ci
VALIDATION_CI_WORKFLOW=ci.yml
```

### Audit Logging

All MCP actions are logged when enabled:
```bash
FEATURE_AUDIT_LOGGING=true
```

Query audit logs:
```sql
SELECT tool, action, status, duration 
FROM audit_logs 
WHERE status = 'failed' 
ORDER BY timestamp DESC;
```

## Production Deployment

### Environment Variables
Ensure all required variables are set in production.

### Database Backup
```bash
# Backup database
cp ./data/sentry-ai-agent.db ./backups/backup-$(date +%Y%m%d).db
```

### Process Management
Use PM2 or similar:
```bash
npm install -g pm2
pm2 start npm --name "sentry-ai-agent" -- start
pm2 save
```

### Monitoring
- Set up alerts for circuit breaker state
- Monitor rate limit status
- Track success/failure rates
- Watch LLM costs

## Support

For issues or questions:
1. Check logs: `npm run dev`
2. Review configuration: `.env`
3. Check health endpoint: `GET /health`
4. Review database: `./data/sentry-ai-agent.db`

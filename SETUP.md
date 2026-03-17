# Sentry AI Agent - Setup Guide

## Project Created ✓

A highly configurable AI-powered Sentry error resolution system has been initialized.

### What's Been Created

```
sentry-ai-agent/
├── package.json              # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── .env.example             # Environment variable template (100+ config options)
├── .gitignore               # Git ignore rules
├── README.md                # Comprehensive documentation
├── SETUP.md                 # This file
└── src/
    ├── config/
    │   ├── schema.ts        # Zod validation schema for all config
    │   └── index.ts         # Config loader with validation
    └── types/
        └── index.ts         # TypeScript type definitions

```

### Configuration System ✓

The project uses a **highly configurable** architecture with 100+ environment variables organized into:

1. **Core Settings**: Environment, port, logging
2. **Sentry Configuration**: Webhook secrets, DSN
3. **AI/LLM Configuration**: OpenAI/Anthropic, models, budgets
4. **GitHub Configuration**: Tokens, app credentials, repos
5. **ClickUp Configuration**: API tokens, workspace IDs
6. **Slack Configuration**: Bot tokens, channels
7. **Safety Constraints**: File limits, confidence thresholds, rate limits
8. **Code Validation**: Test/lint/typecheck requirements
9. **Circuit Breaker**: Failure thresholds, cooldowns
10. **Feature Flags**: Enable/disable specific features
11. **Operational Modes**: ticket-only, suggestion, pr-creation
12. **Advanced Settings**: Timezone, retries, PR settings
13. **Monitoring**: Metrics, health checks

### Key Features

✅ **Zod Validation**: All configuration validated at startup
✅ **Type Safety**: Full TypeScript support with strict types
✅ **Flexible Modes**: Switch between ticket-only, suggestion, or PR creation
✅ **Safety First**: Multiple layers of constraints and validation
✅ **Feature Flags**: Enable/disable features without code changes
✅ **Environment-Based**: Different configs for dev/staging/production

## Next Steps

### 1. Install Dependencies

```bash
cd /Users/saras/Documents/workspace/sentry-ai-agent
npm install
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your credentials
nano .env
```

**Minimum Required Configuration:**
```bash
# Required
SENTRY_WEBHOOK_SECRET=your_secret_here
OPENAI_API_KEY=sk-your-key-here
GITHUB_TOKEN=ghp_your-token-here
GITHUB_OWNER=your-org
GITHUB_DEFAULT_REPO=your-repo

# Optional but recommended
CLICKUP_API_TOKEN=pk_your-token-here
SLACK_BOT_TOKEN=xoxb-your-token-here
```

### 3. What to Build Next

The foundation is ready. Here's what we need to implement:

**Phase 1: Core Infrastructure** (Week 1-2)
- [ ] Webhook handler (`src/api/webhook.ts`)
- [ ] Safety validator (`src/safety/validator.ts`)
- [ ] Database client (`src/database/client.ts`)
- [ ] Logger utility (`src/utils/logger.ts`)
- [ ] Health check endpoint (`src/api/health.ts`)

**Phase 2: MCP Servers** (Week 2-3)
- [ ] MCP Registry (`src/mcp/registry.ts`)
- [ ] GitHub MCP Server (`src/mcp/github.ts`)
- [ ] ClickUp MCP Server (`src/mcp/clickup.ts`)
- [ ] Slack MCP Server (`src/mcp/slack.ts`)

**Phase 3: AI Agent Core** (Week 3-4)
- [ ] Context gatherer (`src/agent/context-gatherer.ts`)
- [ ] AI analyzer (`src/agent/analyzer.ts`)
- [ ] Action executor (`src/agent/executor.ts`)
- [ ] Agent core (`src/agent/core.ts`)

**Phase 4: Code Validation** (Week 4-5)
- [ ] Local validator (`src/validation/local-validator.ts`)
- [ ] CI validator (`src/validation/ci-validator.ts`)
- [ ] Code validator (`src/validation/code-validator.ts`)

**Phase 5: Safety & Monitoring** (Week 5-6)
- [ ] Circuit breaker (`src/safety/circuit-breaker.ts`)
- [ ] Rate limiter (`src/safety/rate-limiter.ts`)
- [ ] Audit logger (`src/database/audit.ts`)
- [ ] Metrics collector (`src/utils/metrics.ts`)

## Configuration Examples

### Development Mode (Ticket-Only)
```bash
OPERATIONAL_MODE=ticket-only
FEATURE_AUTO_PR_CREATION=false
VALIDATION_ENABLED=false
LOG_LEVEL=debug
```

### Staging Mode (Suggestions)
```bash
OPERATIONAL_MODE=suggestion
FEATURE_AUTO_PR_CREATION=false
VALIDATION_ENABLED=true
SAFETY_MIN_CONFIDENCE_FOR_SUGGESTION=0.70
```

### Production Mode (Full Auto)
```bash
OPERATIONAL_MODE=pr-creation
FEATURE_AUTO_PR_CREATION=true
VALIDATION_ENABLED=true
SAFETY_MIN_CONFIDENCE_FOR_PR=0.85
CIRCUIT_BREAKER_ENABLED=true
```

### Conservative Safety Settings
```bash
SAFETY_MAX_FILES_MODIFIED=1
SAFETY_MAX_LINES_CHANGED=25
SAFETY_MIN_CONFIDENCE_FOR_PR=0.90
SAFETY_MAX_PRS_PER_DAY=10
```

### Aggressive Settings (Use with caution)
```bash
SAFETY_MAX_FILES_MODIFIED=5
SAFETY_MAX_LINES_CHANGED=100
SAFETY_MIN_CONFIDENCE_FOR_PR=0.75
SAFETY_MAX_PRS_PER_DAY=50
```

## Testing Configuration

Test your configuration:

```bash
# This will validate all environment variables
npm run dev
```

If configuration is invalid, you'll see detailed error messages:

```
❌ Configuration validation failed:
{
  sentry: {
    webhookSecret: 'Required'
  },
  github: {
    token: 'Required'
  }
}
```

## Architecture Decisions

### Why Zod for Validation?
- Runtime validation of environment variables
- Type-safe configuration
- Clear error messages
- Default values support

### Why Configurable?
- Different environments (dev/staging/prod)
- Different risk tolerances
- Easy feature toggling
- Gradual rollout capability

### Why Feature Flags?
- Enable/disable features without deployment
- A/B testing
- Emergency kill switches
- Gradual feature rollout

## Ready to Build?

The project structure is set up with:
- ✅ Configuration system with validation
- ✅ Type definitions
- ✅ Documentation
- ✅ Git setup

**Next**: Choose what to build first:
1. **Webhook Handler** - Start receiving Sentry errors
2. **MCP Servers** - Connect to GitHub/ClickUp/Slack
3. **AI Agent Core** - Implement the Perceive-Think-Act-Learn loop
4. **Code Validation** - Ensure quality before PRs

Let me know which component you'd like to build first!

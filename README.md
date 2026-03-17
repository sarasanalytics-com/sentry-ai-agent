# Sentry AI Agent

AI-powered error resolution system that automatically analyzes Sentry errors, generates fixes, validates code, and creates pull requests.

## Features

- 🤖 **AI-Powered Analysis**: Uses GPT-4/Claude to analyze errors and generate fixes
- ✅ **Code Validation Pipeline**: Validates all fixes (tests, lint, type check) before creating PRs
- 🔒 **Multi-Layer Safety**: 8 layers of validation to ensure quality and safety
- 🎯 **Configurable**: Highly configurable via environment variables
- 📊 **Audit Logging**: Comprehensive logging of all AI actions
- 🔄 **MCP Integration**: Modular integration with GitHub, ClickUp, and Slack

## Architecture

```
Sentry Error → Webhook → Safety Validator → AI Analysis
                                                ↓
                                    Create Branch & Apply Fix
                                                ↓
                                    Code Validation Pipeline
                                    - Tests ✓
                                    - Lint ✓
                                    - Type Check ✓
                                                ↓
                                    All Pass? → Create PR
                                    Any Fail? → Delete branch, create ticket
```

## Quick Start

### Prerequisites

- Node.js 20+ or Bun 1.0+
- GitHub account with repository access
- OpenAI API key or Anthropic API key
- ClickUp account (optional)
- Slack workspace (optional)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd sentry-ai-agent

# Install dependencies
npm install
# or
bun install

# Copy environment configuration
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Configuration

Edit `.env` file with your settings:

```bash
# Required
OPENAI_API_KEY=sk-your-key-here
GITHUB_TOKEN=ghp_your-token-here
SENTRY_WEBHOOK_SECRET=your-secret-here

# Optional but recommended
CLICKUP_API_TOKEN=pk_your-token-here
SLACK_BOT_TOKEN=xoxb-your-token-here
```

### Running

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run build
npm start
```

### Manual Issue Processing

Process Sentry issues manually using the CLI tools:

**Option 1: Using npm script (recommended)**
```bash
# Just pass the issue number
npm run process-issue 7269288997

# Or use the full URL
npm run process-issue https://saras-analytics.sentry.io/issues/7269288997/
```

**Option 2: Using bash script**
```bash
# Just pass the issue number
./process-issue.sh 7269288997

# Or use the full URL
./process-issue.sh https://saras-analytics.sentry.io/issues/7269288997/
```

**Features:**
- ✅ Simple, user-friendly interface - just pass the issue number!
- ✅ Automatic URL building from issue number
- ✅ URL validation with helpful error messages
- ✅ Colored output for better readability
- ✅ Automatic JSON formatting
- ✅ Custom API endpoint via `SENTRY_AGENT_API` environment variable
- ✅ Custom Sentry base URL via `SENTRY_BASE_URL` environment variable

**Examples:**
```bash
# Simplest usage - just the issue number
npm run process-issue 7269288997

# Use custom Sentry organization
SENTRY_BASE_URL=https://my-org.sentry.io/issues npm run process-issue 7269288997

# Use custom API endpoint
SENTRY_AGENT_API=http://production-server:3000 npm run process-issue 7269288997
```

## Configuration Guide

### Safety Constraints

Control what the AI can modify:

```bash
SAFETY_MAX_FILES_MODIFIED=2          # Max files per fix
SAFETY_MAX_LINES_CHANGED=50          # Max lines per fix
SAFETY_MIN_CONFIDENCE_FOR_PR=0.85    # Min confidence to create PR
SAFETY_ALLOWED_EXTENSIONS=.ts,.tsx,.js,.jsx
```

### Code Validation

Configure validation requirements:

```bash
VALIDATION_ENABLED=true
VALIDATION_REQUIRE_TESTS_PASS=true
VALIDATION_REQUIRE_LINT_PASS=true
VALIDATION_REQUIRE_TYPE_CHECK_PASS=true
VALIDATION_MODE=local                 # 'local' or 'ci'
```

### Operational Modes

Choose how the system operates:

- **`ticket-only`**: Creates tickets only, no PRs
- **`suggestion`**: Creates tickets with AI suggestions
- **`pr-creation`**: Creates validated PRs (default)

```bash
OPERATIONAL_MODE=pr-creation
```

### Feature Flags

Enable/disable features:

```bash
FEATURE_AUTO_PR_CREATION=true
FEATURE_TICKET_CREATION=true
FEATURE_SLACK_NOTIFICATIONS=true
FEATURE_AUDIT_LOGGING=true
```

## Project Structure

```
sentry-ai-agent/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── config/
│   │   ├── index.ts            # Configuration loader
│   │   └── schema.ts           # Configuration validation
│   ├── api/
│   │   ├── webhook.ts          # Sentry webhook handler
│   │   └── health.ts           # Health check endpoint
│   ├── agent/
│   │   ├── core.ts             # AI Agent core (Perceive-Think-Act-Learn)
│   │   ├── context-gatherer.ts # Context gathering
│   │   ├── analyzer.ts         # AI analysis
│   │   └── executor.ts         # Action execution
│   ├── validation/
│   │   ├── code-validator.ts   # Code validation pipeline
│   │   ├── local-validator.ts  # Local validation
│   │   └── ci-validator.ts     # CI-based validation
│   ├── mcp/
│   │   ├── registry.ts         # MCP tool registry
│   │   ├── github.ts           # GitHub MCP server
│   │   ├── clickup.ts          # ClickUp MCP server
│   │   └── slack.ts            # Slack MCP server
│   ├── safety/
│   │   ├── validator.ts        # Safety constraint validator
│   │   ├── circuit-breaker.ts  # Circuit breaker
│   │   └── rate-limiter.ts     # Rate limiting
│   ├── database/
│   │   ├── client.ts           # SQLite client
│   │   └── schema.ts           # Database schema
│   ├── utils/
│   │   ├── logger.ts           # Logging utility
│   │   └── errors.ts           # Error handling
│   └── types/
│       └── index.ts            # TypeScript types
├── tests/
│   ├── unit/
│   └── integration/
├── data/                        # SQLite database (gitignored)
├── .env.example                 # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

### 1. Webhook Reception

Sentry sends error webhook → System validates signature → Returns 200 OK immediately

### 2. Safety Validation

- Rate limiting check
- Duplicate detection
- Basic validation

### 3. AI Analysis

- Gathers error context from GitHub
- Sends to LLM (GPT-4/Claude)
- Receives fix suggestion with confidence score

### 4. Safety Constraints

- Checks file count, line count
- Validates confidence threshold
- Checks fix type whitelist

### 5. Code Validation

- Creates GitHub branch
- Applies fix
- Runs tests, lint, type check
- Validates all pass

### 6. Action Execution

**If validation passes:**
- Creates draft PR
- Creates ClickUp ticket
- Sends Slack notification

**If validation fails:**
- Deletes branch
- Creates ticket with failure details
- Notifies developer

### 7. Learning

- Tracks PR outcomes
- Updates confidence model
- Records metrics

## Safety Features

### Multi-Layer Validation

1. **Webhook Validation**: Signature verification
2. **Rate Limiting**: Max 5 PRs/hour, 20/day
3. **Duplicate Detection**: Skip already-processed errors
4. **AI Confidence**: Min 85% confidence for PR
5. **Safety Constraints**: Max 2 files, 50 lines
6. **Code Validation**: Tests, lint, type check
7. **Human Review**: All PRs are drafts
8. **Circuit Breaker**: Auto-disable on quality drop

### Circuit Breaker

Automatically disables PR creation if:
- Validation failure rate > 70%
- PR rejection rate > 50%

Cooldown period: 1 hour

## API Endpoints

### Webhook

```
POST /webhook/sentry
Content-Type: application/json
X-Sentry-Hook-Signature: <signature>

{
  "event": { ... },
  "error": { ... }
}
```

### Health Check

```
GET /health

Response:
{
  "status": "healthy",
  "timestamp": "2026-03-06T10:00:00Z",
  "version": "1.0.0"
}
```

## Development

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Building

```bash
npm run build
```

## Monitoring

### Metrics

Access metrics at `http://localhost:9090/metrics` (if enabled)

### Logs

Logs are written to:
- Console (development)
- `logs/` directory (production)

### Database

SQLite database at `data/sentry-ai-agent.db`

Query audit logs:
```sql
SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10;
```

## Troubleshooting

### Common Issues

**Issue**: PRs not being created
- Check `OPERATIONAL_MODE` is set to `pr-creation`
- Verify `FEATURE_AUTO_PR_CREATION=true`
- Check circuit breaker status in logs

**Issue**: Validation always failing
- Check test/lint/typecheck commands work locally
- Verify `VALIDATION_MODE` is correct
- Check validation timeout settings

**Issue**: High LLM costs
- Enable caching: `LLM_ENABLE_CACHING=true`
- Lower daily budget: `LLM_DAILY_BUDGET=30`
- Use cheaper model for triage

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT

## Support

For issues and questions:
- GitHub Issues: <your-repo-url>/issues
- Documentation: <your-docs-url>

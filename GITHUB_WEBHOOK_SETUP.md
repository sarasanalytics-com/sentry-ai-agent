# GitHub Webhook Setup Guide

## Overview

The Sentry AI Agent now supports **GitHub webhooks** to enable bidirectional workflows. When a PR is created by the AI agent, it can automatically notify reviewers via Slack DM.

## Current Workflow

```
AI creates PR → GitHub webhook → Agent → Slack DM to reviewers
```

## Setup Instructions

### 1. Configure Environment Variables

Add to your `.env`:

```bash
# GitHub webhook secret (generate a random string)
GITHUB_WEBHOOK_SECRET=your_random_secret_here

# Bot username (used to identify AI-created PRs)
GITHUB_BOT_USERNAME=ai-agent

# Map GitHub usernames to Slack user IDs for DM notifications
GITHUB_SLACK_USER_MAP={"github_user1":"U12345ABC","github_user2":"U67890DEF"}
```

### 2. Generate Webhook Secret

```bash
# Generate a random secret
openssl rand -hex 32
```

Copy the output and set it as `GITHUB_WEBHOOK_SECRET`.

### 3. Configure GitHub Webhook

1. Go to your GitHub repository
2. Navigate to **Settings** → **Webhooks** → **Add webhook**
3. Configure:
   - **Payload URL**: `https://your-server.com/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: (paste your `GITHUB_WEBHOOK_SECRET`)
   - **Events**: Select individual events:
     - ✅ Pull requests
     - ✅ Pull request reviews
   - **Active**: ✅ Checked

4. Click **Add webhook**

### 4. Get Slack User IDs

To send DMs, you need Slack user IDs (not usernames):

**Method 1: Via Slack API**
```bash
curl -H "Authorization: Bearer YOUR_SLACK_BOT_TOKEN" \
  "https://slack.com/api/users.list" | jq '.members[] | {name: .name, id: .id}'
```

**Method 2: Via Slack UI**
1. Click on a user's profile
2. Click "More" → "Copy member ID"

**Method 3: Right-click user**
1. Right-click on user in Slack
2. Select "Copy member ID"

### 5. Map GitHub Users to Slack Users

Update `GITHUB_SLACK_USER_MAP` in `.env`:

```bash
GITHUB_SLACK_USER_MAP={
  "github_alice":"U01ABC123",
  "github_bob":"U02DEF456",
  "github_charlie":"U03GHI789"
}
```

**Important**: This must be valid JSON on a single line.

### 6. Restart the Server

```bash
npm run dev
```

Verify in logs:
```
[INFO] Initialization complete {"mcpServers":["github","sentry","clickup","slack"]}
```

### 7. Test the Webhook

**Option 1: Create a test PR manually**
```bash
# In your repo
git checkout -b fix/test-webhook
echo "test" > test.txt
git add test.txt
git commit -m "[AI] Test webhook"
git push origin fix/test-webhook

# Create PR via GitHub UI or CLI
gh pr create --title "🤖 Test: Webhook notification" --body "Testing webhook"
```

**Option 2: Use GitHub's webhook test**
1. Go to repository **Settings** → **Webhooks**
2. Click on your webhook
3. Scroll to "Recent Deliveries"
4. Click "Redeliver" on a past PR event

## How It Works

### PR Created by AI

When a PR is created:

1. **GitHub sends webhook** to `/webhook/github`
2. **Agent verifies signature** using `GITHUB_WEBHOOK_SECRET`
3. **Agent checks if AI-created**:
   - Author matches `GITHUB_BOT_USERNAME`
   - OR branch starts with `fix/`
   - OR title contains `[AI]` or `🤖`
4. **Agent gets reviewers** from PR
5. **Agent maps GitHub → Slack** using `GITHUB_SLACK_USER_MAP`
6. **Agent sends Slack DM** to each reviewer

### PR Merged

When a PR is merged:

1. **GitHub sends webhook** with `pull_request.closed` + `merged=true`
2. **Agent finds linked Sentry issue** (via branch name pattern)
3. **Agent resolves Sentry issue** with comment
4. **Agent updates ClickUp task** (if linked)
5. **Agent notifies Slack channel** about merge

## Slack DM Message Format

Reviewers receive:

```
👋 Hi! You've been requested to review an AI-generated PR:

🤖 Fix: TypeError in user profile handler
🔗 https://github.com/org/repo/pull/123

📝 Branch: `fix/abc123` → `main`
👤 Author: ai-agent

Please review when you have a chance. The AI has analyzed 
the error and proposed this fix with high confidence.
```

## Troubleshooting

### Webhook Not Triggering

**Check webhook deliveries:**
1. Go to GitHub **Settings** → **Webhooks**
2. Click on your webhook
3. Check "Recent Deliveries"
4. Look for errors or failed deliveries

**Common issues:**
- ❌ Incorrect payload URL
- ❌ Server not accessible from internet
- ❌ Signature verification failing

**Solution:**
```bash
# Check server logs
npm run dev

# Test webhook endpoint manually
curl -X POST http://localhost:3000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -d '{"zen":"Keep it logically awesome."}'
```

### Slack DMs Not Sending

**Check logs for:**
```
[WARN] Could not find Slack user for GitHub user {"githubUser":"username"}
```

**Solutions:**
1. Verify `GITHUB_SLACK_USER_MAP` is valid JSON
2. Check Slack user IDs are correct (start with `U`)
3. Verify Slack bot token has `chat:write` scope
4. Test Slack MCP directly:
   ```typescript
   await mcpRegistry.execute('slack', 'send_message', {
     channel: 'U01ABC123',
     text: 'Test DM'
   });
   ```

### PRs Not Detected as AI-Created

**Agent checks:**
- Author == `GITHUB_BOT_USERNAME`
- Branch starts with `fix/`
- Title contains `[AI]` or `🤖`

**Solutions:**
1. Set `GITHUB_BOT_USERNAME` to match your bot's GitHub username
2. Ensure PR titles include `[AI]` or `🤖`
3. Use branch naming: `fix/error-fingerprint`

## Advanced Configuration

### Custom PR Detection Logic

Edit `src/api/webhooks/github.ts`:

```typescript
private async onPROpened(pr: GitHubPullRequest): Promise<void> {
  // Custom logic to detect AI-created PRs
  const isAICreated = 
    pr.user.login === botUsername || 
    pr.labels.some(l => l.name === 'ai-generated') ||
    pr.title.startsWith('[AUTO]');
  
  if (!isAICreated) {
    return;
  }
  
  await this.notifyReviewers(pr);
}
```

### Fallback to Channel Notification

If no reviewers are assigned or user mapping fails:

```typescript
if (reviewers.length === 0) {
  // Sends to default Slack channel instead
  await this.sendChannelNotification(pr);
}
```

### Custom Message Templates

Edit message in `src/api/webhooks/github.ts`:

```typescript
private buildReviewerMessage(pr: GitHubPullRequest): string {
  return `Your custom message here
  PR: ${pr.html_url}`;
}
```

## Security Considerations

- ✅ Webhook signature verification enabled
- ✅ Secret stored in `.env` (never commit!)
- ✅ Only processes whitelisted events
- ✅ Validates PR author before sending DMs

## Next Steps

This is **Phase 1** of the full workflow engine. See `FUTURE_ENHANCEMENTS.md` for:

- ClickUp webhook integration
- Slack event handlers
- YAML-based workflow configuration
- Full cross-service orchestration

## API Endpoints

### GitHub Webhook
```
POST /webhook/github
```

**Headers:**
- `X-GitHub-Event`: Event type (e.g., `pull_request`)
- `X-Hub-Signature-256`: HMAC signature for verification

**Events Handled:**
- `pull_request.opened` - PR created
- `pull_request.closed` (merged) - PR merged
- `pull_request.review_requested` - Reviewer added

## Testing Checklist

- [ ] Environment variables configured
- [ ] GitHub webhook created and active
- [ ] Slack user mapping configured
- [ ] Server restarted
- [ ] Test PR created
- [ ] Webhook delivery successful (check GitHub)
- [ ] Slack DM received by reviewer
- [ ] Server logs show no errors

## Summary

The GitHub webhook integration enables:
- ✅ **Automatic reviewer notifications** when AI creates PRs
- ✅ **Closed-loop workflow** when PRs are merged
- ✅ **Bidirectional communication** between GitHub and other services

This is the foundation for the full workflow engine coming in future phases!

# Sentry MCP Integration

## Overview

The Sentry AI Agent now includes **bidirectional communication** with Sentry through the Sentry MCP server. This enables the agent to not only receive errors via webhooks but also interact with Sentry to update issues, add comments, and resolve errors automatically.

## Benefits

### 1. **Automated Issue Updates**
- Adds comments to Sentry issues when tickets are created
- Adds comments when PRs are created
- Automatically tags issues with AI processing metadata
- Resolves issues when PRs are merged

### 2. **Enhanced Context**
- Fetches additional issue details (occurrence count, user count)
- Retrieves recent events for better error understanding
- Enriches AI analysis with Sentry-specific data

### 3. **Closed-Loop Workflow**
```
Sentry Error → AI Analysis → PR Creation → Comment in Sentry → PR Merge → Auto-Resolve in Sentry
```

## Configuration

### 1. Generate Sentry Auth Token

1. Go to Sentry: **Settings** → **Account** → **API** → **Auth Tokens**
2. Click **Create New Token**
3. Set scopes:
   - `project:read`
   - `project:write`
   - `event:read`
   - `org:read`
4. Copy the token

### 2. Update `.env`

```bash
# Required for bidirectional communication
SENTRY_AUTH_TOKEN=sntrys_your_auth_token_here
SENTRY_ORG_SLUG=your-organization-slug
SENTRY_PROJECT_SLUG=your-project-slug

# Already configured (webhook)
SENTRY_WEBHOOK_SECRET=your_webhook_secret
```

### 3. Verify Integration

Start the server and check logs:
```bash
npm run dev
```

You should see:
```
[INFO] Sentry MCP server registered
[INFO] Initialization complete {"mcpServers":["github","sentry","clickup","slack"]}
```

## Features

### Automatic Comments

When the agent processes an error, it adds comments to the Sentry issue:

**When Ticket Created:**
```
🤖 AI Agent created ticket: https://app.clickup.com/t/abc123

Confidence: 85%
Fix Type: null-check
```

**When PR Created:**
```
🚀 AI Agent created PR: https://github.com/org/repo/pull/123

Confidence: 90%
Fix Type: optional-chaining

Please review and merge if the fix looks correct.
```

**When PR Merged:**
```
✅ Fix merged in PR: https://github.com/org/repo/pull/123

Marking as resolved.
```

### Automatic Tagging

Issues are automatically tagged with:
- `ai-agent: processed` - Indicates AI has processed this error
- `pr-created: true` - PR was created for this issue
- `fix-type: <type>` - The type of fix applied (e.g., null-check)

### Issue Resolution

When a PR is merged (future enhancement), the agent can:
1. Add a comment with the PR URL
2. Mark the issue as resolved
3. Add resolution metadata

## MCP Server Capabilities

The Sentry MCP server provides these tools:

### 1. `get_issue`
Get detailed information about a Sentry issue.

```typescript
await mcpRegistry.execute('sentry', 'get_issue', {
  issueId: 'SENTRY_ISSUE_ID'
});
```

Returns:
- Issue title, status, level
- Occurrence count
- User count
- First/last seen timestamps

### 2. `add_issue_comment`
Add a comment to a Sentry issue.

```typescript
await mcpRegistry.execute('sentry', 'add_issue_comment', {
  issueId: 'SENTRY_ISSUE_ID',
  comment: 'Your comment here'
});
```

### 3. `update_issue_status`
Update the status of a Sentry issue.

```typescript
await mcpRegistry.execute('sentry', 'update_issue_status', {
  issueId: 'SENTRY_ISSUE_ID',
  status: 'resolved' // or 'unresolved', 'ignored'
});
```

### 4. `get_issue_events`
Get recent events for a Sentry issue.

```typescript
await mcpRegistry.execute('sentry', 'get_issue_events', {
  issueId: 'SENTRY_ISSUE_ID',
  limit: 5
});
```

### 5. `resolve_issue`
Mark a Sentry issue as resolved.

```typescript
await mcpRegistry.execute('sentry', 'resolve_issue', {
  issueId: 'SENTRY_ISSUE_ID',
  resolution: 'resolved'
});
```

### 6. `ignore_issue`
Ignore a Sentry issue.

```typescript
await mcpRegistry.execute('sentry', 'ignore_issue', {
  issueId: 'SENTRY_ISSUE_ID'
});
```

### 7. `assign_issue`
Assign a Sentry issue to a user or team.

```typescript
await mcpRegistry.execute('sentry', 'assign_issue', {
  issueId: 'SENTRY_ISSUE_ID',
  assignee: 'user@example.com'
});
```

### 8. `add_tags`
Add tags to a Sentry issue.

```typescript
await mcpRegistry.execute('sentry', 'add_tags', {
  issueId: 'SENTRY_ISSUE_ID',
  tags: {
    'ai-processed': 'true',
    'fix-type': 'null-check'
  }
});
```

## Workflow Integration

### Error Processing Flow (Updated)

```
1. Sentry Error Webhook → Agent
2. Agent gathers context (including Sentry API data)
3. AI analyzes error
4. Agent creates ticket
   └─→ Adds comment to Sentry issue
5. If confidence high enough:
   - Agent creates PR
   - Adds comment to Sentry issue
   - Tags issue with metadata
6. When PR merged (future):
   - Agent resolves Sentry issue
   - Adds final comment
```

## Example: Complete Workflow

### 1. Error Occurs
```javascript
// Production code throws error
const user = null;
console.log(user.name); // TypeError: Cannot read property 'name' of null
```

### 2. Sentry Captures Error
- Error sent to Sentry
- Webhook triggers agent

### 3. Agent Processes
- Gathers context from GitHub + Sentry API
- AI analyzes: "Add null check before accessing user.name"
- Confidence: 88%

### 4. Agent Creates Ticket
ClickUp ticket created with:
- Error details
- AI analysis
- Suggested fix

**Sentry comment added:**
```
🤖 AI Agent created ticket: https://app.clickup.com/t/abc123

Confidence: 88%
Fix Type: null-check
```

### 5. Agent Creates PR
GitHub PR created with fix:
```typescript
if (user && user.name) {
  console.log(user.name);
}
```

**Sentry comment added:**
```
🚀 AI Agent created PR: https://github.com/org/repo/pull/456

Confidence: 88%
Fix Type: null-check

Please review and merge if the fix looks correct.
```

**Sentry tags added:**
- `ai-agent: processed`
- `pr-created: true`
- `fix-type: null-check`

### 6. PR Reviewed & Merged
Developer reviews, approves, and merges PR.

### 7. Agent Resolves Issue (Future)
**Sentry comment added:**
```
✅ Fix merged in PR: https://github.com/org/repo/pull/456

Marking as resolved.
```

Issue status → **Resolved**

## Benefits of Bidirectional Communication

### 1. **Visibility**
- Team sees AI activity directly in Sentry
- No need to check external systems
- Clear audit trail of AI actions

### 2. **Traceability**
- Link from Sentry → ClickUp ticket
- Link from Sentry → GitHub PR
- Complete workflow in one place

### 3. **Automation**
- Auto-resolve when fixes are merged
- Auto-tag for filtering and reporting
- Reduced manual work

### 4. **Context**
- AI gets richer error data from Sentry API
- Better analysis with occurrence counts
- Pattern detection across events

## Troubleshooting

### Sentry MCP Not Registered

**Symptom:** Logs show "Sentry auth token not configured"

**Solution:**
1. Verify `SENTRY_AUTH_TOKEN` in `.env`
2. Restart server: `npm run dev`
3. Check logs for "Sentry MCP server registered"

### Comments Not Appearing

**Symptom:** No comments in Sentry issues

**Solution:**
1. Verify auth token has `project:write` scope
2. Check logs for "Failed to add Sentry comment"
3. Verify issue ID is correct

### Tags Not Applied

**Symptom:** Tags not showing in Sentry

**Solution:**
1. Verify auth token permissions
2. Check Sentry API rate limits
3. Review error logs

## Future Enhancements

### 1. **PR Merge Detection**
- GitHub webhook for PR merge events
- Automatic Sentry issue resolution
- Success metrics tracking

### 2. **Smart Assignment**
- Auto-assign based on file ownership
- Team-based routing
- Escalation rules

### 3. **Pattern Detection**
- Identify recurring issues
- Suggest architectural fixes
- Proactive recommendations

### 4. **Custom Workflows**
- Configurable comment templates
- Custom tag schemas
- Integration with other tools

## Security Considerations

- Auth token stored in `.env` (never commit!)
- Minimum required scopes only
- Rate limiting on Sentry API calls
- Audit logging of all Sentry actions

## Summary

The Sentry MCP integration transforms the AI agent from a one-way error processor into a **fully integrated team member** that:
- ✅ Receives errors via webhook
- ✅ Analyzes and creates fixes
- ✅ Updates Sentry with progress
- ✅ Closes the loop when fixes are merged

This creates a **seamless, automated workflow** that keeps your team informed and reduces manual overhead.

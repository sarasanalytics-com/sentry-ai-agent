# Sentry Internal Integration Setup (Free!)

## Overview

Instead of using Octohook (paid), we'll use Sentry's **Internal Integration** feature, which is **completely free** and provides native webhook support.

This gives you:
- ✅ **Free** webhook delivery from Sentry
- ✅ **Native** Sentry integration
- ✅ **Automatic** auth token generation
- ✅ **Bidirectional** communication (webhooks + API)

## Architecture

```
Sentry Error → Internal Integration Webhook → Your Agent
                                                  ↓
                                    AI Analysis + Actions
                                                  ↓
                              GitHub PR + ClickUp + Slack
                                                  ↓
                            Sentry API (via integration token)
                                                  ↓
                          Add comments, tags, resolve issues
```

## Step-by-Step Setup

### Step 1: Create Internal Integration in Sentry

1. **Go to Sentry**: https://sentry.io
2. **Navigate to**: Settings → Developer Settings
3. **Click**: "Create New Integration"
4. **Choose**: "Internal Integration" (NOT Public Integration)
   - Internal integrations are for your organization only
   - They're completely free
   - They get automatic webhook support

### Step 2: Configure Integration Details

**Basic Information:**
- **Name**: `AI Agent`
- **Author**: Your name or team name
- **Webhook URL**: `http://localhost:3000/webhook/sentry`
  - For local testing, use ngrok (see Step 3)
  - For production: `https://your-domain.com/webhook/sentry`

**Permissions** (check these):
- ✅ **Project: Read**
- ✅ **Project: Write**
- ✅ **Event: Read**
- ✅ **Organization: Read**
- ✅ **Issue & Events: Read**

**Webhooks** (enable these):
- ✅ **issue** - Check all actions:
  - `created`
  - `resolved`
  - `assigned`
  - `ignored`
- ✅ **comment** (optional):
  - `created`
  - `edited`
  - `deleted`

**Important:** Do NOT enable `error.created` webhooks (too noisy, triggers on every error event)

### Step 3: Get Your Credentials

After creating the integration, Sentry will show you:

1. **Client ID**: Copy this (looks like: `abc123def456`)
2. **Client Secret**: Copy this (looks like: `xyz789abc123def456...`)
3. **Token**: This is your auth token! (starts with `sntrys_`)

**Save these immediately!** The secret is only shown once.

### Step 4: Update Your `.env`

Add these to your `.env` file:

```bash
# =============================================================================
# SENTRY INTERNAL INTEGRATION
# =============================================================================

# Auth token from Internal Integration (for API calls)
SENTRY_AUTH_TOKEN=sntrys_your_token_from_integration

# Organization and project slugs
SENTRY_ORG_SLUG=your-org-slug
SENTRY_PROJECT_SLUG=your-project-slug

# Webhook secret (Sentry will sign webhooks with this)
# Use the Client Secret from the integration
SENTRY_WEBHOOK_SECRET=your_client_secret_from_integration

# Optional: DSN for error tracking
SENTRY_DSN=https://your-sentry-dsn-here
```

**How to get Org and Project slugs:**
- Look at your Sentry URL: `https://sentry.io/organizations/YOUR-ORG/projects/YOUR-PROJECT/`
- Copy `YOUR-ORG` → `SENTRY_ORG_SLUG`
- Copy `YOUR-PROJECT` → `SENTRY_PROJECT_SLUG`

### Step 5: Local Testing with ngrok

Since Sentry needs to reach your local server, use ngrok:

```bash
# Install ngrok (if not already installed)
brew install ngrok

# Start your agent
npm run dev

# In another terminal, start ngrok
ngrok http 3000

# You'll see output like:
# Forwarding: https://abc123.ngrok.io -> http://localhost:3000
```

**Update Sentry Integration:**
1. Go back to Settings → Developer Settings → Your Integration
2. Update **Webhook URL** to: `https://abc123.ngrok.io/webhook/sentry`
3. Click **Save Changes**

### Step 6: Install Integration on Your Project

1. **Go to**: Settings → Integrations
2. **Find**: Your "AI Agent" integration
3. **Click**: "Configure" or "Install"
4. **Select**: The project(s) you want to monitor
5. **Click**: "Install"

This activates the webhook for those projects!

### Step 7: Verify Setup

Start your agent:

```bash
npm run dev
```

You should see in the logs:
```
[INFO] Sentry MCP server registered
[INFO] Initialization complete {"mcpServers":["github","sentry","clickup","slack"]}
[INFO] Sentry AI Agent started {"port":3000}
```

### Step 8: Test the Webhook

**Option 1: Trigger a real error**

In your application, trigger an error that Sentry will capture:

```javascript
// In your app
throw new Error('Test error for AI agent');
```

**Option 2: Use Sentry's test feature**

1. Go to your Sentry project
2. Create a test issue manually
3. Watch your agent logs for the webhook

**Option 3: Manual webhook test**

Send a test webhook to your endpoint:

```bash
curl -X POST http://localhost:3000/webhook/sentry \
  -H "Content-Type: application/json" \
  -H "sentry-hook-signature: test" \
  -d '{
    "action": "created",
    "installation": {
      "uuid": "test-uuid"
    },
    "data": {
      "issue": {
        "id": "12345",
        "title": "Test Error: Cannot read property",
        "level": "error",
        "metadata": {
          "type": "TypeError",
          "value": "Cannot read property of undefined"
        }
      }
    }
  }'
```

## Complete Workflow Example

Once everything is set up:

```
1. Error occurs in your app
   ↓
2. Sentry captures error
   ↓
3. Sentry sends webhook to your agent (via Internal Integration)
   ↓
4. Agent receives webhook at /webhook/sentry
   ↓
5. Agent uses Sentry API (with integration token) to get more details:
   - Occurrence count
   - User impact
   - Recent events
   ↓
6. AI analyzes error with enriched context
   ↓
7. Agent creates GitHub PR (if confidence >= 85%)
   ↓
8. Agent creates ClickUp ticket
   ↓
9. Agent uses Sentry API to add comment:
   "🤖 AI Agent created ticket: [link]
    🚀 AI Agent created PR: [link]
    Confidence: 87%"
   ↓
10. Agent uses Sentry API to tag issue:
    - "ai-agent: processed"
    - "pr-created: true"
    - "fix-type: null-check"
   ↓
11. When PR merges → Agent uses Sentry API to resolve issue
```

## Webhook Payload Format

Sentry Internal Integration sends webhooks in this format:

```json
{
  "action": "created",
  "installation": {
    "uuid": "your-installation-uuid"
  },
  "data": {
    "issue": {
      "id": "12345",
      "title": "TypeError: Cannot read property 'x' of undefined",
      "culprit": "app/controllers/users.js in handleRequest",
      "level": "error",
      "status": "unresolved",
      "metadata": {
        "type": "TypeError",
        "value": "Cannot read property 'x' of undefined"
      },
      "project": {
        "id": "67890",
        "slug": "your-project"
      }
    },
    "event": {
      "event_id": "abc123",
      "exception": {
        "values": [{
          "type": "TypeError",
          "value": "Cannot read property 'x' of undefined",
          "stacktrace": {
            "frames": [...]
          }
        }]
      },
      "tags": {...},
      "environment": "production"
    }
  }
}
```

Our webhook handler already parses this format correctly!

## Advantages Over Octohook

| Feature | Internal Integration | Octohook |
|---------|---------------------|----------|
| **Cost** | ✅ Free | ❌ Paid |
| **Setup** | ✅ Simple | ⚠️ Requires subscription |
| **Auth Token** | ✅ Auto-generated | ⚠️ Separate setup |
| **Webhooks** | ✅ Native support | ✅ Relay service |
| **API Access** | ✅ Included | ⚠️ Separate token |
| **Permissions** | ✅ Granular | ⚠️ Limited |

## Troubleshooting

### Webhook Not Received

**Check 1: Is integration installed?**
- Go to Settings → Integrations
- Verify your integration is installed on the project
- Check installation status

**Check 2: Is webhook URL correct?**
- Settings → Developer Settings → Your Integration
- Verify webhook URL matches your ngrok URL
- Make sure it ends with `/webhook/sentry`

**Check 3: Check agent logs**
```bash
npm run dev
# Look for: [INFO] Received Sentry webhook
```

**Check 4: Check ngrok**
```bash
# In ngrok terminal, you should see webhook requests
# If not, Sentry isn't sending them
```

### Signature Verification Failing

**Error:**
```
[WARN] Invalid webhook signature
```

**Solution:**
1. Make sure `SENTRY_WEBHOOK_SECRET` matches the Client Secret from your integration
2. For development, you can temporarily disable verification:
   ```bash
   NODE_ENV=development npm run dev
   ```

### Sentry API Calls Failing

**Error:**
```
[ERROR] Sentry MCP not available
[ERROR] Failed to add comment to Sentry issue
```

**Solutions:**
1. Verify `SENTRY_AUTH_TOKEN` is the token from your Internal Integration
2. Check token has correct permissions (Project: Write, Event: Read)
3. Verify `SENTRY_ORG_SLUG` and `SENTRY_PROJECT_SLUG` are correct
4. Test token manually:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://sentry.io/api/0/organizations/YOUR_ORG/projects/"
   ```

### ngrok URL Changed

**Problem:** ngrok gives you a new URL each time you restart (on free plan)

**Solution:**
1. Get new ngrok URL: `ngrok http 3000`
2. Update in Sentry: Settings → Developer Settings → Your Integration
3. Update Webhook URL to new ngrok address
4. Save changes

**Better solution:** Use ngrok's static domain (paid) or deploy to production

## Production Deployment

When deploying to production:

1. **Use a real domain**:
   ```
   https://sentry-ai-agent.your-domain.com/webhook/sentry
   ```

2. **Update Sentry Integration**:
   - Settings → Developer Settings → Your Integration
   - Change Webhook URL to production URL
   - Save changes

3. **Set environment variables** on your server:
   ```bash
   SENTRY_AUTH_TOKEN=sntrys_...
   SENTRY_ORG_SLUG=your-org
   SENTRY_PROJECT_SLUG=your-project
   SENTRY_WEBHOOK_SECRET=your_client_secret
   ```

4. **Enable HTTPS** (required by Sentry)

5. **Monitor webhook deliveries**:
   - Settings → Developer Settings → Your Integration
   - Check "Recent Deliveries" tab

## What You Get

### Webhook Events (Incoming)
- ✅ `issue.created` - New errors
- ✅ `issue.resolved` - Issues marked as resolved
- ✅ `issue.assigned` - Issues assigned to users
- ✅ `issue.ignored` - Issues ignored

### API Capabilities (Outgoing via MCP)
- ✅ Get issue details
- ✅ Add comments to issues
- ✅ Update issue status
- ✅ Resolve issues
- ✅ Add tags to issues
- ✅ Get issue events
- ✅ Assign issues

## Summary

**Setup Checklist:**
- [ ] Create Internal Integration in Sentry
- [ ] Enable permissions: Project Read/Write, Event Read
- [ ] Enable webhooks: issue (created, resolved, assigned, ignored)
- [ ] Copy Client Secret and Token
- [ ] Update `.env` with credentials
- [ ] Install integration on your project
- [ ] Start ngrok: `ngrok http 3000`
- [ ] Update webhook URL in Sentry with ngrok URL
- [ ] Start agent: `npm run dev`
- [ ] Trigger test error
- [ ] Verify webhook received in logs

**You now have a completely free, native Sentry integration with full bidirectional communication!** 🎉

No Octohook subscription needed!

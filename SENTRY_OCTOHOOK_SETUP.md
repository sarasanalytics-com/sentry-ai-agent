# Sentry with Octohook Setup Guide

## Overview

Since Sentry doesn't have native webhook support in your plan, you're using **Octohook** as a webhook relay. This guide shows you how to configure the complete flow:

```
Sentry Error → Octohook → Your Agent → AI Processing → GitHub/ClickUp/Slack
                                    ↓
                            Sentry MCP (bidirectional)
                                    ↓
                        Comments, Tags, Resolution
```

## Part 1: Sentry MCP Server (Bidirectional Communication)

This allows the agent to communicate back to Sentry (add comments, tags, resolve issues).

### Step 1: Get Sentry Auth Token

1. Go to **Sentry.io** → **Settings** → **Account** → **API** → **Auth Tokens**
2. Click **"Create New Token"**
3. Configure:
   - **Name**: `ai-agent-mcp2`
   - **Scopes** (check these):
     - ✅ `project:read`
     - ✅ `project:write`
     - ✅ `event:read`
     - ✅ `org:read`
4. Click **"Create Token"**
5. Copy the token (starts with `sntrys_`)

### Step 2: Get Organization and Project Slugs

Look at your Sentry URL:
```
https://sentry.io/organizations/YOUR-ORG-SLUG/projects/YOUR-PROJECT-SLUG/
```

### Step 3: Update `.env`

Add these to your `.env` file:

```bash
# =============================================================================
# SENTRY MCP SERVER (Bidirectional Communication)
# =============================================================================
SENTRY_AUTH_TOKEN=sntrys_your_token_here
SENTRY_ORG_SLUG=your-org-slug
SENTRY_PROJECT_SLUG=your-project-slug

# Sentry DSN (optional, for error tracking)
SENTRY_DSN=https://your-sentry-dsn-here

# Webhook secret (for Octohook verification)
SENTRY_WEBHOOK_SECRET=7448da17314acbe0215ff4dd09d572474fcddd81c781bc967a3415816aa96dd6
```

## Part 2: Octohook Configuration

### Step 1: Configure Octohook in Sentry

1. Go to **Sentry** → **Settings** → **Integrations**
2. Find **Octohook** in your installed integrations
3. Click on **Octohook** to configure it

### Step 2: Add Webhook Endpoint in Octohook

Octohook should have a configuration panel where you can add webhook URLs:

1. **Add new webhook endpoint**
2. **URL**: 
   - Local testing: `http://localhost:3000/webhook/sentry`
   - Production: `https://your-domain.com/webhook/sentry`
   - **For local testing**, you'll need a tunnel (see below)

3. **Events to forward**:
   - ✅ `issue.created`
   - ✅ `issue.reopened`
   - ✅ `error` (if available)

4. **Secret/Signature** (if Octohook supports it):
   - Use: `7448da17314acbe0215ff4dd09d572474fcddd81c781bc967a3415816aa96dd6`

5. **Save** the configuration

### Step 3: Local Testing with Tunnel

Since Octohook needs to reach your local server, use ngrok:

```bash
# Install ngrok
brew install ngrok

# Start your agent
npm run dev

# In another terminal, start ngrok
ngrok http 3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
# Update Octohook webhook URL to: https://abc123.ngrok.io/webhook/sentry
```

**Alternative: Cloudflare Tunnel**
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

## Part 3: Verify Setup

### Check 1: Environment Variables

```bash
# Run this to verify your .env is configured
grep -E "SENTRY_AUTH_TOKEN|SENTRY_ORG_SLUG|SENTRY_PROJECT_SLUG" .env
```

You should see:
```
SENTRY_AUTH_TOKEN=sntrys_...
SENTRY_ORG_SLUG=your-org
SENTRY_PROJECT_SLUG=your-project
```

### Check 2: Start Server

```bash
npm run dev
```

Look for these log messages:
```
[INFO] Sentry MCP server registered
[INFO] Initialization complete {"mcpServers":["github","sentry","clickup","slack"]}
[INFO] Sentry AI Agent started {"port":3000}
```

### Check 3: Test Webhook Endpoint

```bash
# Test that the webhook endpoint is accessible
curl -X POST http://localhost:3000/webhook/sentry \
  -H "Content-Type: application/json" \
  -d '{"action":"test","data":{}}'
```

Expected response:
```json
{"status":"ignored"}
```

## Part 4: Test End-to-End Flow

### Option 1: Trigger a Real Error

1. In your application, trigger an error that Sentry will capture
2. Watch the agent logs for:
   ```
   [INFO] Received Sentry webhook {"event":"created","issueId":"..."}
   [INFO] Processing error {"fingerprint":"..."}
   [INFO] AI analysis complete {"confidence":0.85}
   [INFO] Creating GitHub PR
   [INFO] Adding Sentry comment
   ```

### Option 2: Use Octohook Test Feature

If Octohook has a "Test" or "Send Test Event" button:
1. Click it to send a test webhook
2. Check your agent logs for the webhook receipt

### Option 3: Manual Webhook Test

Create a test payload and send it:

```bash
curl -X POST http://localhost:3000/webhook/sentry \
  -H "Content-Type: application/json" \
  -d '{
    "action": "created",
    "data": {
      "issue": {
        "id": "12345",
        "title": "Test Error",
        "level": "error",
        "metadata": {
          "fingerprint": ["test-error"]
        }
      },
      "event": {
        "exception": {
          "values": [{
            "type": "TypeError",
            "value": "Cannot read property of undefined",
            "stacktrace": {
              "frames": [{
                "filename": "src/app.js",
                "lineno": 42,
                "function": "handleRequest"
              }]
            }
          }]
        },
        "environment": "production",
        "tags": {}
      }
    }
  }'
```

## Complete Workflow

Once everything is configured:

```
1. Error occurs in your app
   ↓
2. Sentry captures error
   ↓
3. Octohook forwards to your agent (/webhook/sentry)
   ↓
4. Agent verifies signature
   ↓
5. Agent enriches context using Sentry MCP
   - Gets occurrence count
   - Gets recent events
   - Gets user impact
   ↓
6. AI analyzes error with enriched context
   ↓
7. Agent creates GitHub PR (if confidence high)
   ↓
8. Agent creates ClickUp ticket
   ↓
9. Agent adds comment to Sentry issue via MCP:
   "🤖 AI Agent created ticket: [link]
    🚀 AI Agent created PR: [link]
    Confidence: 85%"
   ↓
10. Agent tags Sentry issue via MCP:
    - "ai-agent: processed"
    - "pr-created: true"
    - "fix-type: null-check"
   ↓
11. When PR merges → Agent resolves Sentry issue via MCP
```

## Troubleshooting

### Webhook Not Received

**Check Octohook logs:**
- Go to Sentry → Integrations → Octohook
- Look for delivery logs or recent webhooks
- Check for errors

**Check agent logs:**
```bash
npm run dev
# Look for: [INFO] Received Sentry webhook
```

**Common issues:**
- ❌ Octohook URL incorrect
- ❌ Agent not running
- ❌ Firewall blocking ngrok/tunnel
- ❌ Signature verification failing

### Sentry MCP Not Working

**Symptoms:**
```
[ERROR] Sentry MCP not available
[WARN] Could not add comment to Sentry issue
```

**Solutions:**
1. Check `SENTRY_AUTH_TOKEN` is set and starts with `sntrys_`
2. Verify token has correct scopes
3. Check `SENTRY_ORG_SLUG` and `SENTRY_PROJECT_SLUG` are correct
4. Test token manually:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://sentry.io/api/0/organizations/YOUR_ORG/projects/"
   ```

### Signature Verification Failing

**Error in logs:**
```
[WARN] Invalid webhook signature
```

**Solutions:**
1. Check `SENTRY_WEBHOOK_SECRET` matches what's configured in Octohook
2. For development, you can disable signature verification:
   ```bash
   NODE_ENV=development npm run dev
   ```
3. Check Octohook is sending the signature header

## What You Get

### Without Sentry MCP (Webhook Only)
- ✅ Receive errors from Sentry via Octohook
- ✅ AI analysis and PR creation
- ❌ Can't comment back to Sentry
- ❌ Can't tag issues
- ❌ Can't resolve issues

### With Sentry MCP (Full Bidirectional)
- ✅ Receive errors from Sentry via Octohook
- ✅ AI analysis and PR creation
- ✅ Add comments to Sentry issues
- ✅ Tag issues with metadata
- ✅ Resolve issues when PRs merge
- ✅ Get enriched context (occurrence count, user impact)

## Next Steps

1. ✅ Configure Sentry MCP credentials in `.env`
2. ✅ Configure Octohook webhook URL
3. ✅ Start agent: `npm run dev`
4. ✅ Trigger a test error
5. ✅ Verify complete workflow

## Production Deployment

When deploying to production:

1. **Use a real domain** instead of ngrok:
   ```
   https://sentry-ai-agent.your-domain.com/webhook/sentry
   ```

2. **Enable HTTPS** (required by Octohook)

3. **Set environment variables** on your server

4. **Monitor logs** for webhook deliveries

5. **Set up alerts** for webhook failures

## Support

If you encounter issues:
- Check agent logs: `npm run dev`
- Check Octohook delivery logs in Sentry
- Verify environment variables are set
- Test webhook endpoint manually
- Ensure ngrok/tunnel is running for local testing

---

**You're now ready to use Sentry with Octohook and the Sentry MCP server for full bidirectional communication!** 🚀

# Slack Webhook Setup Guide

## Quick Setup (5 minutes)

### Step 1: Create Incoming Webhook

1. Go to your Slack workspace
2. Click on your workspace name → **Settings & administration** → **Manage apps**
3. Search for **"Incoming Webhooks"** and click on it
4. Click **"Add to Slack"** button
5. Choose the channel where you want to receive PR notifications (e.g., `#engineering`, `#sentry-alerts`)
6. Click **"Add Incoming Webhooks integration"**
7. Copy the **Webhook URL** (looks like: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX`)

### Step 2: Configure Your Agent

Add this to your `.env` file:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX
```

Replace with your actual webhook URL from Step 1.

### Step 3: Restart the Agent

```bash
npm run dev
```

### Step 4: Test It!

Trigger a new error in your application and watch for the Slack notification! 🎉

---

## What You'll Receive

When the agent creates a PR, you'll get a Slack message like:

```
🚀 PR Created for Sentry Error

Error: TypeError: Cannot read property 'x' of undefined
File: components/Button.tsx:42
Confidence: 85%

Ticket: https://app.clickup.com/t/86d28xyvk
PR: https://github.com/your-org/your-repo/pull/1234
```

---

## Troubleshooting

**No messages appearing?**
- Check that `SLACK_WEBHOOK_URL` is set in `.env`
- Verify the webhook URL is correct
- Check agent logs for errors: `[ERROR] Failed to send Slack notification`

**Want to change the channel?**
- Create a new webhook for a different channel
- Update `SLACK_WEBHOOK_URL` in `.env`
- Restart the agent

---

## Upgrade to Bot Token (Optional)

For advanced features like threading and file uploads, you can upgrade to a Slack Bot Token:

1. Create a Slack App at https://api.slack.com/apps
2. Add bot token scopes: `chat:write`, `files:write`
3. Install to workspace
4. Add to `.env`:
   ```bash
   SLACK_BOT_TOKEN=xoxb-your-token-here
   SLACK_DEFAULT_CHANNEL=#your-channel
   ```
5. Remove or comment out `SLACK_WEBHOOK_URL`

The agent will automatically use the bot token if both are configured.

# Event Filtering Strategy

## Overview

The Sentry AI Agent filters certain types of events before processing to avoid creating unnecessary tickets and PRs for non-actionable issues.

## Filtering Rules

### 1. Info/Debug Level Events

**Rule:** Filter all events with `level: 'info'` or `level: 'debug'`

**Reason:** These are typically console logs, debug messages, or informational events that don't represent actual errors requiring code fixes.

**Examples:**
- Console.log statements
- Debug traces
- Informational messages

### 2. Events Without Valid File Paths

**Rule:** Filter events where `repoPath` is empty or undefined

**Reason:** Events without a valid repository file path are usually:
- Browser console logs where the "file" is actually a route (e.g., `/chat`, `/dashboard`)
- External library logs
- Events that cannot be mapped to actual source code

**Examples:**
```
file: "/chat"
repoPath: ""
```

### 3. Tracking/Analytics Events

**Rule:** Filter events containing specific tracking-related keywords in the message:
- `[PostHog.js]`
- `$autocapture`
- `LOG:` (when combined with other filters)

**Reason:** These are analytics/tracking events, not application errors.

**Examples:**
```
LOG: 1031 | 1006: [PostHog.js] send "$autocapture" [object Object]
```

## Implementation

The filtering logic is implemented in `src/api/webhook.ts` in the `shouldFilterEvent()` method. Events are filtered **before** they reach the agent processing pipeline, preventing:

1. Unnecessary AI analysis costs
2. Creation of non-actionable ClickUp tickets
3. Spam in Sentry comments
4. Safety violations from invalid file paths

## Why This Matters

### Problem Scenario

Without filtering, the agent would:
1. Receive browser console logs as "errors"
2. Attempt to analyze them with AI
3. Hit safety violations (no file extension for `/chat`)
4. Create tickets marked as "create_ticket_only"
5. Add comments to Sentry
6. Generate noise without value

### Solution

By filtering early in the webhook handler:
1. Non-actionable events are rejected immediately
2. Resources (AI calls, API requests) are saved
3. Only real, fixable errors are processed
4. Tickets and PRs are created only for actionable issues

## Future Considerations

This filtering strategy may need updates if:

1. **You want to track info-level events** - Modify the level filter or add configuration
2. **You need to process browser-specific errors** - Add logic to distinguish real browser errors from console logs
3. **New tracking tools are added** - Update the keyword filter list
4. **Custom filtering rules are needed** - Add project-specific or repo-specific filters

## Configuration

Currently, filtering is hardcoded in the webhook handler. Future enhancement could move these rules to configuration:

```typescript
// Potential future config
filtering: {
  excludeLevels: ['info', 'debug'],
  excludePatterns: ['[PostHog.js]', '$autocapture'],
  requireRepoPath: true,
}
```

## Monitoring

Filtered events are logged with:
```
[INFO] Filtering non-actionable event {"fingerprint":"...","level":"info","type":"default","file":"/chat"}
```

This allows monitoring of what's being filtered and adjusting rules if needed.

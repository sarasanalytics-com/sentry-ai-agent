# Repository Mapping Guide

## Overview

The Sentry AI Agent supports configurable repository mapping to automatically route errors from different Sentry projects to their corresponding GitHub repositories. This allows you to manage multiple projects with a single agent instance.

## Configuration

### Environment Variable

Add the `REPO_MAPPING` environment variable to your `.env` file:

```bash
REPO_MAPPING=sentry-project:github-repo:branch,another-project:another-repo:branch
```

### Format

Each mapping entry follows this format:
```
sentry-project-slug:github-repo-name:target-branch
```

- **sentry-project-slug**: The Sentry project slug (lowercase)
- **github-repo-name**: The GitHub repository name
- **target-branch**: The branch to create PRs against (optional, defaults to `dev`)

Multiple mappings are separated by commas.

## Your Current Mappings

Based on your requirements, here are the configured mappings:

```bash
REPO_MAPPING=daton:daton-webapp:dev,daton-webapp:webapp:dev,saras-iq-*:iq-webapp:dev,insights-webapp:insights-webapp:dev,global-webapp:global-accounts-webapp:dev
```

### Mapping Table

| Sentry Project | GitHub Repo | Branch |
|----------------|-------------|--------|
| `daton` | `daton-webapp` | `dev` |
| `daton-webapp` | `webapp` | `dev` |
| `saras-iq-*` (wildcard) | `iq-webapp` | `dev` |
| `insights-webapp` | `insights-webapp` | `dev` |
| `global-webapp` | `global-accounts-webapp` | `dev` |

## Wildcard Support

The mapping supports wildcard patterns using `*`:

```bash
saras-iq-*:iq-webapp:dev
```

This will match:
- `saras-iq-test`
- `saras-iq-prod`
- `saras-iq-dev`
- Any other project starting with `saras-iq-`

All will be routed to the `iq-webapp` repository with PRs targeting the `dev` branch.

## Default Fallback

If a Sentry project doesn't match any configured mapping, the agent will use:

```bash
GITHUB_DEFAULT_REPO=insights-webapp
GITHUB_DEFAULT_BRANCH=dev
```

## How It Works

1. **Webhook Received**: When a Sentry webhook arrives, the agent extracts the project slug
2. **Mapping Resolution**: The `resolveRepo()` function checks:
   - Exact match in `REPO_MAPPING`
   - Pattern match using wildcards
   - Falls back to default repo if no match
3. **PR Creation**: The agent creates the PR in the resolved repository targeting the specified branch

## Example Scenarios

### Scenario 1: Exact Match
```
Sentry Project: insights-webapp
→ Resolves to: insights-webapp repo, dev branch
```

### Scenario 2: Wildcard Match
```
Sentry Project: saras-iq-test
→ Matches pattern: saras-iq-*
→ Resolves to: iq-webapp repo, dev branch
```

### Scenario 3: No Match (Fallback)
```
Sentry Project: unknown-project
→ No mapping found
→ Resolves to: insights-webapp repo (default), dev branch
```

## Testing

To test the mapping, trigger an error from a specific Sentry project:

```bash
curl -X POST http://localhost:3000/api/process-issue \
  -H "Content-Type: application/json" \
  -d '{"url":"https://saras-analytics.sentry.io/issues/ISSUE_ID/"}'
```

Check the logs for:
```
[INFO] Resolved repo from exact mapping {"sentryProject":"...","repo":"...","branch":"..."}
```

## Logs

The agent logs repository resolution for debugging:

```
✅ Exact match:
[INFO] Resolved repo from exact mapping {
  "sentryProject": "insights-webapp",
  "repo": "insights-webapp",
  "branch": "dev"
}

✅ Pattern match:
[INFO] Resolved repo from pattern matching {
  "sentryProject": "saras-iq-test",
  "pattern": "saras-iq-*",
  "repo": "iq-webapp",
  "branch": "dev"
}

⚠️ Fallback:
[WARN] No mapping found for Sentry project, using default repo {
  "sentryProject": "unknown-project",
  "defaultRepo": "insights-webapp"
}
```

## Updating Mappings

1. Update the `REPO_MAPPING` in your `.env` file
2. Restart the agent: `npm run dev`
3. The new mappings will be loaded automatically

## Advanced Configuration

### Custom Branch per Project

You can specify different branches for different projects:

```bash
REPO_MAPPING=insights-webapp:insights-webapp:main,daton:daton-webapp:develop
```

### Multiple Patterns

Combine exact matches and patterns:

```bash
REPO_MAPPING=prod-*:webapp:main,test-*:webapp:dev,staging-*:webapp:staging
```

## Troubleshooting

**Issue**: PRs are going to the wrong repository

**Solution**: Check the Sentry project slug in the webhook payload and verify it matches your mapping exactly (case-insensitive).

**Issue**: Wildcard not working

**Solution**: Ensure the pattern uses `*` and matches the project slug format. Check logs for pattern matching attempts.

**Issue**: Using default repo unexpectedly

**Solution**: Verify the `REPO_MAPPING` environment variable is set correctly and the agent has been restarted.

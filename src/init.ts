import { mcpRegistry } from './mcp/registry';
import { githubMCP } from './mcp/github';
import { clickupMCP } from './mcp/clickup';
import { slackMCP } from './mcp/slack';
import { sentryMCP } from './mcp/sentry';
import { logger } from './utils/logger';
import { config } from './config';

export function initializeApp(): void {
  logger.info('Initializing Sentry AI Agent', {
    environment: config.nodeEnv,
    mode: config.operationalMode,
  });

  mcpRegistry.register(githubMCP);
  logger.debug('GitHub MCP server registered');

  if (process.env.SENTRY_AUTH_TOKEN) {
    mcpRegistry.register(sentryMCP);
    logger.debug('Sentry MCP server registered');
  } else {
    logger.warn('Sentry auth token not configured, skipping Sentry MCP');
  }

  if (config.clickup.apiToken) {
    mcpRegistry.register(clickupMCP);
    logger.debug('ClickUp MCP server registered');
  } else {
    logger.warn('ClickUp API token not configured, skipping ClickUp MCP');
  }

  if (config.slack.botToken) {
    mcpRegistry.register(slackMCP);
    logger.debug('Slack MCP server registered');
  } else {
    logger.warn('Slack bot token not configured, skipping Slack MCP');
  }

  logger.info('Initialization complete', {
    mcpServers: mcpRegistry.listServers().map(s => s.name),
  });
}

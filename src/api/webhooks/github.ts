import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { mcpRegistry } from '../../mcp/registry';
import { db } from '../../database/client';

interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  user: {
    login: string;
  };
  requested_reviewers: Array<{
    login: string;
  }>;
  head: {
    ref: string;
  };
  base: {
    ref: string;
  };
  merged: boolean;
  state: string;
}

interface GitHubWebhookPayload {
  action: string;
  pull_request: GitHubPullRequest;
  repository: {
    full_name: string;
  };
}

export class GitHubWebhookHandler {
  verifySignature(req: Request): boolean {
    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) {
      logger.warn('Missing GitHub signature header');
      return false;
    }

    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';
    if (!webhookSecret) {
      logger.error('GITHUB_WEBHOOK_SECRET not configured');
      return false;
    }

    const payload = JSON.stringify(req.body);
    const hmac = crypto.createHmac('sha256', webhookSecret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );

    if (!isValid) {
      logger.warn('Invalid GitHub webhook signature');
    }

    return isValid;
  }

  async handleWebhook(req: Request, res: Response): Promise<void> {
    if (!this.verifySignature(req)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.headers['x-github-event'] as string;
    const payload = req.body as GitHubWebhookPayload;

    logger.info('GitHub webhook received', { 
      event, 
      action: payload.action,
      repo: payload.repository?.full_name,
    });

    try {
      switch (event) {
        case 'pull_request':
          await this.handlePullRequest(payload);
          break;
        default:
          logger.debug('Unhandled GitHub event', { event });
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error('GitHub webhook processing failed', { error });
      res.status(500).json({ error: 'Processing failed' });
    }
  }

  private async handlePullRequest(payload: GitHubWebhookPayload): Promise<void> {
    const { action, pull_request } = payload;

    switch (action) {
      case 'opened':
        await this.onPROpened(pull_request);
        break;
      case 'closed':
        if (pull_request.merged) {
          await this.onPRMerged(pull_request);
        }
        break;
      case 'review_requested':
        await this.onReviewRequested(pull_request);
        break;
      default:
        logger.debug('Unhandled PR action', { action });
    }
  }

  private async onPROpened(pr: GitHubPullRequest): Promise<void> {
    logger.info('PR opened', { 
      number: pr.number, 
      title: pr.title,
      author: pr.user.login,
    });

    // Check if this PR was created by the AI agent
    const botUsername = process.env.GITHUB_BOT_USERNAME || 'ai-agent';
    const isAICreated = pr.user.login === botUsername || 
                        pr.head.ref.startsWith('fix/') ||
                        pr.title.includes('[AI]') ||
                        pr.title.includes('🤖');

    if (!isAICreated) {
      logger.debug('PR not created by AI, skipping notification');
      return;
    }

    // Notify reviewers via Slack
    await this.notifyReviewers(pr);
  }

  private async notifyReviewers(pr: GitHubPullRequest): Promise<void> {
    const slackMCP = mcpRegistry.get('slack');
    if (!slackMCP) {
      logger.debug('Slack MCP not available, skipping notification');
      return;
    }

    if (!config.features.slackNotifications) {
      logger.debug('Slack notifications disabled');
      return;
    }

    // Get reviewers from PR
    const reviewers = pr.requested_reviewers || [];
    
    if (reviewers.length === 0) {
      logger.debug('No reviewers assigned, sending to default channel');
      await this.sendChannelNotification(pr);
      return;
    }

    // Send DM to each reviewer
    for (const reviewer of reviewers) {
      try {
        const slackUserId = await this.getSlackUserId(reviewer.login);
        if (!slackUserId) {
          logger.warn('Could not find Slack user for GitHub user', { 
            githubUser: reviewer.login 
          });
          continue;
        }

        const message = this.buildReviewerMessage(pr);
        
        await mcpRegistry.execute('slack', 'send_message', {
          channel: slackUserId, // DM channel
          text: message,
        });

        logger.info('Slack DM sent to reviewer', { 
          reviewer: reviewer.login,
          pr: pr.number,
        });
      } catch (error) {
        logger.error('Failed to send Slack DM', { 
          reviewer: reviewer.login,
          error,
        });
      }
    }
  }

  private async sendChannelNotification(pr: GitHubPullRequest): Promise<void> {
    try {
      const message = this.buildChannelMessage(pr);
      
      await mcpRegistry.execute('slack', 'send_message', {
        channel: config.slack.defaultChannel,
        text: message,
      });

      logger.info('Slack channel notification sent', { pr: pr.number });
    } catch (error) {
      logger.error('Failed to send Slack channel notification', { error });
    }
  }

  private buildReviewerMessage(pr: GitHubPullRequest): string {
    return `👋 Hi! You've been requested to review an AI-generated PR:

🤖 *${pr.title}*
🔗 ${pr.html_url}

📝 Branch: \`${pr.head.ref}\` → \`${pr.base.ref}\`
👤 Author: ${pr.user.login}

Please review when you have a chance. The AI has analyzed the error and proposed this fix with high confidence.`;
  }

  private buildChannelMessage(pr: GitHubPullRequest): string {
    return `🤖 *AI Agent Created a PR*

*${pr.title}*
${pr.html_url}

Branch: \`${pr.head.ref}\` → \`${pr.base.ref}\`
Author: ${pr.user.login}

This PR needs review!`;
  }

  private async getSlackUserId(githubUsername: string): Promise<string | null> {
    // TODO: Implement user mapping (GitHub username → Slack user ID)
    // For now, this could be:
    // 1. Environment variable mapping: GITHUB_SLACK_MAP='{"github_user":"U12345"}'
    // 2. Database table: user_mappings
    // 3. Slack API lookup by email (if emails match)
    
    const userMap = process.env.GITHUB_SLACK_USER_MAP;
    if (userMap) {
      try {
        const mapping = JSON.parse(userMap);
        return mapping[githubUsername] || null;
      } catch (error) {
        logger.error('Failed to parse GITHUB_SLACK_USER_MAP', { error });
      }
    }

    return null;
  }

  private async onPRMerged(pr: GitHubPullRequest): Promise<void> {
    logger.info('PR merged', { 
      number: pr.number, 
      title: pr.title,
    });

    // Find linked Sentry issue
    const linkedIssue = await this.findLinkedSentryIssue(pr);
    if (linkedIssue) {
      await this.resolveSentryIssue(linkedIssue, pr);
    }

    // Find linked ClickUp task
    const linkedTask = await this.findLinkedClickUpTask(pr);
    if (linkedTask) {
      await this.updateClickUpTask(linkedTask, pr);
    }

    // Notify Slack
    await this.notifyPRMerged(pr);
  }

  private async findLinkedSentryIssue(pr: GitHubPullRequest): Promise<string | null> {
    // Look for Sentry issue ID in PR description or branch name
    // Pattern: fix/SENTRY-123 or mentions in PR body
    
    const branchMatch = pr.head.ref.match(/fix\/([a-f0-9]+)/);
    if (branchMatch) {
      const fingerprint = branchMatch[1];
      const error = db.getErrorByFingerprint(fingerprint);
      return error?.id || null;
    }

    return null;
  }

  private async findLinkedClickUpTask(_pr: GitHubPullRequest): Promise<string | null> {
    // Look for ClickUp task ID in PR description
    // Pattern: CU-abc123 or #abc123
    
    // This would require storing the link when we create the task
    // For now, return null - implement in Phase 3 (Entity Linking)
    return null;
  }

  private async resolveSentryIssue(issueId: string, pr: GitHubPullRequest): Promise<void> {
    try {
      const sentryMCP = mcpRegistry.get('sentry');
      if (!sentryMCP) {
        return;
      }

      await mcpRegistry.execute('sentry', 'add_issue_comment', {
        issueId,
        comment: `✅ Fix merged in PR: ${pr.html_url}\n\nMarking as resolved.`,
      });

      await mcpRegistry.execute('sentry', 'resolve_issue', {
        issueId,
        resolution: 'resolved',
      });

      logger.info('Sentry issue resolved after PR merge', { issueId, pr: pr.number });
    } catch (error) {
      logger.error('Failed to resolve Sentry issue', { error });
    }
  }

  private async updateClickUpTask(taskId: string, pr: GitHubPullRequest): Promise<void> {
    try {
      await mcpRegistry.execute('clickup', 'add_comment', {
        taskId,
        comment: `✅ PR merged: ${pr.html_url}`,
      });

      await mcpRegistry.execute('clickup', 'update_task', {
        taskId,
        status: 'complete',
      });

      logger.info('ClickUp task updated after PR merge', { taskId, pr: pr.number });
    } catch (error) {
      logger.error('Failed to update ClickUp task', { error });
    }
  }

  private async notifyPRMerged(pr: GitHubPullRequest): Promise<void> {
    const slackMCP = mcpRegistry.get('slack');
    if (!slackMCP || !config.features.slackNotifications) {
      return;
    }

    try {
      const message = `✅ *AI PR Merged!*

*${pr.title}*
${pr.html_url}

The fix has been deployed to ${pr.base.ref}. 🚀`;

      await mcpRegistry.execute('slack', 'send_message', {
        channel: config.slack.defaultChannel,
        text: message,
      });

      logger.info('Slack notification sent for PR merge', { pr: pr.number });
    } catch (error) {
      logger.error('Failed to send PR merge notification', { error });
    }
  }

  private async onReviewRequested(pr: GitHubPullRequest): Promise<void> {
    logger.info('Review requested on PR', { number: pr.number });
    // This is handled by onPROpened for AI-created PRs
  }
}

export const githubWebhookHandler = new GitHubWebhookHandler();

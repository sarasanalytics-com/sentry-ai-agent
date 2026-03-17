import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';
import { mcpRegistry } from '../mcp/registry';
import { db } from '../database/client';
import { rateLimiter } from '../safety/rate-limiter';
import { SentryError, AIAnalysis, ActionResult } from '../types';

export class ActionExecutor {
  async executeAction(
    error: SentryError,
    analysis: AIAnalysis,
    recommendation: 'create_pr' | 'create_suggestion' | 'create_ticket_only'
  ): Promise<ActionResult> {
    logger.info('Executing action', { 
      fingerprint: error.fingerprint, 
      recommendation 
    });

    const ticketId = await this.createTicket(error, analysis);

    if (recommendation === 'create_ticket_only') {
      await this.notifySlack(error, analysis, ticketId.url, 'ticket_only');
      return {
        success: true,
        ticketId: ticketId.id,
        ticketUrl: ticketId.url,
        reason: 'Safety constraints: ticket only',
      };
    }

    if (recommendation === 'create_suggestion') {
      await this.notifySlack(error, analysis, ticketId.url, 'suggestion');
      return {
        success: true,
        ticketId: ticketId.id,
        ticketUrl: ticketId.url,
        reason: 'Confidence too low for PR: suggestion sent',
      };
    }

    if (config.features.autoPRCreation && recommendation === 'create_pr') {
      if (!rateLimiter.canCreatePR()) {
        logger.warn('PR rate limit exceeded');
        await this.notifySlack(error, analysis, ticketId.url, 'suggestion');
        return {
          success: true,
          ticketId: ticketId.id,
          ticketUrl: ticketId.url,
          reason: 'PR rate limit exceeded',
        };
      }

      try {
        const pr = await this.createPR(error, analysis);
        rateLimiter.recordPR();
        
        await this.notifySlack(error, analysis, ticketId.url, 'pr_created', pr.url);
        
        return {
          success: true,
          prNumber: pr.number,
          prUrl: pr.url,
          ticketId: ticketId.id,
          ticketUrl: ticketId.url,
        };
      } catch (err) {
        logger.error('Failed to create PR', { error: err });
        return {
          success: false,
          ticketId: ticketId.id,
          ticketUrl: ticketId.url,
          reason: `PR creation failed: ${err}`,
        };
      }
    }

    // Send Slack notification for ticket-only actions
    await this.notifySlack(error, analysis, ticketId.url, 'ticket_only');

    return {
      success: true,
      ticketId: ticketId.id,
      ticketUrl: ticketId.url,
      reason: 'Auto PR creation disabled or low confidence',
    };
  }

  private async createTicket(error: SentryError, analysis: AIAnalysis): Promise<{ id: string; url: string }> {
    // Use Sentry message directly - it already contains formatted title: TYPE: user_id | company_id: Title
    const name = error.message;
    const description = this.buildTicketDescription(error, analysis);

    try {
      const ticket = await mcpRegistry.execute('clickup', 'create_task', {
        name,
        description,
        priority: this.getPriority(error.level),
        tags: ['sentry', 'auto-generated', error.type.toLowerCase()],
      });

      logger.info('Ticket created', { id: ticket.id, url: ticket.url });

      try {
        await this.addSentryComment(error.id, `🤖 AI Agent created ticket: ${ticket.url}\n\nConfidence: ${(analysis.confidence * 100).toFixed(0)}%\nFix Type: ${analysis.fixType}`);
      } catch (commentErr) {
        logger.warn('Failed to add Sentry comment', { error: commentErr });
        // Don't fail the whole operation if comment fails
      }

      return ticket;
    } catch (err) {
      logger.error('Failed to create ClickUp ticket', { 
        error: err,
        errorType: error.type,
        fingerprint: error.fingerprint,
      });
      
      // Return a fallback ticket object so the agent can continue
      // This allows Slack notification to still be sent
      return {
        id: 'failed',
        url: `https://saras-analytics.sentry.io/issues/${error.id}/`,
      };
    }
  }

  private buildTicketDescription(error: SentryError, analysis: AIAnalysis): string {
    return `## Error Details

**Type:** ${error.type}
**Message:** ${error.message}
**File:** ${error.file}:${error.line}
**Environment:** ${error.environment}
**Fingerprint:** ${error.fingerprint}

## AI Analysis

**Root Cause:** ${analysis.rootCause}

**Confidence:** ${(analysis.confidence * 100).toFixed(0)}%

**Fix Type:** ${analysis.fixType}

**Reasoning:** ${analysis.reasoning}

## Suggested Fix

\`\`\`
${analysis.suggestedCode}
\`\`\`

## Stack Trace

\`\`\`
${error.stackTrace}
\`\`\`
`;
  }

  private getPriority(level: string): number {
    const priorityMap: Record<string, number> = {
      fatal: 1,
      error: 2,
      warning: 3,
      info: 4,
    };
    return priorityMap[level] || 3;
  }

  private async createPR(error: SentryError, analysis: AIAnalysis): Promise<{ number: number; url: string }> {
    const branchName = `fix/sentry-${error.fingerprint.substring(0, 8)}-${Date.now()}`;

    await mcpRegistry.execute('github', 'create_branch', {
      repo: error.repo,
      branchName,
    });

    logger.info('Branch created', { branch: branchName });

    // Apply fixes to each affected file
    for (const filePath of analysis.affectedFiles) {
      try {
        // Fetch current file content
        const currentContent = await mcpRegistry.execute('github', 'get_file', {
          repo: error.repo,
          path: filePath,
        });

        // Apply the fix to the specific error line
        const updatedContent = this.applyFixToFile(
          currentContent,
          error.line,
          analysis.suggestedCode,
          analysis.linesChanged
        );

        // Update file with complete modified content
        await mcpRegistry.execute('github', 'update_file', {
          repo: error.repo,
          path: filePath,
          content: updatedContent,
          message: `fix: ${error.message}`,
          branch: branchName,
        });

        logger.info('File updated with fix', { 
          file: filePath, 
          errorLine: error.line,
          linesChanged: analysis.linesChanged,
        });
      } catch (fileErr) {
        logger.error('Failed to apply fix to file', { 
          file: filePath, 
          error: fileErr 
        });
        throw fileErr;
      }
    }

    logger.info('All files updated', { count: analysis.affectedFiles.length });

    const pr = await mcpRegistry.execute('github', 'create_pr', {
      repo: error.repo,
      title: `Fix: ${error.type} in ${error.file}`,
      body: this.buildPRDescription(error, analysis),
      head: branchName,
      draft: config.advanced.prAlwaysDraft,
    });

    logger.info('PR created', { number: pr.number, url: pr.url });

    // Record in database (non-critical, don't fail if this errors)
    try {
      const attemptId = uuidv4();
      db.recordFixAttempt({
        id: attemptId,
        errorId: error.id,
        timestamp: Date.now(),
        confidence: analysis.confidence,
        fixType: analysis.fixType,
        code: analysis.suggestedCode,
        prNumber: pr.number,
        prUrl: pr.url,
        merged: false,
        validationPassed: false,
      });
    } catch (dbError) {
      logger.warn('Failed to record fix attempt in database', { error: dbError });
    }

    await this.addSentryComment(
      error.id,
      `🚀 AI Agent created PR: ${pr.url}\n\nConfidence: ${(analysis.confidence * 100).toFixed(0)}%\nFix Type: ${analysis.fixType}\n\nPlease review and merge if the fix looks correct.`
    );

    await this.addSentryTags(error.id, {
      'ai-agent': 'processed',
      'pr-created': 'true',
      'fix-type': analysis.fixType,
    });

    return pr;
  }

  private buildPRDescription(error: SentryError, analysis: AIAnalysis): string {
    return `## 🤖 Automated Fix for Sentry Error

**Error:** ${error.type}: ${error.message}
**File:** ${error.file}:${error.line}
**Confidence:** ${(analysis.confidence * 100).toFixed(0)}%

### Root Cause
${analysis.rootCause}

### Fix Applied
${analysis.reasoning}

### Changes
- Fix type: ${analysis.fixType}
- Lines changed: ${analysis.linesChanged}
- Files affected: ${analysis.affectedFiles.length}

---
*This PR was automatically generated by Sentry AI Agent*
*Fingerprint: ${error.fingerprint}*
`;
  }

  private async notifySlack(
    error: SentryError,
    analysis: AIAnalysis,
    ticketUrl: string,
    type: 'suggestion' | 'pr_created' | 'ticket_only',
    prUrl?: string
  ): Promise<void> {
    if (!config.features.slackNotifications) {
      return;
    }

    let emoji: string;
    let action: string;
    
    if (type === 'pr_created') {
      emoji = '�';
      action = 'PR Created';
    } else if (type === 'suggestion') {
      emoji = '💡';
      action = 'Suggestion Available';
    } else {
      emoji = '⚠️';
      action = 'Manual Review Required';
    }

    const text = `${emoji} *${action}* for Sentry Error

*Error:* ${error.type}: ${error.message}
*File:* ${error.file}:${error.line}
*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%
${type === 'ticket_only' ? `*Reason:* ${analysis.rootCause}` : ''}

*Ticket:* ${ticketUrl}
${prUrl ? `*PR:* ${prUrl}` : ''}
`;

    try {
      await mcpRegistry.execute('slack', 'send_message', {
        channel: config.slack.defaultChannel,
        text,
      });

      logger.info('Slack notification sent', { type });
    } catch (err) {
      logger.error('Failed to send Slack notification', { error: err });
    }
  }

  private async addSentryComment(issueId: string, comment: string): Promise<void> {
    try {
      const sentryMCP = mcpRegistry.get('sentry');
      if (!sentryMCP) {
        logger.debug('Sentry MCP not available, skipping comment');
        return;
      }

      await mcpRegistry.execute('sentry', 'add_issue_comment', {
        issueId,
        comment,
      });

      logger.debug('Comment added to Sentry issue', { issueId });
    } catch (err) {
      logger.error('Failed to add Sentry comment', { error: err });
    }
  }

  private applyFixToFile(
    currentContent: string,
    errorLine: number,
    suggestedFix: string,
    linesChanged: number
  ): string {
    const lines = currentContent.split('\n');
    
    // Calculate the range to replace based on linesChanged
    // The AI's fix typically includes the error line plus surrounding context
    const startLine = Math.max(0, errorLine - Math.floor(linesChanged / 2));
    const endLine = Math.min(lines.length, errorLine + Math.ceil(linesChanged / 2));
    
    // Split the suggested fix into lines
    const fixLines = suggestedFix.split('\n');
    
    // Replace the affected lines with the fix
    const updatedLines = [
      ...lines.slice(0, startLine),
      ...fixLines,
      ...lines.slice(endLine),
    ];
    
    logger.debug('Applied fix to file', {
      originalLines: lines.length,
      updatedLines: updatedLines.length,
      replacedRange: `${startLine}-${endLine}`,
      fixLines: fixLines.length,
    });
    
    return updatedLines.join('\n');
  }

  private async addSentryTags(issueId: string, tags: Record<string, string>): Promise<void> {
    try {
      const sentryMCP = mcpRegistry.get('sentry');
      if (!sentryMCP) {
        logger.debug('Sentry MCP not available, skipping tags');
        return;
      }

      await mcpRegistry.execute('sentry', 'add_tags', {
        issueId,
        tags,
      });

      logger.debug('Tags added to Sentry issue', { issueId });
    } catch (err) {
      logger.error('Failed to add Sentry tags', { error: err });
    }
  }

  async resolveSentryIssue(issueId: string, prUrl: string): Promise<void> {
    try {
      const sentryMCP = mcpRegistry.get('sentry');
      if (!sentryMCP) {
        logger.debug('Sentry MCP not available, skipping resolve');
        return;
      }

      await mcpRegistry.execute('sentry', 'add_issue_comment', {
        issueId,
        comment: `✅ Fix merged in PR: ${prUrl}\n\nMarking as resolved.`,
      });

      await mcpRegistry.execute('sentry', 'resolve_issue', {
        issueId,
        resolution: 'resolved',
      });

      logger.info('Sentry issue resolved', { issueId, prUrl });
    } catch (err) {
      logger.error('Failed to resolve Sentry issue', { error: err });
    }
  }
}

export const actionExecutor = new ActionExecutor();

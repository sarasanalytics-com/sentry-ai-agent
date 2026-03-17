import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { agentCore } from '../agent/core';
import { mcpRegistry } from '../mcp/registry';
import { SentryError } from '../types';
import { resolveRepo } from '../utils/repo-mapper';

export class ManualTriggerHandler {
  async handleManualTrigger(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Sentry issue URL is required' });
        return;
      }

      logger.info('Manual trigger requested', { url });

      const issueId = this.extractIssueId(url);
      if (!issueId) {
        res.status(400).json({ error: 'Invalid Sentry issue URL format' });
        return;
      }

      logger.info('Extracted issue ID', { issueId });

      // Fetch issue data from Sentry
      const issue = await mcpRegistry.execute('sentry', 'get_issue', {
        issueId,
      });

      const events = await mcpRegistry.execute('sentry', 'get_issue_events', {
        issueId,
      });

      // Fetch full event details with stack traces
      let fullEvent = null;
      if (events && events.length > 0) {
        const latestEventId = events[0].eventId || events[0].id;
        logger.info('Fetching full event details', { issueId, eventId: latestEventId });
        try {
          fullEvent = await mcpRegistry.execute('sentry', 'get_event', {
            issueId,
            eventId: latestEventId,
          });
          logger.info('Full event fetched', {
            hasEntries: !!fullEvent?.entries,
            entriesCount: fullEvent?.entries?.length || 0,
            entryTypes: fullEvent?.entries?.map((e: any) => e.type) || [],
            hasContexts: !!fullEvent?.contexts,
            hasTags: !!fullEvent?.tags,
          });
        } catch (eventErr) {
          logger.error('Failed to fetch full event', { 
            issueId, 
            eventId: latestEventId,
            error: eventErr instanceof Error ? eventErr.message : eventErr,
          });
        }
      } else {
        logger.warn('No events found for issue', { issueId });
      }

      // Parse issue data into SentryError format
      const sentryError = this.parseIssueToSentryError(issue, fullEvent);

      if (!sentryError) {
        res.status(400).json({ error: 'Failed to parse Sentry issue data' });
        return;
      }

      logger.info('Manually processing Sentry issue', {
        fingerprint: sentryError.fingerprint,
        type: sentryError.type,
      });

      // Process through agent
      res.status(202).json({
        status: 'processing',
        issueId,
        fingerprint: sentryError.fingerprint,
        message: 'Issue processing started',
      });

      // Process asynchronously
      agentCore.processError(sentryError).catch((error) => {
        logger.error('Failed to process manually triggered issue', { error, issueId });
      });
    } catch (error) {
      logger.error('Error handling manual trigger', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private extractIssueId(url: string): string | null {
    // Extract issue ID from Sentry URL
    // Format: https://[org].sentry.io/issues/[issueId]/...
    const match = url.match(/\/issues\/(\d+)/);
    return match ? match[1] : null;
  }

  private parseIssueToSentryError(issue: any, fullEvent: any): SentryError | null {
    try {
      if (!issue) {
        logger.warn('Missing issue data');
        return null;
      }

      // Extract stack trace from full event data
      const exceptionEntry = fullEvent?.entries?.find((e: any) => e.type === 'exception');
      logger.info('Exception entry found', { 
        hasEntry: !!exceptionEntry, 
        entryType: exceptionEntry?.type,
        hasFullEvent: !!fullEvent,
      });
      
      const stacktrace = exceptionEntry?.data?.values?.[0]?.stacktrace;
      logger.info('Stacktrace data', { 
        hasStacktrace: !!stacktrace, 
        frameCount: stacktrace?.frames?.length || 0,
      });
      
      const frames = stacktrace?.frames || [];
      logger.info('Stack frames extracted', { 
        frameCount: frames.length, 
        topFrame: frames[frames.length - 1],
      });
      const topFrame = frames[frames.length - 1] || {};

      const rawFilename = topFrame.filename || topFrame.absPath || 'unknown';
      const lineNo = topFrame.lineNo || 0;
      const colNo = topFrame.colNo || 0;

      // Extract and clean repo path from filename
      const repoPath = this.extractRepoPath(rawFilename);
      const cleanFilename = repoPath; // Use cleaned path for file field

      // Convert tags array to record
      const tags: Record<string, string> = {};
      if (Array.isArray(issue.tags)) {
        issue.tags.forEach((tag: any) => {
          if (tag.key && tag.value) {
            tags[tag.key] = tag.value;
          }
        });
      }

      const formattedStackTrace = this.formatStacktrace(frames);
      logger.info('Stack trace formatted', { length: formattedStackTrace.length, preview: formattedStackTrace.substring(0, 200) });
      
      // Extract breadcrumbs for context
      const breadcrumbsEntry = fullEvent?.entries?.find((e: any) => e.type === 'breadcrumbs');
      const breadcrumbs = breadcrumbsEntry?.data?.values || [];
      
      // Extract request data
      const requestEntry = fullEvent?.entries?.find((e: any) => e.type === 'request');
      const request = requestEntry?.data || fullEvent?.request;
      
      logger.info('Rich context extracted', {
        breadcrumbCount: breadcrumbs.length,
        hasRequest: !!request,
        hasUser: !!fullEvent?.user,
        hasContexts: !!fullEvent?.contexts,
      });
      
      // Resolve GitHub repo and branch from Sentry project slug
      const projectSlug = issue.project?.slug || issue.project?.name || fullEvent?.project?.slug;
      logger.info('Resolving repo from Sentry project', { 
        projectSlug,
        hasProjectObject: !!issue.project,
        projectKeys: issue.project ? Object.keys(issue.project) : [],
      });
      
      const repoConfig = resolveRepo(projectSlug);
      
      return {
        id: issue.id,
        fingerprint: issue.id,
        type: issue.type || 'Error',
        message: issue.title || issue.metadata?.value || 'Unknown error',
        level: issue.level || 'error',
        file: cleanFilename,
        line: lineNo,
        column: colNo,
        repo: repoConfig.repo,
        repoPath,
        owner: repoConfig.owner,
        stackTrace: formattedStackTrace,
        environment: fullEvent?.environment || issue.metadata?.environment || 'production',
        tags,
        timestamp: new Date(issue.lastSeen || Date.now()).getTime(),
        // Rich context
        breadcrumbs: breadcrumbs.map((b: any) => ({
          type: b.type,
          category: b.category,
          message: b.message,
          level: b.level,
          timestamp: b.timestamp,
          data: b.data,
        })),
        user: fullEvent?.user,
        request: request ? {
          url: request.url,
          method: request.method,
          headers: request.headers,
          data: request.data,
          query_string: request.query_string,
        } : undefined,
        contexts: fullEvent?.contexts,
        extra: fullEvent?.extra,
      };
    } catch (error) {
      logger.error('Failed to parse issue to SentryError', { error });
      return null;
    }
  }

  private extractRepoPath(filename: string): string {
    // Clean up ./ prefix and other path issues
    let cleanPath = filename.replace(/^\.\//, '').replace(/^\//, '');
    
    // Try to extract meaningful repo path from filename
    const patterns = [
      /(?:src|lib|app|components|pages|api|utils|services)\/(.+)/,
      /\/([^/]+\/[^/]+\.[a-z]+)$/,
    ];

    for (const pattern of patterns) {
      const match = cleanPath.match(pattern);
      if (match) return match[0];
    }

    return cleanPath;
  }

  private formatStacktrace(frames: any[]): string {
    return frames
      .slice(-10)
      .reverse()
      .map((frame, idx) => {
        const file = frame.filename || frame.absPath || 'unknown';
        const line = frame.lineNo || '?';
        const func = frame.function || '<anonymous>';
        return `  ${idx + 1}. ${func} (${file}:${line})`;
      })
      .join('\n');
  }
}

export const manualTriggerHandler = new ManualTriggerHandler();

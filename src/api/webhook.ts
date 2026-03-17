import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SentryError } from '../types';
import { db } from '../database/client';
import { agentCore } from '../agent/core';
import { resolveRepo } from '../utils/repo-mapper';

export class WebhookHandler {
  async handleSentryWebhook(req: Request, res: Response): Promise<void> {
    try {
      if (!this.verifySignature(req)) {
        logger.warn('Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const payload = req.body;
      logger.info('Received Sentry webhook', {
        event: payload.action,
        issueId: payload.data?.issue?.id,
      });

      // Ignore comment webhooks to prevent processing loop
      if (payload.data?.comment_id) {
        logger.info('Ignoring comment webhook', { 
          commentId: payload.data.comment_id,
          issueId: payload.data.issue_id,
        });
        res.status(200).json({ status: 'ignored', reason: 'comment_webhook' });
        return;
      }

      // Debug: Log full payload structure to understand format
      logger.info('Webhook payload structure', { 
        keys: Object.keys(payload),
        action: payload.action,
        hasData: !!payload.data,
        dataKeys: payload.data ? Object.keys(payload.data) : [],
        hasIssue: !!payload.data?.issue,
        issueKeys: payload.data?.issue ? Object.keys(payload.data.issue) : [],
        payloadSample: JSON.stringify(payload).substring(0, 500),
      });

      if (payload.action === 'created' || payload.action === 'reopened') {
        const sentryError = this.parseSentryPayload(payload);
        
        if (sentryError) {
          // if (this.shouldFilterEvent(sentryError)) {
          //   logger.info('Filtering non-actionable event', {
          //     fingerprint: sentryError.fingerprint,
          //     level: sentryError.level,
          //     type: sentryError.type,
          //     file: sentryError.file,
          //   });
          //   res.status(200).json({ status: 'filtered', reason: 'non_actionable_event' });
          //   return;
          // }
          
          await this.processError(sentryError);
          res.status(200).json({ status: 'processing' });
        } else {
          logger.warn('Could not parse Sentry payload', {
            hasIssue: !!payload.data?.issue,
            hasEvent: !!payload.data?.event,
            issueKeys: payload.data?.issue ? Object.keys(payload.data.issue) : [],
          });
          res.status(400).json({ error: 'Invalid payload' });
        }
      } else {
        logger.debug('Ignoring webhook action', { action: payload.action });
        res.status(200).json({ status: 'ignored' });
      }
    } catch (error) {
      logger.error('Error handling webhook', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private verifySignature(req: Request): boolean {
    // Check for Sentry native webhook signature
    const sentrySignature = req.headers['sentry-hook-signature'] as string;
    const sentryTimestamp = req.headers['sentry-hook-timestamp'] as string;
    
    // Check for Octohook signature (may use different header)
    const octohookSignature = req.headers['x-octohook-signature'] as string;
    
    const signature = sentrySignature || octohookSignature;
    
    logger.debug('Webhook signature verification', {
      hasSentrySignature: !!sentrySignature,
      hasTimestamp: !!sentryTimestamp,
      hasOctohookSignature: !!octohookSignature,
      timestamp: sentryTimestamp,
      signaturePrefix: signature ? signature.substring(0, 10) : 'none',
    });
    
    if (!signature) {
      // If no signature verification is configured, allow in development
      if (process.env.NODE_ENV === 'development' && !config.sentry.webhookSecret) {
        logger.warn('Webhook signature verification disabled in development');
        return true;
      }
      logger.warn('No webhook signature found in headers');
      return false;
    }
    
    // Development bypass - Client Secret mismatch with Sentry webhook signature
    // For production, ensure SENTRY_WEBHOOK_SECRET matches the Client Secret from Sentry Internal Integration
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Webhook signature verification bypassed in development mode');
      return true;
    }

    // Sentry signature calculation: HMAC-SHA256(timestamp + body)
    // Use raw body to preserve exact formatting from Sentry
    const body = (req as any).rawBody || JSON.stringify(req.body);
    const payload = sentryTimestamp ? `${sentryTimestamp}${body}` : body;
    
    logger.debug('Signature calculation details', {
      bodyLength: body.length,
      payloadLength: payload.length,
      timestamp: sentryTimestamp,
      secretLength: config.sentry.webhookSecret.length,
      usingRawBody: !!(req as any).rawBody,
    });
    
    const hmac = crypto.createHmac('sha256', config.sentry.webhookSecret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
      
      if (!isValid) {
        logger.warn('Webhook signature mismatch', {
          received: signature,
          expected: expectedSignature,
          hasTimestamp: !!sentryTimestamp,
          timestamp: sentryTimestamp,
        });
      } else {
        logger.info('Webhook signature verified successfully');
      }
      
      return isValid;
    } catch (error) {
      logger.error('Signature verification failed', { error });
      return false;
    }
  }

  private parseSentryPayload(payload: any): SentryError | null {
    try {
      const issue = payload.data?.issue;
      const event = payload.data?.event;

      if (!issue) {
        logger.debug('No issue data in payload');
        return null;
      }

      logger.debug('Parsing issue data', {
        issueId: issue.id,
        title: issue.title,
        culprit: issue.culprit,
        metadata: issue.metadata,
        platform: issue.platform,
        level: issue.level,
      });

      // Internal Integration webhooks may not include event data
      // Extract what we can from the issue object
      const exception = event?.exception?.values?.[0];
      const stacktrace = exception?.stacktrace?.frames?.[0];

      // Extract error type and message from issue metadata or title
      const errorType = issue.metadata?.type || issue.type || 'Error';
      const errorMessage = issue.metadata?.value || issue.title || 'Unknown error';

      // Resolve GitHub repo and owner from Sentry project
      const projectSlug = issue.project?.slug || event?.project?.slug;
      const repoConfig = resolveRepo(projectSlug);

      const sentryError = {
        id: issue.id,
        fingerprint: issue.metadata?.fingerprint?.[0] || issue.id,
        type: errorType,
        message: errorMessage,
        stackTrace: this.formatStackTrace(exception?.stacktrace) || this.extractStackTraceFromCulprit(issue.culprit),
        file: stacktrace?.filename || this.extractFileFromCulprit(issue.culprit) || 'unknown',
        line: stacktrace?.lineno || 0,
        column: stacktrace?.colno,
        level: issue.level || 'error',
        environment: event?.environment || issue.platform || 'production',
        repo: repoConfig.repo,
        repoPath: this.extractRepoPath(stacktrace?.filename),
        owner: repoConfig.owner,
        tags: event?.tags || {},
        timestamp: Date.now(),
      };

      logger.debug('Successfully parsed Sentry error', {
        id: sentryError.id,
        type: sentryError.type,
        file: sentryError.file,
      });

      return sentryError;
    } catch (error) {
      logger.error('Error parsing Sentry payload', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }

  private formatStackTrace(stacktrace: any): string {
    if (!stacktrace?.frames) {
      return '';
    }

    return stacktrace.frames
      .map((frame: any) => {
        const file = frame.filename || 'unknown';
        const line = frame.lineno || 0;
        const func = frame.function || 'anonymous';
        return `  at ${func} (${file}:${line})`;
      })
      .join('\n');
  }

  private extractRepoPath(filename: string | undefined): string {
    if (!filename) {
      return '';
    }

    const parts = filename.split('/');
    const srcIndex = parts.findIndex(p => p === 'src' || p === 'lib' || p === 'app');
    
    if (srcIndex !== -1) {
      return parts.slice(srcIndex).join('/');
    }

    return filename;
  }

  private extractStackTraceFromCulprit(culprit: string | undefined): string {
    if (!culprit) {
      return '';
    }
    // Culprit format is usually: "module.function" or "file in function"
    return `  at ${culprit}`;
  }

  private extractFileFromCulprit(culprit: string | undefined): string {
    if (!culprit) {
      return 'unknown';
    }
    // Try to extract filename from culprit
    // Format could be: "path/to/file.js in functionName" or "module.function"
    const match = culprit.match(/^(.+?)\s+in\s+/);
    if (match) {
      return match[1];
    }
    // If no "in" keyword, return the whole culprit as file reference
    return culprit.split('.')[0] || culprit;
  }


  private async processError(error: SentryError): Promise<void> {
    logger.info('Processing Sentry error', {
      fingerprint: error.fingerprint,
      type: error.type,
      file: error.file,
    });

    const existingError = db.getError(error.fingerprint);

    if (existingError) {
      logger.debug('Error already exists, updating occurrence count');
      db.recordError({
        ...existingError,
        lastSeen: error.timestamp,
        occurrences: existingError.occurrences + 1,
      });
      
      if (existingError.status === 'fixed' || existingError.status === 'processing') {
        logger.debug('Error already processed, skipping');
        return;
      }
    } else {
      logger.debug('New error, recording in database');
      db.recordError({
        id: error.id,
        fingerprint: error.fingerprint,
        errorType: error.type,
        message: error.message,
        file: error.file,
        line: error.line,
        repo: error.repo,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        occurrences: 1,
        status: 'new',
      });
    }

    agentCore.processError(error).catch(err => {
      logger.error('Agent processing failed in background', { error: err });
    });
  }
}

export const webhookHandler = new WebhookHandler();

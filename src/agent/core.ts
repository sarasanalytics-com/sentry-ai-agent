import { SentryError, ActionResult } from '../types';
import { logger } from '../utils/logger';
import { db } from '../database/client';
import { ContextGatherer } from './context-gatherer';
import { AIAnalyzer } from './analyzer';
import { ActionExecutor } from './executor';
import { safetyValidator } from '../safety/validator';
import { circuitBreaker } from '../safety/circuit-breaker';
import { rateLimiter } from '../safety/rate-limiter';

const contextGatherer = new ContextGatherer();
const aiAnalyzer = new AIAnalyzer();
const actionExecutor = new ActionExecutor();

export class AgentCore {
  async processError(error: SentryError): Promise<ActionResult> {
    logger.info('Agent processing error', {
      fingerprint: error.fingerprint,
      type: error.type,
      file: error.file,
    });

    if (circuitBreaker.isOpen()) {
      logger.warn('Circuit breaker is open, rejecting request');
      return {
        success: false,
        reason: 'Circuit breaker is open',
      };
    }

    if (!rateLimiter.canProcessError()) {
      logger.warn('Rate limit exceeded for error processing');
      return {
        success: false,
        reason: 'Rate limit exceeded',
      };
    }

    rateLimiter.recordError();

    try {
      db.updateErrorStatus(error.fingerprint, 'processing');

      const context = await contextGatherer.gatherContext(error);
      logger.debug('Context gathered');

      const analysis = await aiAnalyzer.analyzeError(context);
      logger.debug('Analysis completed', { confidence: analysis.confidence });

      const fileChanges = analysis.affectedFiles.map(path => ({
        path,
        content: analysis.suggestedCode,
        linesChanged: analysis.linesChanged,
      }));

      const safetyCheck = safetyValidator.validateAnalysis(analysis, fileChanges);
      logger.debug('Safety check completed', { 
        valid: safetyCheck.valid, 
        recommendation: safetyCheck.recommendation 
      });

      if (!safetyCheck.valid) {
        logger.warn('Safety violations detected', { 
          violations: safetyCheck.violations 
        });
      }

      const result = await actionExecutor.executeAction(
        error,
        analysis,
        safetyCheck.recommendation
      );

      if (result.success) {
        db.updateErrorStatus(error.fingerprint, 'fixed');
        circuitBreaker.recordSuccess();
      } else {
        circuitBreaker.recordFailure();
      }

      logger.info('Agent processing completed', {
        fingerprint: error.fingerprint,
        success: result.success,
        action: safetyCheck.recommendation,
      });

      return result;
    } catch (err) {
      logger.error('Agent processing failed', { 
        fingerprint: error.fingerprint, 
        error: err instanceof Error ? {
          message: err.message,
          stack: err.stack,
          name: err.name,
        } : err,
        errorString: String(err),
      });

      circuitBreaker.recordFailure();
      db.updateErrorStatus(error.fingerprint, 'new');

      return {
        success: false,
        reason: `Processing failed: ${err}`,
      };
    }
  }
}

export const agentCore = new AgentCore();

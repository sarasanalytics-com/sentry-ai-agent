import { db } from '../database/client';
import { logger } from '../utils/logger';
import { Metrics } from '../types';

export class MetricsCollector {
  private startTime: number = Date.now();

  getMetrics(): Metrics {
    const allErrors = db.getRecentErrors(24 * 365);

    const totalErrorsProcessed = allErrors.length;
    
    const fixedErrors = allErrors.filter(e => e.status === 'fixed');
    const totalPRsCreated = fixedErrors.length;

    let totalPRsMerged = 0;
    let totalValidationsPassed = 0;
    let totalValidationsFailed = 0;
    let totalConfidence = 0;
    let totalProcessingTime = 0;
    let confidenceCount = 0;

    for (const error of allErrors) {
      const attempts = db.getFixAttempts(error.id);
      
      for (const attempt of attempts) {
        if (attempt.merged) {
          totalPRsMerged++;
        }
        
        if (attempt.validationPassed) {
          totalValidationsPassed++;
        } else if (attempt.validationErrors && attempt.validationErrors.length > 0) {
          totalValidationsFailed++;
        }

        totalConfidence += attempt.confidence;
        confidenceCount++;
      }
    }

    const averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;
    const averageProcessingTime = totalErrorsProcessed > 0 ? totalProcessingTime / totalErrorsProcessed : 0;

    const metrics: Metrics = {
      totalErrorsProcessed,
      totalPRsCreated,
      totalPRsMerged,
      totalTicketsCreated: totalErrorsProcessed,
      totalValidationsPassed,
      totalValidationsFailed,
      averageConfidence,
      averageProcessingTime,
      llmCostToday: 0,
    };

    logger.debug('Metrics collected', metrics);

    return metrics;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  getSuccessRate(): number {
    const metrics = this.getMetrics();
    if (metrics.totalPRsCreated === 0) return 0;
    return metrics.totalPRsMerged / metrics.totalPRsCreated;
  }

  getValidationSuccessRate(): number {
    const metrics = this.getMetrics();
    const total = metrics.totalValidationsPassed + metrics.totalValidationsFailed;
    if (total === 0) return 0;
    return metrics.totalValidationsPassed / total;
  }
}

export const metricsCollector = new MetricsCollector();

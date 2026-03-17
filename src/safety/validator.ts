import { config } from '../config';
import { logger } from '../utils/logger';
import { SafetyCheckResult, AIAnalysis, FileChange } from '../types';

export class SafetyValidator {
  validateAnalysis(analysis: AIAnalysis, fileChanges: FileChange[]): SafetyCheckResult {
    const violations: string[] = [];

    if (analysis.confidence < config.safety.minConfidenceForSuggestion) {
      violations.push(`Confidence too low: ${analysis.confidence} < ${config.safety.minConfidenceForSuggestion}`);
    }

    if (fileChanges.length > config.safety.maxFilesModified) {
      violations.push(`Too many files modified: ${fileChanges.length} > ${config.safety.maxFilesModified}`);
    }

    const totalLinesChanged = fileChanges.reduce((sum, fc) => sum + fc.linesChanged, 0);
    if (totalLinesChanged > config.safety.maxLinesChanged) {
      violations.push(`Too many lines changed: ${totalLinesChanged} > ${config.safety.maxLinesChanged}`);
    }

    for (const change of fileChanges) {
      const ext = this.getFileExtension(change.path);
      if (!config.safety.allowedExtensions.includes(ext)) {
        violations.push(`File extension not allowed: ${ext} in ${change.path}`);
      }

      const fileName = this.getFileName(change.path);
      if (config.safety.forbiddenFiles.includes(fileName)) {
        violations.push(`Forbidden file: ${fileName}`);
      }
    }

    if (!config.safety.allowedFixTypes.includes(analysis.fixType)) {
      violations.push(`Fix type not allowed: ${analysis.fixType}`);
    }

    const recommendation = this.getRecommendation(analysis, violations);

    logger.debug('Safety validation completed', {
      violations: violations.length,
      recommendation,
    });

    return {
      valid: violations.length === 0,
      violations,
      recommendation,
    };
  }

  private getRecommendation(
    analysis: AIAnalysis,
    violations: string[]
  ): 'create_pr' | 'create_suggestion' | 'create_ticket_only' {
    if (violations.length > 0) {
      return 'create_ticket_only';
    }

    // PR Safety Gate: confidence < 0.7 should not auto-create PRs
    if (analysis.confidence < 0.7) {
      logger.info('PR safety gate: confidence too low for automated PR', {
        confidence: analysis.confidence,
        threshold: 0.7,
      });
      return 'create_ticket_only';
    }

    if (analysis.confidence >= config.safety.minConfidenceForPR) {
      return 'create_pr';
    }

    if (analysis.confidence >= config.safety.minConfidenceForSuggestion) {
      return 'create_suggestion';
    }

    return 'create_ticket_only';
  }

  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }

  validateFileSize(content: string): boolean {
    const lines = content.split('\n').length;
    if (lines > config.safety.maxFileSize) {
      logger.warn('File too large for modification', { lines, max: config.safety.maxFileSize });
      return false;
    }
    return true;
  }
}

export const safetyValidator = new SafetyValidator();

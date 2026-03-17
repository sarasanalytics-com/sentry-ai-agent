import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationResult } from '../types';
import { localValidator } from './local-validator';
import { ciValidator } from './ci-validator';

export class CodeValidator {
  async validate(repo: string, prNumber?: number): Promise<ValidationResult> {
    if (!config.validation.enabled) {
      logger.debug('Validation disabled, skipping');
      return {
        valid: true,
        testsPass: true,
        lintPass: true,
        typeCheckPass: true,
        buildPass: true,
        errors: [],
        logs: 'Validation disabled',
      };
    }

    if (config.validation.mode === 'ci' && prNumber) {
      return this.validateWithCI(repo, prNumber);
    }

    return this.validateLocally(repo);
  }

  private async validateLocally(repo: string): Promise<ValidationResult> {
    logger.info('Running local validation', { repo });
    
    const repoPath = `/tmp/${repo}`;
    
    return localValidator.validate(repoPath);
  }

  private async validateWithCI(repo: string, prNumber: number): Promise<ValidationResult> {
    logger.info('Running CI validation', { repo, prNumber });
    
    return ciValidator.validate(repo, prNumber);
  }
}

export const codeValidator = new CodeValidator();

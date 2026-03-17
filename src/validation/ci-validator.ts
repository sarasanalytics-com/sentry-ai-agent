import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationResult } from '../types';

export class CIValidator {
  private octokit: Octokit;

  constructor() {
    this.octokit = new Octokit({
      auth: config.github.token,
    });
  }

  async validate(repo: string, prNumber: number): Promise<ValidationResult> {
    logger.info('Running CI validation', { repo, prNumber });

    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner: config.github.owner,
        repo,
        pull_number: prNumber,
      });

      const sha = pr.head.sha;

      await this.waitForChecks(repo, sha);

      const { data: checkRuns } = await this.octokit.checks.listForRef({
        owner: config.github.owner,
        repo,
        ref: sha,
      });

      const allPassed = checkRuns.check_runs.every(
        run => run.conclusion === 'success'
      );

      const failedChecks = checkRuns.check_runs
        .filter(run => run.conclusion !== 'success')
        .map(run => `${run.name}: ${run.conclusion}`);

      logger.info('CI validation completed', {
        allPassed,
        totalChecks: checkRuns.check_runs.length,
        failedChecks: failedChecks.length,
      });

      return {
        valid: allPassed,
        testsPass: allPassed,
        lintPass: allPassed,
        typeCheckPass: allPassed,
        buildPass: allPassed,
        errors: failedChecks,
        logs: failedChecks.join('\n'),
      };
    } catch (error) {
      logger.error('CI validation failed', { error });
      return {
        valid: false,
        testsPass: false,
        lintPass: false,
        typeCheckPass: false,
        buildPass: false,
        errors: ['CI validation error'],
        logs: String(error),
      };
    }
  }

  private async waitForChecks(repo: string, sha: string): Promise<void> {
    const maxWaitTime = config.validation.timeout;
    const pollInterval = 10000;
    let elapsed = 0;

    while (elapsed < maxWaitTime) {
      const { data: checkRuns } = await this.octokit.checks.listForRef({
        owner: config.github.owner,
        repo,
        ref: sha,
      });

      const allCompleted = checkRuns.check_runs.every(
        run => run.status === 'completed'
      );

      if (allCompleted) {
        logger.debug('All CI checks completed');
        return;
      }

      logger.debug('Waiting for CI checks to complete', {
        completed: checkRuns.check_runs.filter(r => r.status === 'completed').length,
        total: checkRuns.check_runs.length,
      });

      await new Promise(resolve => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
    }

    logger.warn('CI checks timeout', { elapsed });
  }
}

export const ciValidator = new CIValidator();

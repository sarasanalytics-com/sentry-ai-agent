import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationResult } from '../types';

const execAsync = promisify(exec);

export class LocalValidator {
  async validate(repoPath: string): Promise<ValidationResult> {
    logger.info('Running local validation', { repoPath });

    const results = await Promise.allSettled([
      config.validation.requireTestsPass ? this.runTests(repoPath) : Promise.resolve(true),
      config.validation.requireLintPass ? this.runLint(repoPath) : Promise.resolve(true),
      config.validation.requireTypeCheckPass ? this.runTypeCheck(repoPath) : Promise.resolve(true),
      config.validation.requireBuildPass ? this.runBuild(repoPath) : Promise.resolve(true),
    ]);

    const [testsResult, lintResult, typeCheckResult, buildResult] = results;

    const testsPass = testsResult.status === 'fulfilled' && testsResult.value;
    const lintPass = lintResult.status === 'fulfilled' && lintResult.value;
    const typeCheckPass = typeCheckResult.status === 'fulfilled' && typeCheckResult.value;
    const buildPass = buildResult.status === 'fulfilled' && buildResult.value;

    const errors: string[] = [];
    let logs = '';

    if (!testsPass) {
      errors.push('Tests failed');
      logs += testsResult.status === 'rejected' ? `Tests: ${testsResult.reason}\n` : '';
    }
    if (!lintPass) {
      errors.push('Lint failed');
      logs += lintResult.status === 'rejected' ? `Lint: ${lintResult.reason}\n` : '';
    }
    if (!typeCheckPass) {
      errors.push('Type check failed');
      logs += typeCheckResult.status === 'rejected' ? `TypeCheck: ${typeCheckResult.reason}\n` : '';
    }
    if (!buildPass) {
      errors.push('Build failed');
      logs += buildResult.status === 'rejected' ? `Build: ${buildResult.reason}\n` : '';
    }

    const valid = errors.length === 0;

    logger.info('Local validation completed', {
      valid,
      testsPass,
      lintPass,
      typeCheckPass,
      buildPass,
    });

    return {
      valid,
      testsPass,
      lintPass,
      typeCheckPass,
      buildPass,
      errors,
      logs,
    };
  }

  private async runTests(repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('npm test', {
        cwd: repoPath,
        timeout: config.validation.timeout,
      });
      logger.debug('Tests passed', { stdout: stdout.substring(0, 200) });
      return true;
    } catch (error: any) {
      logger.warn('Tests failed', { error: error.message });
      throw new Error(error.stderr || error.message);
    }
  }

  private async runLint(repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('npm run lint', {
        cwd: repoPath,
        timeout: config.validation.timeout,
      });
      logger.debug('Lint passed', { stdout: stdout.substring(0, 200) });
      return true;
    } catch (error: any) {
      logger.warn('Lint failed', { error: error.message });
      throw new Error(error.stderr || error.message);
    }
  }

  private async runTypeCheck(repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('npx tsc --noEmit', {
        cwd: repoPath,
        timeout: config.validation.timeout,
      });
      logger.debug('Type check passed', { stdout: stdout.substring(0, 200) });
      return true;
    } catch (error: any) {
      logger.warn('Type check failed', { error: error.message });
      throw new Error(error.stderr || error.message);
    }
  }

  private async runBuild(repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('npm run build', {
        cwd: repoPath,
        timeout: config.validation.timeout,
      });
      logger.debug('Build passed', { stdout: stdout.substring(0, 200) });
      return true;
    } catch (error: any) {
      logger.warn('Build failed', { error: error.message });
      throw new Error(error.stderr || error.message);
    }
  }
}

export const localValidator = new LocalValidator();

import { config } from '../config';
import { logger } from '../utils/logger';
import { CircuitBreakerState } from '../types';

export class CircuitBreaker {
  private state: CircuitBreakerState = {
    state: 'closed',
    failureCount: 0,
    lastCheckTime: Date.now(),
  };

  private totalAttempts = 0;
  private failedAttempts = 0;
  private validationFailures = 0;
  private totalValidations = 0;

  isOpen(): boolean {
    if (!config.circuitBreaker.enabled) {
      return false;
    }

    this.checkState();
    return this.state.state === 'open';
  }

  recordSuccess(): void {
    this.totalAttempts++;
    
    if (this.state.state === 'half-open') {
      logger.info('Circuit breaker: success in half-open state, closing circuit');
      this.state.state = 'closed';
      this.state.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.totalAttempts++;
    this.failedAttempts++;
    this.state.failureCount++;
    this.state.lastFailureTime = Date.now();

    const failureRate = this.failedAttempts / this.totalAttempts;

    if (failureRate >= config.circuitBreaker.failureThreshold) {
      this.openCircuit('High failure rate');
    }
  }

  recordValidationFailure(): void {
    this.totalValidations++;
    this.validationFailures++;

    const validationFailureRate = this.validationFailures / this.totalValidations;

    if (validationFailureRate >= config.circuitBreaker.validationFailureThreshold) {
      this.openCircuit('High validation failure rate');
    }
  }

  recordValidationSuccess(): void {
    this.totalValidations++;
  }

  private openCircuit(reason: string): void {
    if (this.state.state !== 'open') {
      logger.warn('Circuit breaker opened', { reason });
      this.state.state = 'open';
      this.state.lastFailureTime = Date.now();
    }
  }

  private checkState(): void {
    if (this.state.state === 'open') {
      const cooldownMs = config.circuitBreaker.cooldownMinutes * 60 * 1000;
      const timeSinceFailure = Date.now() - (this.state.lastFailureTime || 0);

      if (timeSinceFailure >= cooldownMs) {
        logger.info('Circuit breaker: cooldown period elapsed, entering half-open state');
        this.state.state = 'half-open';
        this.state.failureCount = 0;
      }
    }

    this.state.lastCheckTime = Date.now();
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  getMetrics(): {
    totalAttempts: number;
    failedAttempts: number;
    failureRate: number;
    validationFailures: number;
    validationFailureRate: number;
  } {
    return {
      totalAttempts: this.totalAttempts,
      failedAttempts: this.failedAttempts,
      failureRate: this.totalAttempts > 0 ? this.failedAttempts / this.totalAttempts : 0,
      validationFailures: this.validationFailures,
      validationFailureRate: this.totalValidations > 0 ? this.validationFailures / this.totalValidations : 0,
    };
  }

  reset(): void {
    logger.info('Circuit breaker reset');
    this.state = {
      state: 'closed',
      failureCount: 0,
      lastCheckTime: Date.now(),
    };
    this.totalAttempts = 0;
    this.failedAttempts = 0;
    this.validationFailures = 0;
    this.totalValidations = 0;
  }
}

export const circuitBreaker = new CircuitBreaker();

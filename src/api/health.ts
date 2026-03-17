import { Request, Response } from 'express';
import { config } from '../config';
import { db } from '../database/client';
import { logger } from '../utils/logger';
import { circuitBreaker } from '../safety/circuit-breaker';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  version: string;
  checks: {
    database: boolean;
    configuration: boolean;
    github: boolean;
  };
  uptime: number;
}

export class HealthCheck {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  async handle(_req: Request, res: Response): Promise<void> {
    try {
      const health = await this.getHealthStatus();
      
      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;

      res.status(statusCode).json(health);
    } catch (error) {
      logger.error('Health check failed', { error });
      res.status(503).json({
        status: 'unhealthy',
        timestamp: Date.now(),
        error: 'Health check failed',
      });
    }
  }

  private async getHealthStatus(): Promise<HealthStatus> {
    const checks = {
      database: this.checkDatabase(),
      configuration: this.checkConfiguration(),
      github: this.checkGitHub(),
    };

    const allHealthy = Object.values(checks).every(check => check === true);
    const someHealthy = Object.values(checks).some(check => check === true);

    const status = allHealthy ? 'healthy' : 
                  someHealthy ? 'degraded' : 'unhealthy';

    return {
      status,
      timestamp: Date.now(),
      version: '1.0.0',
      checks,
      uptime: Date.now() - this.startTime,
    };
  }

  private checkDatabase(): boolean {
    try {
      db.getRecentErrors(1);
      return true;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
    }
  }

  private checkConfiguration(): boolean {
    try {
      return !!(
        config.sentry.webhookSecret &&
        config.llm.openai.apiKey &&
        config.github.token
      );
    } catch (error) {
      logger.error('Configuration health check failed', { error });
      return false;
    }
  }

  private checkGitHub(): boolean {
    return !!(config.github.token && config.github.owner && config.github.defaultRepo);
  }

  async handleCircuitBreakerStatus(_req: Request, res: Response): Promise<void> {
    const state = circuitBreaker.getState();
    const metrics = circuitBreaker.getMetrics();
    
    res.json({
      circuitBreaker: {
        state: state.state,
        failureCount: state.failureCount,
        lastFailureTime: state.lastFailureTime,
        metrics,
      },
    });
  }

  async handleCircuitBreakerReset(_req: Request, res: Response): Promise<void> {
    circuitBreaker.reset();
    logger.info('Circuit breaker manually reset via API');
    
    res.json({
      success: true,
      message: 'Circuit breaker reset successfully',
      state: circuitBreaker.getState(),
    });
  }
}

export const healthCheck = new HealthCheck();

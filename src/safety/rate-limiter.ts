import { config } from '../config';
import { logger } from '../utils/logger';

interface RateLimitWindow {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private hourlyWindow: RateLimitWindow = {
    count: 0,
    resetTime: Date.now() + 60 * 60 * 1000,
  };

  private dailyWindow: RateLimitWindow = {
    count: 0,
    resetTime: Date.now() + 24 * 60 * 60 * 1000,
  };

  private errorWindow: RateLimitWindow = {
    count: 0,
    resetTime: Date.now() + 60 * 1000,
  };

  canCreatePR(): boolean {
    this.checkWindows();

    const hourlyLimit = config.safety.maxPRsPerHour;
    const dailyLimit = config.safety.maxPRsPerDay;

    if (this.hourlyWindow.count >= hourlyLimit) {
      logger.warn('Hourly PR limit reached', {
        count: this.hourlyWindow.count,
        limit: hourlyLimit,
      });
      return false;
    }

    if (this.dailyWindow.count >= dailyLimit) {
      logger.warn('Daily PR limit reached', {
        count: this.dailyWindow.count,
        limit: dailyLimit,
      });
      return false;
    }

    return true;
  }

  canProcessError(): boolean {
    this.checkWindows();

    const limit = config.safety.maxErrorsPerMinute;

    if (this.errorWindow.count >= limit) {
      logger.warn('Error processing rate limit reached', {
        count: this.errorWindow.count,
        limit,
      });
      return false;
    }

    return true;
  }

  recordPR(): void {
    this.checkWindows();
    this.hourlyWindow.count++;
    this.dailyWindow.count++;
    
    logger.debug('PR recorded', {
      hourly: this.hourlyWindow.count,
      daily: this.dailyWindow.count,
    });
  }

  recordError(): void {
    this.checkWindows();
    this.errorWindow.count++;
    
    logger.debug('Error recorded', {
      count: this.errorWindow.count,
    });
  }

  private checkWindows(): void {
    const now = Date.now();

    if (now >= this.hourlyWindow.resetTime) {
      this.hourlyWindow = {
        count: 0,
        resetTime: now + 60 * 60 * 1000,
      };
      logger.debug('Hourly window reset');
    }

    if (now >= this.dailyWindow.resetTime) {
      this.dailyWindow = {
        count: 0,
        resetTime: now + 24 * 60 * 60 * 1000,
      };
      logger.debug('Daily window reset');
    }

    if (now >= this.errorWindow.resetTime) {
      this.errorWindow = {
        count: 0,
        resetTime: now + 60 * 1000,
      };
      logger.debug('Error window reset');
    }
  }

  getStatus(): {
    hourly: { count: number; limit: number; resetIn: number };
    daily: { count: number; limit: number; resetIn: number };
    errors: { count: number; limit: number; resetIn: number };
  } {
    this.checkWindows();
    const now = Date.now();

    return {
      hourly: {
        count: this.hourlyWindow.count,
        limit: config.safety.maxPRsPerHour,
        resetIn: this.hourlyWindow.resetTime - now,
      },
      daily: {
        count: this.dailyWindow.count,
        limit: config.safety.maxPRsPerDay,
        resetIn: this.dailyWindow.resetTime - now,
      },
      errors: {
        count: this.errorWindow.count,
        limit: config.safety.maxErrorsPerMinute,
        resetIn: this.errorWindow.resetTime - now,
      },
    };
  }

  reset(): void {
    const now = Date.now();
    this.hourlyWindow = { count: 0, resetTime: now + 60 * 60 * 1000 };
    this.dailyWindow = { count: 0, resetTime: now + 24 * 60 * 60 * 1000 };
    this.errorWindow = { count: 0, resetTime: now + 60 * 1000 };
    logger.info('Rate limiter reset');
  }
}

export const rateLimiter = new RateLimiter();

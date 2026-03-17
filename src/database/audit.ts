import { v4 as uuidv4 } from 'uuid';
import { db } from './client';
import { logger } from '../utils/logger';
import { AuditLog } from '../types';
import { config } from '../config';

export class AuditLogger {
  async logAction(
    tool: string,
    action: string,
    params: any,
    execute: () => Promise<any>
  ): Promise<any> {
    if (!config.features.auditLogging) {
      return execute();
    }

    const id = uuidv4();
    const startTime = Date.now();

    const log: AuditLog = {
      id,
      timestamp: startTime,
      tool,
      action,
      params,
      status: 'started',
    };

    db.recordAuditLog(log);
    logger.debug('Action started', { tool, action });

    try {
      const result = await execute();
      const duration = Date.now() - startTime;

      db.recordAuditLog({
        ...log,
        result,
        status: 'success',
        duration,
      });

      logger.debug('Action completed', { tool, action, duration });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      db.recordAuditLog({
        ...log,
        status: 'failed',
        error: String(error),
        duration,
      });

      logger.error('Action failed', { tool, action, error, duration });

      throw error;
    }
  }

  getRecentLogs(limit: number = 100): AuditLog[] {
    return db.getAuditLogs(limit);
  }

  getLogsByTool(tool: string, limit: number = 100): AuditLog[] {
    return db.getAuditLogs(limit).filter(log => log.tool === tool);
  }

  getFailedLogs(limit: number = 100): AuditLog[] {
    return db.getAuditLogs(limit).filter(log => log.status === 'failed');
  }
}

export const auditLogger = new AuditLogger();

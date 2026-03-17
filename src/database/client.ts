import Database from 'better-sqlite3';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ErrorRecord, FixAttempt, AuditLog } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class DatabaseClient {
  private db: Database.Database;

  constructor() {
    const dbDir = path.dirname(config.database.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.database.path);
    this.initialize();
    logger.info('Database initialized', { path: config.database.path });
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS errors (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        error_type TEXT NOT NULL,
        message TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        repo TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        occurrences INTEGER DEFAULT 1,
        status TEXT DEFAULT 'new',
        UNIQUE(fingerprint)
      );

      CREATE TABLE IF NOT EXISTS fix_attempts (
        id TEXT PRIMARY KEY,
        error_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        confidence REAL NOT NULL,
        fix_type TEXT NOT NULL,
        code TEXT NOT NULL,
        pr_number INTEGER,
        pr_url TEXT,
        merged INTEGER DEFAULT 0,
        merged_at INTEGER,
        validation_passed INTEGER DEFAULT 0,
        validation_errors TEXT,
        FOREIGN KEY (error_id) REFERENCES errors(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        tool TEXT NOT NULL,
        action TEXT NOT NULL,
        params TEXT NOT NULL,
        result TEXT,
        status TEXT NOT NULL,
        error TEXT,
        duration INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_errors_status ON errors(status);
      CREATE INDEX IF NOT EXISTS idx_fix_attempts_error_id ON fix_attempts(error_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    `);
  }

  recordError(error: ErrorRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO errors (id, fingerprint, error_type, message, file, line, repo, first_seen, last_seen, occurrences, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        last_seen = excluded.last_seen,
        occurrences = occurrences + 1
    `);

    stmt.run(
      error.id,
      error.fingerprint,
      error.errorType,
      error.message,
      error.file,
      error.line,
      error.repo,
      error.firstSeen,
      error.lastSeen,
      error.occurrences,
      error.status
    );

    logger.debug('Error recorded', { fingerprint: error.fingerprint });
  }

  getError(fingerprint: string): ErrorRecord | null {
    const row = this.db
      .prepare('SELECT * FROM errors WHERE fingerprint = ?')
      .get(fingerprint);
    return row as ErrorRecord | null;
  }

  getErrorByFingerprint(fingerprint: string): ErrorRecord | null {
    return this.getError(fingerprint);
  }

  updateErrorStatus(fingerprint: string, status: ErrorRecord['status']): void {
    const stmt = this.db.prepare('UPDATE errors SET status = ? WHERE fingerprint = ?');
    stmt.run(status, fingerprint);
    logger.debug('Error status updated', { fingerprint, status });
  }

  recordFixAttempt(attempt: FixAttempt): void {
    const stmt = this.db.prepare(`
      INSERT INTO fix_attempts (
        id, error_id, timestamp, confidence, fix_type, code,
        pr_number, pr_url, merged, merged_at, validation_passed, validation_errors
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      attempt.id,
      attempt.errorId,
      attempt.timestamp,
      attempt.confidence,
      attempt.fixType,
      attempt.code,
      attempt.prNumber || null,
      attempt.prUrl || null,
      attempt.merged ? 1 : 0,
      attempt.mergedAt || null,
      attempt.validationPassed ? 1 : 0,
      attempt.validationErrors ? JSON.stringify(attempt.validationErrors) : null
    );

    logger.debug('Fix attempt recorded', { id: attempt.id });
  }

  getFixAttempts(errorId: string): FixAttempt[] {
    const stmt = this.db.prepare('SELECT * FROM fix_attempts WHERE error_id = ? ORDER BY timestamp DESC');
    const rows = stmt.all(errorId) as any[];

    return rows.map(row => ({
      id: row.id,
      errorId: row.error_id,
      timestamp: row.timestamp,
      confidence: row.confidence,
      fixType: row.fix_type,
      code: row.code,
      prNumber: row.pr_number,
      prUrl: row.pr_url,
      merged: row.merged === 1,
      mergedAt: row.merged_at,
      validationPassed: row.validation_passed === 1,
      validationErrors: row.validation_errors ? JSON.parse(row.validation_errors) : undefined,
    }));
  }

  recordAuditLog(log: AuditLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, timestamp, tool, action, params, result, status, error, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      log.id,
      log.timestamp,
      log.tool,
      log.action,
      JSON.stringify(log.params),
      log.result ? JSON.stringify(log.result) : null,
      log.status,
      log.error || null,
      log.duration || null
    );
  }

  getAuditLogs(limit: number = 100): AuditLog[] {
    const stmt = this.db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      tool: row.tool,
      action: row.action,
      params: JSON.parse(row.params),
      result: row.result ? JSON.parse(row.result) : undefined,
      status: row.status,
      error: row.error,
      duration: row.duration,
    }));
  }

  getRecentErrors(hours: number = 24): ErrorRecord[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const stmt = this.db.prepare('SELECT * FROM errors WHERE last_seen > ? ORDER BY last_seen DESC');
    const rows = stmt.all(cutoff) as any[];

    return rows.map(row => ({
      id: row.id,
      fingerprint: row.fingerprint,
      errorType: row.error_type,
      message: row.message,
      file: row.file,
      line: row.line,
      repo: row.repo,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      occurrences: row.occurrences,
      status: row.status,
    }));
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}

export const db = new DatabaseClient();

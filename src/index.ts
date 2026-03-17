import express, { Request, Response } from 'express';
import { config } from './config';
import { logger } from './utils/logger';
import { webhookHandler } from './api/webhook';
import { healthCheck } from './api/health';
import { githubWebhookHandler } from './api/webhooks/github';
import { manualTriggerHandler } from './api/manual-trigger';
import { initializeApp } from './init';

initializeApp();

const app = express();

// Preserve raw body for webhook signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

app.post('/webhook/sentry', (req: Request, res: Response) => webhookHandler.handleSentryWebhook(req, res));
app.post('/webhook/github', (req: Request, res: Response) => githubWebhookHandler.handleWebhook(req, res));
app.post('/api/process-issue', (req: Request, res: Response) => manualTriggerHandler.handleManualTrigger(req, res));

if (config.monitoring.healthCheckEnabled) {
  app.get(config.monitoring.healthCheckPath, (req: Request, res: Response) => healthCheck.handle(req, res));
  app.get('/admin/circuit-breaker', (req: Request, res: Response) => healthCheck.handleCircuitBreakerStatus(req, res));
  app.post('/admin/circuit-breaker/reset', (req: Request, res: Response) => healthCheck.handleCircuitBreakerReset(req, res));
}

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Sentry AI Agent',
    version: '1.0.0',
    status: 'running',
  });
});

const server = app.listen(config.port, () => {
  logger.info('Sentry AI Agent started', {
    port: config.port,
    environment: config.nodeEnv,
    mode: config.operationalMode,
  });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

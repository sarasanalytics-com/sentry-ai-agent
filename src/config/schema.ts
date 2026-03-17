import { z } from 'zod';

/**
 * Configuration schema with validation using Zod
 * All configuration is validated at startup to catch errors early
 */

export const ConfigSchema = z.object({
  // Core Settings
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().positive().default(3000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Sentry Configuration
  sentry: z.object({
    webhookSecret: z.string().min(1, 'Sentry webhook secret is required'),
    dsn: z.string().optional(),
  }),

  // AI/LLM Configuration
  llm: z.object({
    provider: z.enum(['openai', 'anthropic']).default('openai'),
    openai: z.object({
      apiKey: z.string().optional(),
      model: z.string().default('gpt-4'),
      maxTokens: z.coerce.number().int().positive().default(2000),
    }),
    anthropic: z.object({
      apiKey: z.string().optional(),
      model: z.string().default('claude-sonnet-4-20250514'),
      maxTokens: z.coerce.number().int().positive().default(8000),
    }),
    dailyBudget: z.coerce.number().positive().default(50),
    enableCaching: z.coerce.boolean().default(true),
  }),

  // GitHub Configuration
  github: z.object({
    token: z.string().min(1, 'GitHub token is required'),
    appId: z.string().optional(),
    appPrivateKey: z.string().optional(),
    installationId: z.string().optional(),
    owner: z.string().min(1, 'GitHub owner is required'),
    defaultRepo: z.string().min(1, 'GitHub default repo is required'),
    defaultBranch: z.string().default('dev'),
  }),

  // Repository Mapping (Sentry Project -> GitHub Repo)
  repoMapping: z.record(z.string(), z.object({
    repo: z.string(),
    branch: z.string().default('dev'),
  })).default({}),

  // ClickUp Configuration
  clickup: z.object({
    apiToken: z.string().optional(),
    workspaceId: z.string().optional(),
    spaceId: z.string().optional(),
    folderId: z.string().optional(),
    listId: z.string().optional(),
  }),

  // Slack Configuration
  slack: z.object({
    botToken: z.string().optional(),
    signingSecret: z.string().optional(),
    defaultChannel: z.string().default('#engineering-alerts'),
    webhookUrl: z.string().optional(),
  }),

  // Safety Constraints
  safety: z.object({
    maxFilesModified: z.coerce.number().int().positive().default(2),
    maxLinesChanged: z.coerce.number().int().positive().default(50),
    maxFileSize: z.coerce.number().int().positive().default(1000),
    minConfidenceForPR: z.coerce.number().min(0).max(1).default(0.85),
    minConfidenceForSuggestion: z.coerce.number().min(0).max(1).default(0.60),
    maxPRsPerHour: z.coerce.number().int().positive().default(5),
    maxPRsPerDay: z.coerce.number().int().positive().default(20),
    maxErrorsPerMinute: z.coerce.number().int().positive().default(10),
    allowedExtensions: z.array(z.string()).default(['.ts', '.tsx', '.js', '.jsx']),
    forbiddenFiles: z.array(z.string()).default([
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      '.env',
      '.env.local',
    ]),
    allowedFixTypes: z.array(z.string()).default([
      'null-check',
      'optional-chaining',
      'type-guard',
      'undefined-check',
    ]),
  }),

  // Code Validation Configuration
  validation: z.object({
    enabled: z.coerce.boolean().default(true),
    requireTestsPass: z.coerce.boolean().default(true),
    requireLintPass: z.coerce.boolean().default(true),
    requireTypeCheckPass: z.coerce.boolean().default(true),
    requireBuildPass: z.coerce.boolean().default(false),
    timeout: z.coerce.number().int().positive().default(300000), // 5 minutes
    mode: z.enum(['local', 'ci']).default('local'),
    ciWorkflow: z.string().default('ci.yml'),
  }),

  // Circuit Breaker Configuration
  circuitBreaker: z.object({
    enabled: z.coerce.boolean().default(true),
    failureThreshold: z.coerce.number().min(0).max(1).default(0.5),
    validationFailureThreshold: z.coerce.number().min(0).max(1).default(0.7),
    cooldownMinutes: z.coerce.number().int().positive().default(60),
  }),

  // Database Configuration
  database: z.object({
    path: z.string().default('./data/sentry-ai-agent.db'),
  }),

  // Feature Flags
  features: z.object({
    autoPRCreation: z.coerce.boolean().default(true),
    ticketCreation: z.coerce.boolean().default(true),
    slackNotifications: z.coerce.boolean().default(true),
    auditLogging: z.coerce.boolean().default(true),
  }),

  // Operational Mode
  operationalMode: z.enum(['ticket-only', 'suggestion', 'pr-creation']).default('pr-creation'),

  // Advanced Configuration
  advanced: z.object({
    timezone: z.string().default('UTC'),
    duplicateDetectionWindow: z.coerce.number().int().positive().default(24), // hours
    prAlwaysDraft: z.coerce.boolean().default(true),
    prRequireHumanReview: z.coerce.boolean().default(true),
    prAutoAssign: z.coerce.boolean().default(true),
    prDefaultReviewers: z.array(z.string()).default([]),
    retryMaxAttempts: z.coerce.number().int().positive().default(3),
    retryBackoffMs: z.coerce.number().int().positive().default(2000),
  }),

  // Monitoring & Observability
  monitoring: z.object({
    metricsEnabled: z.coerce.boolean().default(true),
    metricsPort: z.coerce.number().int().positive().default(9090),
    healthCheckEnabled: z.coerce.boolean().default(true),
    healthCheckPath: z.string().default('/health'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

import { config as dotenvConfig } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  // Load .env file
  dotenvConfig();

  // Parse comma-separated arrays
  const parseArray = (value: string | undefined): string[] => {
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
  };

  // Parse repository mapping from environment variable
  // Format: REPO_MAPPING=sentry-project:github-repo:branch,another-project:another-repo:branch
  const parseRepoMapping = (value: string | undefined): Record<string, { repo: string; branch: string }> => {
    if (!value) return {};
    const mapping: Record<string, { repo: string; branch: string }> = {};
    const entries = value.split(',').map(s => s.trim()).filter(Boolean);
    
    for (const entry of entries) {
      const [sentryProject, githubRepo, branch = 'dev'] = entry.split(':').map(s => s.trim());
      if (sentryProject && githubRepo) {
        mapping[sentryProject] = { repo: githubRepo, branch };
      }
    }
    
    return mapping;
  };

  // Build configuration object from environment variables
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL,

    sentry: {
      webhookSecret: process.env.SENTRY_WEBHOOK_SECRET,
      dsn: process.env.SENTRY_DSN,
    },

    llm: {
      provider: process.env.LLM_PROVIDER || 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
        maxTokens: process.env.OPENAI_MAX_TOKENS,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
        maxTokens: process.env.ANTHROPIC_MAX_TOKENS,
      },
      dailyBudget: process.env.LLM_DAILY_BUDGET,
      enableCaching: process.env.LLM_ENABLE_CACHING,
    },

    github: {
      token: process.env.GITHUB_TOKEN,
      appId: process.env.GITHUB_APP_ID,
      appPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId: process.env.GITHUB_INSTALLATION_ID,
      owner: process.env.GITHUB_OWNER,
      defaultRepo: process.env.GITHUB_DEFAULT_REPO,
      defaultBranch: process.env.GITHUB_DEFAULT_BRANCH || 'dev',
    },

    repoMapping: parseRepoMapping(process.env.REPO_MAPPING),

    clickup: {
      apiToken: process.env.CLICKUP_API_TOKEN,
      workspaceId: process.env.CLICKUP_WORKSPACE_ID,
      spaceId: process.env.CLICKUP_SPACE_ID,
      folderId: process.env.CLICKUP_FOLDER_ID,
      listId: process.env.CLICKUP_LIST_ID,
    },

    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      defaultChannel: process.env.SLACK_DEFAULT_CHANNEL,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
    },

    safety: {
      maxFilesModified: process.env.SAFETY_MAX_FILES_MODIFIED,
      maxLinesChanged: process.env.SAFETY_MAX_LINES_CHANGED,
      maxFileSize: process.env.SAFETY_MAX_FILE_SIZE,
      minConfidenceForPR: process.env.SAFETY_MIN_CONFIDENCE_FOR_PR,
      minConfidenceForSuggestion: process.env.SAFETY_MIN_CONFIDENCE_FOR_SUGGESTION,
      maxPRsPerHour: process.env.SAFETY_MAX_PRS_PER_HOUR,
      maxPRsPerDay: process.env.SAFETY_MAX_PRS_PER_DAY,
      maxErrorsPerMinute: process.env.SAFETY_MAX_ERRORS_PER_MINUTE,
      allowedExtensions: parseArray(process.env.SAFETY_ALLOWED_EXTENSIONS),
      forbiddenFiles: parseArray(process.env.SAFETY_FORBIDDEN_FILES),
      allowedFixTypes: parseArray(process.env.SAFETY_ALLOWED_FIX_TYPES),
    },

    validation: {
      enabled: process.env.VALIDATION_ENABLED,
      requireTestsPass: process.env.VALIDATION_REQUIRE_TESTS_PASS,
      requireLintPass: process.env.VALIDATION_REQUIRE_LINT_PASS,
      requireTypeCheckPass: process.env.VALIDATION_REQUIRE_TYPE_CHECK_PASS,
      requireBuildPass: process.env.VALIDATION_REQUIRE_BUILD_PASS,
      timeout: process.env.VALIDATION_TIMEOUT,
      mode: process.env.VALIDATION_MODE,
      ciWorkflow: process.env.VALIDATION_CI_WORKFLOW,
    },

    circuitBreaker: {
      enabled: process.env.CIRCUIT_BREAKER_ENABLED,
      failureThreshold: process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      validationFailureThreshold: process.env.CIRCUIT_BREAKER_VALIDATION_FAILURE_THRESHOLD,
      cooldownMinutes: process.env.CIRCUIT_BREAKER_COOLDOWN_MINUTES,
    },

    database: {
      path: process.env.DATABASE_PATH,
    },

    features: {
      autoPRCreation: process.env.FEATURE_AUTO_PR_CREATION,
      ticketCreation: process.env.FEATURE_TICKET_CREATION,
      slackNotifications: process.env.FEATURE_SLACK_NOTIFICATIONS,
      auditLogging: process.env.FEATURE_AUDIT_LOGGING,
    },

    operationalMode: process.env.OPERATIONAL_MODE,

    advanced: {
      timezone: process.env.TIMEZONE,
      duplicateDetectionWindow: process.env.DUPLICATE_DETECTION_WINDOW,
      prAlwaysDraft: process.env.PR_ALWAYS_DRAFT,
      prRequireHumanReview: process.env.PR_REQUIRE_HUMAN_REVIEW,
      prAutoAssign: process.env.PR_AUTO_ASSIGN,
      prDefaultReviewers: parseArray(process.env.PR_DEFAULT_REVIEWERS),
      retryMaxAttempts: process.env.RETRY_MAX_ATTEMPTS,
      retryBackoffMs: process.env.RETRY_BACKOFF_MS,
    },

    monitoring: {
      metricsEnabled: process.env.METRICS_ENABLED,
      metricsPort: process.env.METRICS_PORT,
      healthCheckEnabled: process.env.HEALTH_CHECK_ENABLED,
      healthCheckPath: process.env.HEALTH_CHECK_PATH,
    },
  };

  // Validate configuration
  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('❌ Configuration validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid configuration. Please check your .env file.');
  }

  return result.data;
}

// Export singleton config instance
export const config = loadConfig();

// Export type
export type { Config } from './schema.js';

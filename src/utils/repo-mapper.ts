import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * Repository mapping utility to resolve Sentry projects to GitHub repos
 */

export interface RepoConfig {
  repo: string;
  branch: string;
  owner: string;
}

/**
 * Resolve Sentry project slug to GitHub repository configuration
 * Supports pattern matching for environment-specific projects (e.g., saras-iq-test -> iq-webapp)
 */
export function resolveRepo(sentryProjectSlug: string): RepoConfig {
  if (!sentryProjectSlug) {
    logger.warn('No Sentry project slug provided, using default repo');
    return {
      repo: config.github.defaultRepo,
      branch: config.github.defaultBranch,
      owner: config.github.owner,
    };
  }

  // Normalize project slug (lowercase, trim)
  const normalizedSlug = sentryProjectSlug.toLowerCase().trim();

  // Check for exact match in mapping
  if (config.repoMapping[normalizedSlug]) {
    const mapping = config.repoMapping[normalizedSlug];
    logger.info('Resolved repo from exact mapping', {
      sentryProject: normalizedSlug,
      repo: mapping.repo,
      branch: mapping.branch,
    });
    return {
      repo: mapping.repo,
      branch: mapping.branch,
      owner: config.github.owner,
    };
  }

  // Check for pattern-based matching (e.g., saras-iq-test, saras-iq-prod, saras-iq-dev -> iq-webapp)
  for (const [pattern, mapping] of Object.entries(config.repoMapping)) {
    // Handle wildcard patterns like "saras-iq-*"
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`, 'i');
      if (regex.test(normalizedSlug)) {
        logger.info('Resolved repo from pattern matching', {
          sentryProject: normalizedSlug,
          pattern,
          repo: mapping.repo,
          branch: mapping.branch,
        });
        return {
          repo: mapping.repo,
          branch: mapping.branch,
          owner: config.github.owner,
        };
      }
    }
  }

  // Fallback to default repo
  logger.warn('No mapping found for Sentry project, using default repo', {
    sentryProject: normalizedSlug,
    defaultRepo: config.github.defaultRepo,
  });

  return {
    repo: config.github.defaultRepo,
    branch: config.github.defaultBranch,
    owner: config.github.owner,
  };
}

/**
 * Get all configured repository mappings
 */
export function getAllMappings(): Record<string, { repo: string; branch: string }> {
  return config.repoMapping;
}

/**
 * Validate that a Sentry project has a configured mapping
 */
export function hasMapping(sentryProjectSlug: string): boolean {
  const normalizedSlug = sentryProjectSlug.toLowerCase().trim();
  return !!config.repoMapping[normalizedSlug];
}

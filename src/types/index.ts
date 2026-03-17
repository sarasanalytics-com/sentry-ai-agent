/**
 * Core type definitions for the Sentry AI Agent
 */

// Sentry Error Types
export interface SentryError {
  id: string;
  fingerprint: string;
  type: string;
  message: string;
  stackTrace: string;
  file: string;
  line: number;
  column?: number;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  environment: string;
  repo: string;
  repoPath: string;
  owner: string;
  tags: Record<string, string>;
  timestamp: number;
  // Rich context from Sentry
  breadcrumbs?: SentryBreadcrumb[];
  user?: SentryUser;
  request?: SentryRequest;
  contexts?: Record<string, any>;
  extra?: Record<string, any>;
}

export interface SentryBreadcrumb {
  type: string;
  category: string;
  message?: string;
  level?: string;
  timestamp: number;
  data?: Record<string, any>;
}

export interface SentryUser {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
}

export interface SentryRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  data?: any;
  query_string?: string;
}

// AI Analysis Types
export interface AIAnalysis {
  rootCause: string;
  confidence: number; // 0-1
  fixType: string;
  suggestedCode: string;
  reasoning: string;
  tests?: string[];
  affectedFiles: string[];
  linesChanged: number;
}

// Validation Types
export interface ValidationResult {
  valid: boolean;
  testsPass: boolean;
  lintPass: boolean;
  typeCheckPass: boolean;
  buildPass: boolean;
  errors: string[];
  logs: string;
}

export interface FileChange {
  path: string;
  content: string;
  linesChanged: number;
}

// Safety Types
export interface SafetyCheckResult {
  valid: boolean;
  violations: string[];
  recommendation: 'create_pr' | 'create_suggestion' | 'create_ticket_only';
}

// MCP Types
export interface MCPServer {
  name: string;
  capabilities: string[];
  execute(action: string, params: any): Promise<any>;
  listTools(): Tool[];
  validateParams(action: string, params: any): boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

// GitHub Types
export interface GitHubPR {
  number: number;
  url: string;
  draft: boolean;
  branch: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
}

// ClickUp Types
export interface ClickUpTicket {
  id: string;
  url: string;
  status: string;
}

// Slack Types
export interface SlackMessage {
  success: boolean;
  timestamp: string;
  channel: string;
}

// Agent Types
export interface ErrorContext {
  error: SentryError;
  fileContent: string;
  repoMetadata: RepoMetadata;
  similarErrors?: SimilarError[];
}

export interface RepoMetadata {
  language: string;
  framework?: string;
  defaultBranch: string;
}

export interface SimilarError {
  id: string;
  message: string;
  fixType: string;
  success: boolean;
}

export interface ActionResult {
  success: boolean;
  reason?: string;
  prNumber?: number;
  prUrl?: string;
  ticketId?: string;
  ticketUrl?: string;
}

// Database Types
export interface AuditLog {
  id: string;
  timestamp: number;
  tool: string;
  action: string;
  params: any;
  result?: any;
  status: 'started' | 'success' | 'failed';
  error?: string;
  duration?: number;
}

export interface ErrorRecord {
  id: string;
  fingerprint: string;
  errorType: string;
  message: string;
  file: string;
  line: number;
  repo: string;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  status: 'new' | 'processing' | 'fixed' | 'ignored';
}

export interface FixAttempt {
  id: string;
  errorId: string;
  timestamp: number;
  confidence: number;
  fixType: string;
  code: string;
  prNumber?: number;
  prUrl?: string;
  merged: boolean;
  mergedAt?: number;
  validationPassed: boolean;
  validationErrors?: string[];
}

// Circuit Breaker Types
export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime?: number;
  lastCheckTime: number;
}

// Metrics Types
export interface Metrics {
  totalErrorsProcessed: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
  totalTicketsCreated: number;
  totalValidationsPassed: number;
  totalValidationsFailed: number;
  averageConfidence: number;
  averageProcessingTime: number;
  llmCostToday: number;
}

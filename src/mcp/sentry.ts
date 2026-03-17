import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { MCPServer, Tool } from '../types';

interface SentryIssue {
  id: string;
  title: string;
  status: string;
  level: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project?: {
    slug: string;
    name: string;
    [key: string]: any;
  };
  metadata?: any;
  type?: string;
  tags?: any[];
}

interface SentryEvent {
  id: string;
  message: string;
  platform: string;
  timestamp: string;
  tags: Record<string, string>;
  context: any;
}

export class SentryMCPServer implements MCPServer {
  name = 'sentry';
  capabilities = [
    'get_issue',
    'update_issue_status',
    'add_issue_comment',
    'get_issue_events',
    'get_event',
    'resolve_issue',
    'ignore_issue',
    'assign_issue',
    'add_tags',
  ];
  private client: AxiosInstance;

  constructor() {
    const authToken = process.env.SENTRY_AUTH_TOKEN || '';

    this.client = axios.create({
      baseURL: 'https://sentry.io/api/0',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  listTools(): Tool[] {
    return [
      {
        name: 'get_issue',
        description: 'Get detailed information about a Sentry issue',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
        ],
      },
      {
        name: 'update_issue_status',
        description: 'Update the status of a Sentry issue',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'status', type: 'string', required: true, description: 'Status: resolved, unresolved, ignored' },
        ],
      },
      {
        name: 'add_issue_comment',
        description: 'Add a comment to a Sentry issue',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'comment', type: 'string', required: true, description: 'Comment text' },
        ],
      },
      {
        name: 'get_issue_events',
        description: 'Get recent events for a Sentry issue',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'limit', type: 'number', required: false, description: 'Number of events to fetch' },
        ],
      },
      {
        name: 'get_event',
        description: 'Get full details of a specific event including stack traces',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'eventId', type: 'string', required: true, description: 'Event ID' },
        ],
      },
      {
        name: 'resolve_issue',
        description: 'Mark a Sentry issue as resolved',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'resolution', type: 'string', required: false, description: 'Resolution type' },
        ],
      },
      {
        name: 'ignore_issue',
        description: 'Ignore a Sentry issue',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
        ],
      },
      {
        name: 'assign_issue',
        description: 'Assign a Sentry issue to a user or team',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'assignee', type: 'string', required: true, description: 'User or team to assign' },
        ],
      },
      {
        name: 'add_tags',
        description: 'Add tags to a Sentry issue',
        parameters: [
          { name: 'issueId', type: 'string', required: true, description: 'Sentry issue ID' },
          { name: 'tags', type: 'object', required: true, description: 'Tags to add' },
        ],
      },
    ];
  }

  validateParams(action: string, params: any): boolean {
    const tool = this.listTools().find(t => t.name === action);
    if (!tool) return false;

    for (const param of tool.parameters) {
      if (param.required && !params[param.name]) {
        logger.warn('Missing required parameter', { action, param: param.name });
        return false;
      }
    }

    return true;
  }

  async execute(action: string, params: any): Promise<any> {
    switch (action) {
      case 'get_issue':
        return this.getIssue(params);
      case 'update_issue_status':
        return this.updateIssueStatus(params);
      case 'add_issue_comment':
        return this.addIssueComment(params);
      case 'get_issue_events':
        return this.getIssueEvents(params);
      case 'get_event':
        return this.getEvent(params);
      case 'resolve_issue':
        return this.resolveIssue(params);
      case 'ignore_issue':
        return this.ignoreIssue(params);
      case 'assign_issue':
        return this.assignIssue(params);
      case 'add_tags':
        return this.addTags(params);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async getIssue(params: { issueId: string }): Promise<SentryIssue> {
    const { issueId } = params;

    const response = await this.client.get(`/issues/${issueId}/`);
    const issue = response.data;

    logger.info('Sentry issue retrieved', { 
      issueId, 
      title: issue.title,
      projectSlug: issue.project?.slug,
    });

    return {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      level: issue.level,
      count: issue.count,
      userCount: issue.userCount,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      project: issue.project, // Include full project object
      metadata: issue.metadata, // Include metadata
      type: issue.type,
      tags: issue.tags,
    };
  }

  private async updateIssueStatus(params: {
    issueId: string;
    status: 'resolved' | 'unresolved' | 'ignored';
  }): Promise<void> {
    const { issueId, status } = params;

    await this.client.put(`/issues/${issueId}/`, {
      status,
    });

    logger.info('Sentry issue status updated', { issueId, status });
  }

  private async addIssueComment(params: {
    issueId: string;
    comment: string;
  }): Promise<void> {
    const { issueId, comment } = params;

    await this.client.post(`/issues/${issueId}/notes/`, {
      text: comment,
    });

    logger.info('Comment added to Sentry issue', { issueId });
  }

  private async getIssueEvents(params: {
    issueId: string;
    limit?: number;
  }): Promise<SentryEvent[]> {
    const { issueId, limit = 10 } = params;

    const response = await this.client.get(`/issues/${issueId}/events/`, {
      params: { limit },
    });
    
    // Debug: Log first event structure to understand what Sentry returns
    if (response.data && response.data.length > 0) {
      const firstEvent = response.data[0];
      logger.info('Sentry event structure', {
        hasEntries: !!firstEvent.entries,
        entriesCount: firstEvent.entries?.length || 0,
        entryTypes: firstEvent.entries?.map((e: any) => e.type) || [],
        hasException: firstEvent.entries?.some((e: any) => e.type === 'exception'),
      });
    }

    logger.info('Sentry issue events retrieved', { issueId, count: response.data.length });

    return response.data.map((event: any) => ({
      eventId: event.id,
      id: event.id,
      message: event.message,
      platform: event.platform,
      timestamp: event.dateCreated,
      tags: event.tags.reduce((acc: any, tag: any) => {
        acc[tag.key] = tag.value;
        return acc;
      }, {}),
      context: event.context,
    }));
  }

  private async getEvent(params: {
    issueId: string;
    eventId: string;
  }): Promise<any> {
    const { issueId, eventId } = params;

    const response = await this.client.get(`/issues/${issueId}/events/${eventId}/`);

    logger.info('Sentry event details retrieved', { 
      issueId, 
      eventId,
      hasEntries: !!response.data.entries,
      entriesCount: response.data.entries?.length || 0,
    });

    return response.data;
  }

  private async resolveIssue(params: {
    issueId: string;
    resolution?: string;
  }): Promise<void> {
    const { issueId, resolution = 'resolved' } = params;

    await this.client.put(`/issues/${issueId}/`, {
      status: 'resolved',
      statusDetails: { resolution },
    });

    logger.info('Sentry issue resolved', { issueId, resolution });
  }

  private async ignoreIssue(params: { issueId: string }): Promise<void> {
    const { issueId } = params;

    await this.client.put(`/issues/${issueId}/`, {
      status: 'ignored',
    });

    logger.info('Sentry issue ignored', { issueId });
  }

  private async assignIssue(params: {
    issueId: string;
    assignee: string;
  }): Promise<void> {
    const { issueId, assignee } = params;

    await this.client.put(`/issues/${issueId}/`, {
      assignedTo: assignee,
    });

    logger.info('Sentry issue assigned', { issueId, assignee });
  }

  private async addTags(params: {
    issueId: string;
    tags: Record<string, string>;
  }): Promise<void> {
    const { issueId, tags } = params;

    await this.client.post(`/issues/${issueId}/tags/`, {
      tags,
    });

    logger.info('Tags added to Sentry issue', { issueId, tags });
  }
}

export const sentryMCP = new SentryMCPServer();

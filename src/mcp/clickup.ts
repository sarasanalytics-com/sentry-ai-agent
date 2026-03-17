import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { MCPServer, Tool, ClickUpTicket } from '../types';

export class ClickUpMCPServer implements MCPServer {
  name = 'clickup';
  capabilities = ['create_task', 'update_task', 'get_task', 'add_comment'];
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: {
        Authorization: config.clickup.apiToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    // Add retry interceptor for transient failures
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        // Retry on network errors or 5xx server errors
        if (!config || !config.retry) {
          config.retry = 0;
        }
        
        const shouldRetry = 
          (error.code === 'ETIMEDOUT' || 
           error.code === 'ECONNRESET' ||
           error.code === 'ENOTFOUND' ||
           (error.response && error.response.status >= 500)) &&
          config.retry < 3;
        
        if (shouldRetry) {
          config.retry += 1;
          const delay = Math.min(1000 * Math.pow(2, config.retry), 5000); // Exponential backoff, max 5s
          
          logger.warn('Retrying ClickUp request', {
            attempt: config.retry,
            delay,
            error: error.code || error.message,
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.client.request(config);
        }
        
        throw error;
      }
    );
  }

  listTools(): Tool[] {
    return [
      {
        name: 'create_task',
        description: 'Create a new task in ClickUp',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Task name' },
          { name: 'description', type: 'string', required: true, description: 'Task description' },
          { name: 'priority', type: 'number', required: false, description: 'Priority (1-4)' },
          { name: 'tags', type: 'array', required: false, description: 'Task tags' },
        ],
      },
      {
        name: 'update_task',
        description: 'Update an existing task',
        parameters: [
          { name: 'taskId', type: 'string', required: true, description: 'Task ID' },
          { name: 'status', type: 'string', required: false, description: 'Task status' },
          { name: 'description', type: 'string', required: false, description: 'Task description' },
        ],
      },
      {
        name: 'get_task',
        description: 'Get task details',
        parameters: [
          { name: 'taskId', type: 'string', required: true, description: 'Task ID' },
        ],
      },
      {
        name: 'add_comment',
        description: 'Add a comment to a task',
        parameters: [
          { name: 'taskId', type: 'string', required: true, description: 'Task ID' },
          { name: 'comment', type: 'string', required: true, description: 'Comment text' },
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
      case 'create_task':
        return this.createTask(params);
      case 'update_task':
        return this.updateTask(params);
      case 'get_task':
        return this.getTask(params);
      case 'add_comment':
        return this.addComment(params);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async createTask(params: {
    name: string;
    description: string;
    priority?: number;
    tags?: string[];
  }): Promise<ClickUpTicket> {
    logger.info('Creating ClickUp task', { params });
    const { name, description, priority = 3, tags = [] } = params;

    const response = await this.client.post(`/list/${config.clickup.listId}/task`, {
      name,
      description,
      priority,
      tags,
    });

    const task = response.data;

    logger.info('ClickUp task created', { id: task.id, name });

    return {
      id: task.id,
      url: task.url,
      status: task.status.status,
    };
  }

  private async updateTask(params: {
    taskId: string;
    status?: string;
    description?: string;
  }): Promise<void> {
    const { taskId, status, description } = params;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (description) updateData.description = description;

    await this.client.put(`/task/${taskId}`, updateData);

    logger.info('ClickUp task updated', { taskId });
  }

  private async getTask(params: { taskId: string }): Promise<any> {
    const { taskId } = params;

    const response = await this.client.get(`/task/${taskId}`);

    logger.debug('ClickUp task retrieved', { taskId });

    return response.data;
  }

  private async addComment(params: { taskId: string; comment: string }): Promise<void> {
    const { taskId, comment } = params;

    await this.client.post(`/task/${taskId}/comment`, {
      comment_text: comment,
    });

    logger.info('Comment added to ClickUp task', { taskId });
  }
}

export const clickupMCP = new ClickUpMCPServer();

import { WebClient } from '@slack/web-api';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { MCPServer, Tool, SlackMessage } from '../types';

export class SlackMCPServer implements MCPServer {
  name = 'slack';
  capabilities = ['send_message', 'send_thread_reply', 'upload_file'];
  private client?: WebClient;
  private webhookUrl?: string;
  private useWebhook: boolean;

  constructor() {
    // Check if webhook URL is configured (simpler option)
    this.webhookUrl = config.slack.webhookUrl;
    this.useWebhook = !!this.webhookUrl;

    // Fall back to bot token if webhook not configured
    if (!this.useWebhook && config.slack.botToken) {
      this.client = new WebClient(config.slack.botToken);
    }

    if (!this.webhookUrl && !config.slack.botToken) {
      logger.warn('Slack not configured - neither webhook URL nor bot token provided');
    }
  }

  listTools(): Tool[] {
    return [
      {
        name: 'send_message',
        description: 'Send a message to a Slack channel',
        parameters: [
          { name: 'channel', type: 'string', required: true, description: 'Channel ID or name' },
          { name: 'text', type: 'string', required: true, description: 'Message text' },
          { name: 'blocks', type: 'array', required: false, description: 'Rich message blocks' },
        ],
      },
      {
        name: 'send_thread_reply',
        description: 'Reply to a message thread',
        parameters: [
          { name: 'channel', type: 'string', required: true, description: 'Channel ID' },
          { name: 'threadTs', type: 'string', required: true, description: 'Thread timestamp' },
          { name: 'text', type: 'string', required: true, description: 'Reply text' },
        ],
      },
      {
        name: 'upload_file',
        description: 'Upload a file to Slack',
        parameters: [
          { name: 'channel', type: 'string', required: true, description: 'Channel ID' },
          { name: 'content', type: 'string', required: true, description: 'File content' },
          { name: 'filename', type: 'string', required: true, description: 'File name' },
          { name: 'title', type: 'string', required: false, description: 'File title' },
        ],
      },
    ];
  }

  validateParams(action: string, params: any): boolean {
    const tool = this.listTools().find(t => t.name === action);
    if (!tool) return false;

    // When using webhook, channel parameter is not required
    if (this.useWebhook && action === 'send_message') {
      return !!params.text;
    }

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
      case 'send_message':
        return this.sendMessage(params);
      case 'send_thread_reply':
        return this.sendThreadReply(params);
      case 'upload_file':
        return this.uploadFile(params);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async sendWebhookMessage(params: { text: string; blocks?: any[] }): Promise<SlackMessage> {
    if (!this.webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    const response = await axios.post(this.webhookUrl, {
      text: params.text,
      blocks: params.blocks,
    }, {
      timeout: 10000, // 10 second timeout for Slack webhooks
    });

    logger.info('Slack webhook message sent', { status: response.status });

    return {
      success: response.status === 200,
      timestamp: Date.now().toString(),
      channel: 'webhook',
    };
  }

  private async sendMessage(params: {
    channel?: string;
    text: string;
    blocks?: any[];
  }): Promise<SlackMessage> {
    const { channel, text, blocks } = params;

    // Use webhook if configured (simpler option)
    if (this.useWebhook && this.webhookUrl) {
      return this.sendWebhookMessage({ text, blocks });
    }

    // Fall back to bot token
    if (!this.client) {
      throw new Error('Slack not configured - no webhook URL or bot token');
    }

    const result = await this.client.chat.postMessage({
      channel: channel || config.slack.defaultChannel || '',
      text,
      blocks,
    });

    logger.info('Slack message sent', { channel, ts: result.ts });

    return {
      success: true,
      timestamp: result.ts || '',
      channel: result.channel || channel || '',
    };
  }

  private async sendThreadReply(params: {
    channel: string;
    threadTs: string;
    text: string;
  }): Promise<SlackMessage> {
    const { channel, threadTs, text } = params;

    if (!this.client) {
      throw new Error('Slack bot token not configured - thread replies require bot token');
    }

    const result = await this.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text,
    });

    logger.info('Slack thread reply sent', { channel, ts: result.ts });

    return {
      success: true,
      timestamp: result.ts || '',
      channel: result.channel || channel,
    };
  }

  private async uploadFile(params: {
    channel: string;
    content: string;
    filename: string;
    title?: string;
  }): Promise<void> {
    const { channel, content, filename, title } = params;

    if (!this.client) {
      throw new Error('Slack bot token not configured - file uploads require bot token');
    }

    await this.client.files.uploadV2({
      channel_id: channel,
      file: Buffer.from(content),
      filename,
      title: title || filename,
    });

    logger.info('File uploaded to Slack', { channel, filename });
  }
}

export const slackMCP = new SlackMCPServer();

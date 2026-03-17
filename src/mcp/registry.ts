import { MCPServer } from '../types';
import { logger } from '../utils/logger';

export class MCPRegistry {
  private servers: Map<string, MCPServer> = new Map();

  register(server: MCPServer): void {
    this.servers.set(server.name, server);
    logger.info('MCP server registered', {
      name: server.name,
      capabilities: server.capabilities,
    });
  }

  get(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  listServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  async execute(serverName: string, action: string, params: any): Promise<any> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    if (!server.validateParams(action, params)) {
      throw new Error(`Invalid parameters for action: ${action}`);
    }

    logger.debug('Executing MCP action', { serverName, action, params });
    
    try {
      const result = await server.execute(action, params);
      logger.debug('MCP action completed', { serverName, action });
      return result;
    } catch (error) {
      logger.error('MCP action failed', { serverName, action, error });
      throw error;
    }
  }
}

export const mcpRegistry = new MCPRegistry();

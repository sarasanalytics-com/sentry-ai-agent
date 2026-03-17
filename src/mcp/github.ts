import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { logger } from '../utils/logger';
import { MCPServer, Tool, GitHubPR, GitHubBranch } from '../types';

export class GitHubMCPServer implements MCPServer {
  name = 'github';
  capabilities = ['create_branch', 'create_pr', 'get_file', 'update_file', 'list_files', 'search_code'];
  private octokit: Octokit;
  private defaultBranchCache: Map<string, string> = new Map();

  constructor() {
    this.octokit = new Octokit({
      auth: config.github.token,
    });
  }

  listTools(): Tool[] {
    return [
      {
        name: 'create_branch',
        description: 'Create a new branch from the default branch',
        parameters: [
          { name: 'repo', type: 'string', required: true, description: 'Repository name' },
          { name: 'branchName', type: 'string', required: true, description: 'New branch name' },
        ],
      },
      {
        name: 'create_pr',
        description: 'Create a pull request',
        parameters: [
          { name: 'repo', type: 'string', required: true, description: 'Repository name' },
          { name: 'title', type: 'string', required: true, description: 'PR title' },
          { name: 'body', type: 'string', required: true, description: 'PR description' },
          { name: 'head', type: 'string', required: true, description: 'Source branch' },
          { name: 'base', type: 'string', required: false, description: 'Target branch' },
          { name: 'draft', type: 'boolean', required: false, description: 'Create as draft' },
        ],
      },
      {
        name: 'get_file',
        description: 'Get file content from repository',
        parameters: [
          { name: 'repo', type: 'string', required: true, description: 'Repository name' },
          { name: 'path', type: 'string', required: true, description: 'File path' },
          { name: 'ref', type: 'string', required: false, description: 'Branch or commit ref' },
        ],
      },
      {
        name: 'update_file',
        description: 'Update a file in the repository',
        parameters: [
          { name: 'repo', type: 'string', required: true, description: 'Repository name' },
          { name: 'path', type: 'string', required: true, description: 'File path' },
          { name: 'content', type: 'string', required: true, description: 'New file content' },
          { name: 'message', type: 'string', required: true, description: 'Commit message' },
          { name: 'branch', type: 'string', required: true, description: 'Branch name' },
          { name: 'sha', type: 'string', required: false, description: 'File SHA (for updates)' },
        ],
      },
      {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: [
          { name: 'repo', type: 'string', required: true, description: 'Repository name' },
          { name: 'path', type: 'string', required: false, description: 'Directory path' },
          { name: 'ref', type: 'string', required: false, description: 'Branch or commit ref' },
        ],
      },
      {
        name: 'search_code',
        description: 'Search for code patterns across the repository',
        parameters: [
          { name: 'repo', type: 'string', required: true, description: 'Repository name' },
          { name: 'query', type: 'string', required: true, description: 'Search query/pattern' },
          { name: 'ref', type: 'string', required: false, description: 'Branch or commit ref' },
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
      case 'create_branch':
        return this.createBranch(params);
      case 'create_pr':
        return this.createPR(params);
      case 'get_file':
        return this.getFile(params);
      case 'update_file':
        return this.updateFile(params);
      case 'list_files':
        return this.listFiles(params);
      case 'search_code':
        return this.searchCode(params);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async getDefaultBranch(repo: string): Promise<string> {
    const cached = this.defaultBranchCache.get(repo);
    if (cached) return cached;

    const owner = config.github.owner;

    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      const defaultBranch = data.default_branch || 'main';
      this.defaultBranchCache.set(repo, defaultBranch);
      logger.info('Default branch detected from GitHub', { repo, branch: defaultBranch });
      return defaultBranch;
    } catch (error) {
      logger.warn('Failed to get default branch, trying common branches', { repo, error });
      
      for (const branch of ['main', 'master', 'develop', 'dev']) {
        try {
          await this.octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
          this.defaultBranchCache.set(repo, branch);
          logger.info('Found branch', { repo, branch });
          return branch;
        } catch {}
      }
      
      throw new Error(`Repository ${repo} has no commits or is inaccessible`);
    }
  }

  private async createBranch(params: { repo: string; branchName: string }): Promise<GitHubBranch> {
    const { repo, branchName } = params;
    const owner = config.github.owner;

    const defaultBranch = await this.getDefaultBranch(repo);
    const { data: ref } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });

    const { data: newRef } = await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });

    logger.info('Branch created', { repo, branchName });

    return {
      name: branchName,
      sha: newRef.object.sha,
    };
  }

  private async createPR(params: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base?: string;
    draft?: boolean;
  }): Promise<GitHubPR> {
    const { repo, title, body, head, draft = true } = params;
    const owner = config.github.owner;
    const base = params.base || await this.getDefaultBranch(repo);

    logger.info('Creating PR', { repo, head, base, providedBase: params.base });

    const { data: pr } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
      draft,
    });

    logger.info('PR created', { repo, number: pr.number, url: pr.html_url });

    return {
      number: pr.number,
      url: pr.html_url,
      draft: pr.draft || false,
      branch: head,
    };
  }

  private async getFile(params: { repo: string; path: string; ref?: string }): Promise<string> {
    const { repo, path } = params;
    const owner = config.github.owner;
    const ref = params.ref || await this.getDefaultBranch(repo);

    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error('Path is not a file');
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    logger.debug('File retrieved', { repo, path, size: content.length });

    return content;
  }

  private async updateFile(params: {
    repo: string;
    path: string;
    content: string;
    message: string;
    branch: string;
    sha?: string;
  }): Promise<void> {
    const { repo, path, content, message, branch, sha } = params;
    const owner = config.github.owner;

    let fileSha = sha;
    if (!fileSha) {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        if (!Array.isArray(data) && data.type === 'file') {
          fileSha = data.sha;
        }
      } catch (error) {
        logger.debug('File does not exist, will create new file');
      }
    }

    const contentBase64 = Buffer.from(content).toString('base64');

    await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: contentBase64,
      branch,
      sha: fileSha,
    });

    logger.info('File updated', { repo, path, branch });
  }

  private async listFiles(params: { repo: string; path?: string; ref?: string }): Promise<string[]> {
    const { repo, path = '' } = params;
    const owner = config.github.owner;
    const ref = params.ref || await this.getDefaultBranch(repo);

    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (!Array.isArray(data)) {
      return [data.name];
    }

    return data.map(item => item.path);
  }

  private async searchCode(params: { repo: string; query: string; ref?: string }): Promise<any[]> {
    const { repo, query } = params;
    const owner = config.github.owner;

    try {
      // GitHub code search API
      const searchQuery = `${query} repo:${owner}/${repo}`;
      
      logger.debug('Searching code in repository', { 
        repo, 
        query, 
        searchQuery 
      });

      const { data } = await this.octokit.search.code({
        q: searchQuery,
        per_page: 10,
      });

      logger.info('Code search completed', { 
        repo, 
        query, 
        totalCount: data.total_count,
        resultCount: data.items.length 
      });

      return data.items.map(item => ({
        path: item.path,
        name: item.name,
        sha: item.sha,
        url: item.html_url,
        repository: item.repository,
      }));
    } catch (error) {
      logger.error('Code search failed', { 
        repo, 
        query, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }
}

export const githubMCP = new GitHubMCPServer();

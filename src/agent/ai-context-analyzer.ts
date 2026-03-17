import { logger } from '../utils/logger';
import { config } from '../config';
import Anthropic from '@anthropic-ai/sdk';
import { SentryError } from '../types';

export interface ContextAnalysis {
  likelyComponent: string;
  likelyFilePath: string;
  alternativeFilePaths: string[];
  searchStrategy: {
    specificPatterns: string[];
    contextualPatterns: string[];
    technicalPatterns: string[];
  };
  userAction: string;
  reasoning: string;
  framework: string;
  routeAnalysis: {
    route: string;
    expectedComponentName: string;
    expectedDirectory: string;
  };
}

export class AIContextAnalyzer {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.llm.anthropic.apiKey,
    });
  }

  async analyzeErrorContext(error: SentryError): Promise<ContextAnalysis> {
    try {
      logger.info('Analyzing error context with AI', { fingerprint: error.fingerprint });

      const prompt = this.buildContextAnalysisPrompt(error);
      
      const response = await this.client.messages.create({
        model: config.llm.anthropic.model,
        max_tokens: 2000,
        temperature: 0.3,
        system: this.getSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from AI');
      }

      const analysis = this.parseContextAnalysis(content.text);
      
      logger.info('AI context analysis completed', {
        fingerprint: error.fingerprint,
        likelyComponent: analysis.likelyComponent,
        likelyFilePath: analysis.likelyFilePath,
        specificPatterns: analysis.searchStrategy.specificPatterns,
      });

      return analysis;
    } catch (err) {
      logger.error('AI context analysis failed', { 
        error: err instanceof Error ? err.message : err 
      });
      // Return fallback analysis
      return this.getFallbackAnalysis(error);
    }
  }

  private getSystemPrompt(): string {
    return `You are an expert software engineer analyzing production errors from Sentry.

Your task is to analyze the error context and determine:
1. What component/file is likely responsible
2. What the user was trying to do
3. The best search strategy to find the relevant code

You have deep knowledge of:
- Angular, React, Vue.js architectures
- Routing patterns (URL → Component → File mapping)
- RxJS, observables, and reactive programming
- Common error patterns and their causes

CRITICAL: Always respond with valid JSON only. No markdown, no code blocks, just raw JSON.`;
  }

  private buildContextAnalysisPrompt(error: SentryError): string {
    let prompt = `Analyze this production error and provide a detailed context analysis.

ERROR DETAILS:
- Type: ${error.type}
- Message: ${error.message}
- File: ${error.file}
- Line: ${error.line}
- Environment: ${error.environment}

STACK TRACE:
${error.stackTrace}

`;

    // Add URL/Route information
    if (error.request?.url) {
      const url = new URL(error.request.url);
      prompt += `ROUTE INFORMATION:
- Full URL: ${error.request.url}
- Path: ${url.pathname}
- Query: ${url.search}

`;
    }

    if (error.tags?.transaction) {
      prompt += `- Transaction: ${error.tags.transaction}\n\n`;
    }

    // Add breadcrumbs (user journey)
    if (error.breadcrumbs && error.breadcrumbs.length > 0) {
      prompt += `USER JOURNEY (Last 10 actions before error):\n`;
      const recentBreadcrumbs = error.breadcrumbs.slice(-10);
      recentBreadcrumbs.forEach((b, idx) => {
        const data = b.data ? JSON.stringify(b.data).substring(0, 100) : '';
        prompt += `${idx + 1}. [${b.category}] ${b.message || b.type} ${data}\n`;
      });
      prompt += '\n';
    }

    // Add user context
    if (error.user) {
      prompt += `USER CONTEXT:
- Email: ${error.user.email || 'N/A'}
- ID: ${error.user.id || 'N/A'}

`;
    }

    // Add framework context
    if (error.contexts?.angular) {
      prompt += `FRAMEWORK: Angular
Component: ${error.contexts.angular.componentName || 'Unknown'}

`;
    }

    prompt += `TASK:
Based on this information, analyze:

1. ROUTE ANALYSIS:
   - What is the route/URL path? (e.g., /admin-panel, /dashboard)
   - What component likely handles this route?
   - What is the typical file path for this component in the repository?
   - What directory structure is expected? (e.g., src/app/admin-panel/)

2. FUNCTION CONTEXT:
   - Extract the main function name from the stack trace
   - What does this function likely do based on its name?
   - What framework patterns does it use? (RxJS, observables, hooks, etc.)

3. USER ACTION:
   - What was the user trying to do when the error occurred?
   - What UI interaction triggered this? (navigation, click, form input, etc.)

4. SEARCH STRATEGY:
   - Specific patterns: Unique identifiers (function names, component names)
   - Contextual patterns: Route segments, feature names
   - Technical patterns: Error-specific code patterns (e.g., .pipe(, .map()

5. FILE DISCOVERY:
   - Most likely file path (be specific, e.g., src/app/admin-panel/admin-panel.component.ts)
   - Alternative file paths (2-3 other possibilities)
   - Expected directory based on route

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "likelyComponent": "ComponentName",
  "likelyFilePath": "src/app/path/to/component.ts",
  "alternativeFilePaths": ["src/app/alt1.ts", "src/app/alt2.ts"],
  "searchStrategy": {
    "specificPatterns": ["uniqueFunctionName", "ComponentName"],
    "contextualPatterns": ["route-segment", "feature-name"],
    "technicalPatterns": [".pipe(", "observable"]
  },
  "userAction": "Brief description of what user was doing",
  "reasoning": "Why you believe this is the correct file",
  "framework": "Angular|React|Vue|Unknown",
  "routeAnalysis": {
    "route": "/admin-panel",
    "expectedComponentName": "AdminPanelComponent",
    "expectedDirectory": "src/app/admin-panel"
  }
}`;

    return prompt;
  }

  private parseContextAnalysis(response: string): ContextAnalysis {
    try {
      // Remove markdown code blocks if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(cleaned);
      
      // Validate required fields
      if (!parsed.likelyComponent || !parsed.likelyFilePath || !parsed.searchStrategy) {
        throw new Error('Missing required fields in AI response');
      }

      return parsed as ContextAnalysis;
    } catch (err) {
      logger.error('Failed to parse AI context analysis', { 
        error: err instanceof Error ? err.message : err,
        response: response.substring(0, 500),
      });
      throw err;
    }
  }

  private getFallbackAnalysis(error: SentryError): ContextAnalysis {
    // Extract basic patterns as fallback
    const functionMatch = error.stackTrace?.match(/([a-zA-Z_$][a-zA-Z0-9_$]+)\s*\(/);
    const functionName = functionMatch ? functionMatch[1] : '';

    return {
      likelyComponent: 'Unknown',
      likelyFilePath: error.repoPath || error.file,
      alternativeFilePaths: [],
      searchStrategy: {
        specificPatterns: functionName ? [functionName] : [],
        contextualPatterns: [],
        technicalPatterns: [],
      },
      userAction: 'Unknown action',
      reasoning: 'Fallback analysis - AI analysis failed',
      framework: 'Unknown',
      routeAnalysis: {
        route: error.request?.url || '/',
        expectedComponentName: 'Unknown',
        expectedDirectory: '',
      },
    };
  }
}

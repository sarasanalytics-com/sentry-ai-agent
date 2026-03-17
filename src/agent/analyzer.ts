import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ErrorContext, AIAnalysis } from '../types';

export class AIAnalyzer {
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private provider: 'openai' | 'anthropic';

  constructor() {
    this.provider = config.llm.provider;
    
    if (this.provider === 'openai') {
      this.openai = new OpenAI({
        apiKey: config.llm.openai.apiKey,
      });
    } else {
      this.anthropic = new Anthropic({
        apiKey: config.llm.anthropic.apiKey,
      });
    }
  }

  async analyzeError(context: ErrorContext): Promise<AIAnalysis> {
    logger.info('Analyzing error with AI', { 
      fingerprint: context.error.fingerprint 
    });

    const prompt = this.buildPrompt(context);
    
    logger.debug('AI prompt built', {
      promptLength: prompt.length,
      hasBreadcrumbs: !!context.error.breadcrumbs,
      breadcrumbCount: context.error.breadcrumbs?.length || 0,
      hasFileContent: !!context.fileContent,
      fileContentLength: context.fileContent?.length || 0,
    });
    
    // Log full prompt for debugging (first 2000 chars)
    logger.debug('AI prompt preview', {
      prompt: prompt.substring(0, 2000),
    });

    try {
      let response: string;
      
      if (this.provider === 'openai' && this.openai) {
        const completion = await this.openai.chat.completions.create({
          model: config.llm.openai.model,
          messages: [
            {
              role: 'system',
              content: this.getSystemPrompt(),
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: config.llm.openai.maxTokens,
          temperature: 0.3,
        });
        response = completion.choices[0].message.content || '';
      } else if (this.provider === 'anthropic' && this.anthropic) {
        const completion = await this.anthropic.messages.create({
          model: config.llm.anthropic.model,
          max_tokens: config.llm.anthropic.maxTokens,
          temperature: 0.3,
          system: this.getSystemPrompt(),
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
        response = completion.content[0].type === 'text' ? completion.content[0].text : '';
      } else {
        throw new Error(`Invalid LLM provider: ${this.provider}`);
      }

      // Log AI response for debugging
      logger.debug('AI response received', {
        responseLength: response.length,
        responsePreview: response.substring(0, 500),
      });

      const analysis = this.parseAnalysis(response, context);

      logger.info('AI analysis completed', {
        confidence: analysis.confidence,
        fixType: analysis.fixType,
        linesChanged: analysis.linesChanged,
        rootCause: analysis.rootCause,
        reasoning: typeof analysis.reasoning === 'string' ? analysis.reasoning.substring(0, 200) : 'N/A',
      });

      return analysis;
    } catch (error) {
      logger.error('AI analysis failed', { 
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : error,
        errorString: String(error),
      });
      throw error;
    }
  }

  private getSystemPrompt(): string {
    return `You are a senior software engineer debugging a production error.

INSTRUCTIONS:

1. Identify the FIRST stack frame belonging to application code (ignore node_modules, vendor bundles, framework files).
2. Analyze the exact failing line marked with >>>.
3. Determine the root cause of the error.
4. Propose the minimal fix necessary.
5. Do NOT refactor unrelated code.
6. If stack trace or file context is incomplete, return low confidence.
7. If the file name is extremely short (e.g., "a", "ee", "t.js") or appears minified AND no source file mapping was provided, assume source maps are missing and return confidence <= 0.2.
8. If the file content comment says "Found in:" with a real source file path, the minified stack trace has been successfully mapped to source code. Judge confidence based on the SOURCE CODE quality, NOT the minified stack trace.

HALLUCINATION GUARD:
If the file content does not contain the failing line or the context is incomplete, DO NOT generate a fix. Return:
{
  "rootCause": "Insufficient context to determine the failure",
  "confidence": 0.2,
  "fixType": "other",
  "suggestedCode": "",
  "reasoning": "Stack trace or file content is incomplete",
  "affectedFiles": [],
  "linesChanged": 0
}

REASONING PROCESS (THINK STEP-BY-STEP):

Before generating your fix, answer these questions:

1. STACK TRACE ANALYSIS:
   - Which line in the stack trace is application code (not node_modules)?
   - What is the exact error message telling us?

2. CODE CONTEXT VERIFICATION:
   - Does the file content actually contain the line marked with >>>?
   - What is the actual code on that line?
   - What variables/functions are involved?

3. ROOT CAUSE IDENTIFICATION:
   - Why is this error happening? (Be specific, not generic)
   - What value is null/undefined/incorrect?
   - Is this a type error, runtime error, or logic error?

4. FIX VERIFICATION:
   - Will my proposed fix actually prevent this specific error?
   - Am I fixing the symptom or the root cause?
   - Could my fix introduce new bugs?

5. CONFIDENCE CHECK:
   - Do I have enough context to be confident? (If no → confidence < 0.3)
   - Is the stack trace minified WITHOUT source mapping? (If yes → confidence ≤ 0.2)
   - Was the minified code mapped to a real source file? (If yes → judge based on source code)
   - Does my fix make sense for this specific error? (If no → lower confidence)

OUTPUT FORMAT (JSON ONLY):
{
  "reasoning": {
    "stackTraceAnalysis": "Which frame is application code and what does the error mean",
    "codeVerification": "Confirmed the actual code on the error line",
    "rootCause": "Specific explanation of why this error occurs",
    "fixVerification": "Why this fix solves the root cause, not just symptoms",
    "confidenceJustification": "Why I am confident/uncertain about this fix"
  },
  "rootCause": "One-sentence summary of root cause",
  "confidence": 0.85,
  "fixType": "null-check|optional-chaining|type-guard|undefined-check|async-error-handling|promise-handling|index-boundary|object-property-check|api-error-handling|other",
  "suggestedCode": "The exact corrected version of the line marked with >>> and any surrounding lines needed for the fix",
  "affectedFiles": ["actual/file/path/from/error.ts"],
  "linesChanged": 5
}

CRITICAL RULES:
- THINK STEP-BY-STEP using the reasoning process above
- FIX THE ROOT CAUSE: If the error is "Cannot read properties of null", add null check IN THE FUNCTION that's failing, NOT in all the callers
- MINIMAL CHANGES: Only modify the minimal number of lines necessary to fix the error (usually 1-3 lines)
- The suggestedCode must include the exact corrected version of the line marked with >>>
- Use the ACTUAL file path from the error details, not placeholders
- If confidence < 0.7, the fix should be marked as advisory only
- DO NOT generate generic fixes - analyze the actual error and code
- DO NOT add defensive checks in caller functions - fix the actual function that's failing
- If you cannot answer the reasoning questions confidently, return low confidence

EXAMPLE OF GOOD FIX:
Error: "Cannot read properties of null (reading 'toLowerCase')"
Function: _normalizeValue
BAD: Add null checks in all 10 functions that call _normalizeValue ❌
GOOD: Add one null check in _normalizeValue itself: return value?.toLowerCase() || ''; ✅`;
  }

  private buildPrompt(context: ErrorContext): string {
    const { error, fileContent, similarErrors } = context;
    const isMinified = this.detectMinifiedStack(error.file);
    
    let prompt = `## ERROR INFORMATION

**Error Type:** ${error.type}
**Error Message:** ${error.message}
**File:** ${error.file}
**Line:** ${error.line}
**Environment:** ${error.environment}
`;

    // Add user context if available
    if (error.user) {
      prompt += `**User:** ${error.user.email || error.user.username || error.user.id || 'Unknown'}\n`;
    }

    // Add request context if available
    if (error.request) {
      prompt += `\n## REQUEST CONTEXT\n\n`;
      prompt += `**URL:** ${error.request.url}\n`;
      if (error.request.method) {
        prompt += `**Method:** ${error.request.method}\n`;
      }
      if (error.request.query_string) {
        prompt += `**Query:** ${error.request.query_string}\n`;
      }
    }

    // Add breadcrumbs for user flow context
    if (error.breadcrumbs && error.breadcrumbs.length > 0) {
      prompt += `\n## USER ACTIONS BEFORE ERROR (Breadcrumbs)\n\n`;
      const recentBreadcrumbs = error.breadcrumbs.slice(-10); // Last 10 breadcrumbs
      recentBreadcrumbs.forEach((b, idx) => {
        prompt += `${idx + 1}. [${b.category}] ${b.message || b.type}`;
        if (b.data) {
          const dataStr = JSON.stringify(b.data).substring(0, 100);
          prompt += ` - ${dataStr}`;
        }
        prompt += `\n`;
      });
      prompt += `\nThis shows the user's journey leading to the error. Use this to understand the context.\n`;
    }

    // Add tags for additional context
    if (error.tags && Object.keys(error.tags).length > 0) {
      prompt += `\n## TAGS\n\n`;
      Object.entries(error.tags).forEach(([key, value]) => {
        prompt += `**${key}:** ${value}\n`;
      });
    }

    prompt += `\n## STACK TRACE

\`\`\`
${error.stackTrace}
\`\`\`
`;

    if (isMinified && fileContent && fileContent.includes('// Found in:')) {
      prompt += `\n✅ NOTE: The stack trace contains minified code, but we have successfully mapped it to the original source file shown above. Judge your confidence based on the SOURCE CODE, not the minified stack trace.\n`;
    } else if (isMinified) {
      prompt += `\n⚠️ WARNING: Stack trace appears to contain minified code. Source maps may be missing.\n`;
    }

    if (fileContent) {
      prompt += `\n## FILE CONTENT (with error line marked)\n\n\`\`\`\n${fileContent}\n\`\`\`\n`;
    } else {
      prompt += `\n## FILE CONTENT\n\nFile content not available (404 or empty).\n`;
    }

    prompt += `\nAnalyze this error using ALL the context above (breadcrumbs, request, tags, stack trace, and file content) to provide a fix following the JSON format specified in the system prompt.`;

    if (similarErrors && similarErrors.length > 0) {
      prompt += `\nSimilar Errors Previously Fixed:
${similarErrors.map(e => `- ${e.message} (Fix: ${e.fixType}, Success: ${e.success})`).join('\n')}
`;
    }

    prompt += `\nProvide your analysis in JSON format.`;

    return prompt;
  }

  private detectMinifiedStack(filename: string): boolean {
    // Detect minified filenames: very short names, single letters, or common minified patterns
    if (!filename || filename === 'unknown') return false;
    
    const basename = filename.split('/').pop() || '';
    const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
    
    // Check for minified patterns
    const isVeryShort = nameWithoutExt.length <= 2; // e.g., "a", "ee", "t"
    const isSingleLetter = /^[a-z]$/i.test(nameWithoutExt); // e.g., "a.js"
    const hasMinifiedPattern = /^[a-z]{1,3}$|^\d+$|^chunk/i.test(nameWithoutExt); // e.g., "abc", "123", "chunk"
    
    return isVeryShort || isSingleLetter || hasMinifiedPattern;
  }

  private parseAnalysis(response: string, context: ErrorContext): AIAnalysis {
    try {
      logger.debug('Parsing AI response', {
        responseLength: response.length,
        responsePreview: response.substring(0, 200),
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('No JSON found in AI response', {
          response: response.substring(0, 500),
        });
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Log detailed reasoning if available (chain-of-thought)
      if (parsed.reasoning && typeof parsed.reasoning === 'object') {
        logger.info('AI reasoning chain', {
          stackTraceAnalysis: parsed.reasoning.stackTraceAnalysis,
          codeVerification: parsed.reasoning.codeVerification,
          rootCause: parsed.reasoning.rootCause,
          fixVerification: parsed.reasoning.fixVerification,
          confidenceJustification: parsed.reasoning.confidenceJustification,
        });
      }

      // Filter out placeholder/invalid paths and use actual error file path
      let affectedFiles = parsed.affectedFiles || [];
      
      // Remove placeholder paths like "path/to/file.ts" or "actual/file/path/from/error.ts"
      affectedFiles = affectedFiles.filter((path: string) => 
        !path.includes('path/to/') && 
        !path.includes('actual/file/path') &&
        path !== 'unknown' &&
        path.trim() !== ''
      );
      
      // If no valid files or only invalid paths, use the actual error file path
      if (affectedFiles.length === 0 && context.error.repoPath && context.error.repoPath !== 'unknown') {
        affectedFiles = [context.error.repoPath];
      }
      
      // If still no valid files, use error.file as fallback
      if (affectedFiles.length === 0 && context.error.file && context.error.file !== 'unknown') {
        affectedFiles = [context.error.file];
      }

      return {
        rootCause: parsed.rootCause || 'Unknown',
        confidence: Math.min(Math.max(parsed.confidence || 0, 0), 1),
        fixType: parsed.fixType || 'unknown',
        suggestedCode: parsed.suggestedCode || '',
        reasoning: parsed.reasoning || '',
        tests: parsed.tests,
        affectedFiles,
        linesChanged: parsed.linesChanged || 0,
      };
    } catch (error) {
      logger.error('Failed to parse AI response', { error, response });
      
      return {
        rootCause: 'Failed to parse AI response',
        confidence: 0,
        fixType: 'unknown',
        suggestedCode: '',
        reasoning: 'AI response parsing failed',
        affectedFiles: [context.error.repoPath],
        linesChanged: 0,
      };
    }
  }
}

export const aiAnalyzer = new AIAnalyzer();

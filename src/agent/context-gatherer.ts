import { SentryError, ErrorContext, RepoMetadata, SimilarError } from '../types';
import { mcpRegistry } from '../mcp/registry';
import { db } from '../database/client';
import { logger } from '../utils/logger';
import { config } from '../config';
import { AIContextAnalyzer, type ContextAnalysis } from './ai-context-analyzer';

export class ContextGatherer {
  private aiAnalyzer: AIContextAnalyzer;

  constructor() {
    this.aiAnalyzer = new AIContextAnalyzer();
  }

  async gatherContext(error: SentryError): Promise<ErrorContext> {
    logger.info('Gathering context for error', { fingerprint: error.fingerprint });
    console.log('context gatherer called', error);
    
    // PHASE 1: Use AI to analyze context for intelligent file discovery
    let aiContext: ContextAnalysis | null = null;
    try {
      aiContext = await this.aiAnalyzer.analyzeErrorContext(error);
      logger.info('AI context analysis completed', {
        likelyComponent: aiContext.likelyComponent,
        likelyFilePath: aiContext.likelyFilePath,
        userAction: aiContext.userAction,
        reasoning: aiContext.reasoning,
      });
    } catch (err) {
      logger.warn('AI context analysis failed, continuing with fallback', { 
        error: err instanceof Error ? err.message : err 
      });
    }

    const [fileContent, repoMetadata, similarErrors] = await Promise.all([
      this.getFileContent(error, aiContext),
      this.getRepoMetadata(error),
      this.getSimilarErrors(error),
      this.enrichFromSentry(error),
    ]);

    return {
      error,
      fileContent,
      repoMetadata,
      similarErrors,
    };
  }

  private async enrichFromSentry(error: SentryError): Promise<void> {
    console.log('enrichFromSentry called', error)
    try {
      const sentryMCP = mcpRegistry.get('sentry');
      if (!sentryMCP) {
        return;
      }

      const [issueDetails, recentEvents] = await Promise.all([
        mcpRegistry.execute('sentry', 'get_issue', { issueId: error.id }).catch(() => null),
        mcpRegistry.execute('sentry', 'get_issue_events', { issueId: error.id, limit: 5 }).catch(() => []),
      ]);

      if (issueDetails) {
        logger.debug('Enriched with Sentry issue details', {
          count: issueDetails.count,
          userCount: issueDetails.userCount,
        });
      }

      if (recentEvents && recentEvents.length > 0) {
        logger.debug('Retrieved recent Sentry events', { count: recentEvents.length });
      }
    } catch (err) {
      logger.warn('Failed to enrich from Sentry', { error: err });
    }
  }

  private async getFileContent(error: SentryError, aiContext: ContextAnalysis | null = null): Promise<string> {
    console.log('getFileContent called', error)
    
    // PHASE 1: Try AI-suggested file path first (if available)
    if (aiContext?.likelyFilePath) {
      logger.info('Trying AI-suggested file path', { 
        suggestedPath: aiContext.likelyFilePath,
        reasoning: aiContext.reasoning,
      });
      
      const aiResult = await this.tryAISuggestedPaths(error, aiContext);
      if (aiResult) {
        return aiResult;
      }
    }
    
    // PHASE 2: Try original repoPath if available
    if (!error.repoPath || error.repoPath.trim() === '') {
      logger.warn('Empty repoPath, attempting code search fallback', { 
        fingerprint: error.fingerprint,
        file: error.file 
      });
      return await this.searchForCodePattern(error, aiContext);
    }

    try {
      const content = await mcpRegistry.execute('github', 'get_file', {
        repo: error.repo,
        path: error.repoPath,
      });

      if (error.line && error.line > 0) {
        const lines = content.split('\n');
        const startLine = Math.max(0, error.line - 20);
        const endLine = Math.min(lines.length, error.line + 20);
        const relevantLines = lines.slice(startLine, endLine);
        
        const numberedLines = relevantLines.map((line: string, idx: number) => {
          const lineNum = startLine + idx + 1;
          const marker = lineNum === error.line ? '>>> ' : '    ';
          return `${marker}${lineNum}: ${line}`;
        }).join('\n');

        logger.debug('File content retrieved with context', { 
          file: error.repoPath,
          errorLine: error.line,
          contextLines: relevantLines.length
        });

        return numberedLines;
      }

      logger.debug('File content retrieved', { 
        file: error.repoPath, 
        size: content.length 
      });

      return content;
    } catch (err) {
      logger.error('Failed to get file content, attempting code search fallback', { 
        file: error.repoPath, 
        error: err 
      });
      return await this.searchForCodePattern(error, aiContext);
    }
  }

  private async tryAISuggestedPaths(error: SentryError, aiContext: ContextAnalysis): Promise<string | null> {
    // Try the most likely file path first
    try {
      const content = await mcpRegistry.execute('github', 'get_file', {
        repo: error.repo,
        path: aiContext.likelyFilePath,
      });
      
      logger.info('✓ AI-suggested file found!', { 
        file: aiContext.likelyFilePath,
        component: aiContext.likelyComponent,
      });
      
      // Update error object with the correct file path
      error.repoPath = aiContext.likelyFilePath;
      error.file = aiContext.likelyFilePath;
      
      return this.extractRelevantLines(content, error);
    } catch (err) {
      logger.debug('AI-suggested file not found, trying alternatives', { 
        suggestedPath: aiContext.likelyFilePath,
      });
    }
    
    // Try alternative paths suggested by AI
    for (const altPath of aiContext.alternativeFilePaths || []) {
      try {
        const content = await mcpRegistry.execute('github', 'get_file', {
          repo: error.repo,
          path: altPath,
        });
        
        logger.info('✓ Alternative AI-suggested file found!', { 
          file: altPath 
        });
        
        error.repoPath = altPath;
        error.file = altPath;
        
        return this.extractRelevantLines(content, error);
      } catch (err) {
        logger.debug('Alternative path not found', { path: altPath });
      }
    }
    
    return null;
  }

  private extractFunctionBody(lines: string[], startLineIndex: number): string[] {
    // Extract the complete function body by finding matching braces
    const functionLines: string[] = [lines[startLineIndex]];
    let braceCount = 0;
    let foundOpenBrace = false;
    let inString = false;
    let stringChar = '';
    
    // Process the first line character by character, handling strings
    const firstLine = lines[startLineIndex];
    for (let i = 0; i < firstLine.length; i++) {
      const char = firstLine[i];
      const prevChar = i > 0 ? firstLine[i - 1] : '';
      
      // Handle string literals (ignore braces inside strings)
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (char === '}') {
          braceCount--;
        }
      }
    }
    
    logger.debug('Function extraction started', {
      startLine: startLineIndex + 1,
      firstLine: firstLine.trim(),
      initialBraceCount: braceCount,
      foundOpenBrace,
    });
    
    // If we found the complete function on one line (arrow function)
    if (foundOpenBrace && braceCount === 0) {
      logger.debug('Single-line function detected');
      return functionLines;
    }
    
    // Otherwise, continue reading lines until we find the closing brace
    for (let i = startLineIndex + 1; i < lines.length && i < startLineIndex + 100; i++) {
      functionLines.push(lines[i]);
      
      inString = false;
      for (let j = 0; j < lines[i].length; j++) {
        const char = lines[i][j];
        const prevChar = j > 0 ? lines[i][j - 1] : '';
        
        // Handle string literals
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
        }
        
        if (!inString) {
          if (char === '{') {
            braceCount++;
            foundOpenBrace = true;
          } else if (char === '}') {
            braceCount--;
            if (foundOpenBrace && braceCount === 0) {
              // Found the closing brace of the function
              logger.debug('Function extraction completed', {
                endLine: i + 1,
                totalLines: functionLines.length,
                lastLine: lines[i].trim(),
              });
              return functionLines;
            }
          }
        }
      }
    }
    
    // If we didn't find the closing brace, return what we have (max 100 lines)
    logger.warn('Function extraction incomplete - closing brace not found', {
      linesExtracted: functionLines.length,
      finalBraceCount: braceCount,
    });
    return functionLines;
  }

  private extractRelevantLines(content: string, error: SentryError): string {
    const lines = content.split('\n');
    
    // Check if line number is from minified code (too large for source file)
    if (error.line && error.line > lines.length) {
      logger.info('Line number from minified code exceeds source file length, searching for function', {
        minifiedLine: error.line,
        sourceFileLines: lines.length,
        stackTrace: error.stackTrace?.substring(0, 200),
      });
      
      // Extract the EXACT function name from the first line of stack trace
      // Format: "ClassName.methodName" or just "functionName"
      const firstStackLine = error.stackTrace?.split('\n')[0]?.trim();
      const functionMatch = firstStackLine?.match(/^\d+\.\s+([a-zA-Z_$][\w.$]*)\s*\(/);
      
      if (functionMatch && functionMatch[1]) {
        const fullFunctionName = functionMatch[1]; // e.g., "AdminPanelComponent._normalizeValue"
        const methodName = fullFunctionName.split('.').pop() || fullFunctionName; // e.g., "_normalizeValue"
        
        logger.info('Searching for exact function from error', { 
          fullFunctionName, 
          methodName,
          errorMessage: error.message,
        });
        
        // Find the EXACT function definition (not callers)
        // Must match: "private _normalizeValue(" or "  _normalizeValue(" at start of line
        // Should NOT match: "this._normalizeValue(" or "const x = this._normalizeValue("
        const functionDefRegex = new RegExp(`^\\s*(private|public|protected|static)?\\s*${methodName}\\s*[(:=]`);
        const functionLineIndex = lines.findIndex(line => {
          const matches = functionDefRegex.test(line);
          // Extra check: make sure it's not a method call (no 'this.' or object reference before it)
          const isCall = line.includes(`this.${methodName}`) || line.includes(`.${methodName}`);
          return matches && !isCall;
        });
        
        if (functionLineIndex !== -1) {
          // Extract the complete function body
          const functionBody = this.extractFunctionBody(lines, functionLineIndex);
          
          logger.info('✓ Exact function found in source file', {
            functionName: methodName,
            startLine: functionLineIndex + 1,
            bodyLines: functionBody.length,
            firstLine: functionBody[0],
            lastLine: functionBody[functionBody.length - 1],
          });
          
          const numberedLines = functionBody.map((line: string, idx: number) => {
            const lineNum = functionLineIndex + idx + 1;
            const marker = idx === 0 ? '>>> ' : '    '; // Mark the function definition
            return `${marker}${lineNum}: ${line}`;
          }).join('\n');
          
          const result = `// ERROR: ${error.message}
// FUNCTION: ${fullFunctionName}
// INSTRUCTION: Fix the error IN THIS FUNCTION, not in the callers. Add null/undefined checks where needed.
// Original error was at minified line ${error.line}, mapped to this source function:

${numberedLines}`;

          logger.info('Function context prepared for AI', {
            contextLength: result.length,
            contextPreview: result.substring(0, 500),
          });
          
          return result;
        } else {
          logger.warn('Function definition not found, searching for any reference', { methodName });
          
          // Fallback: find any line with the method name
          const anyLineIndex = lines.findIndex(line => line.includes(methodName));
          if (anyLineIndex !== -1) {
            const startLine = Math.max(0, anyLineIndex - 10);
            const endLine = Math.min(lines.length, anyLineIndex + 30);
            const relevantLines = lines.slice(startLine, endLine);
            
            const numberedLines = relevantLines.map((line: string, idx: number) => {
              const lineNum = startLine + idx + 1;
              const marker = lineNum === anyLineIndex + 1 ? '>>> ' : '    ';
              return `${marker}${lineNum}: ${line}`;
            }).join('\n');
            
            return `// ERROR: ${error.message}\n// FUNCTION: ${fullFunctionName}\n// Note: Could not find exact function definition, showing context:\n\n${numberedLines}`;
          }
        }
      }
      
      // If we can't find the function, return the whole file with a note
      logger.warn('Could not find function in source file, returning full file', {
        errorLine: error.line,
        fileLines: lines.length,
      });
      
      return `// Note: Error line ${error.line} is from minified code. Source file has ${lines.length} lines.\n// Showing full source file:\n\n${content}`;
    }
    
    // Normal case: line number is valid for source file
    if (error.line && error.line > 0) {
      const startLine = Math.max(0, error.line - 20);
      const endLine = Math.min(lines.length, error.line + 20);
      const relevantLines = lines.slice(startLine, endLine);
      
      const numberedLines = relevantLines.map((line: string, idx: number) => {
        const lineNum = startLine + idx + 1;
        const marker = lineNum === error.line ? '>>> ' : '    ';
        return `${marker}${lineNum}: ${line}`;
      }).join('\n');

      logger.debug('File content retrieved with context', { 
        file: error.repoPath,
        errorLine: error.line,
        contextLines: relevantLines.length
      });

      return numberedLines;
    }

    logger.debug('File content retrieved', { 
      file: error.repoPath, 
      size: content.length 
    });

    return content;
  }

  private async searchForCodePattern(error: SentryError, aiContext: ContextAnalysis | null = null): Promise<string> {
    try {
      // Use AI-suggested patterns if available, otherwise extract from error
      const { specificPatterns, genericPatterns } = aiContext 
        ? this.extractPatternsFromAI(aiContext)
        : this.extractSearchPatterns(error);
      const allPatterns = [...specificPatterns, ...genericPatterns];
      
      if (allPatterns.length === 0) {
        logger.warn('No search patterns found in error', { fingerprint: error.fingerprint });
        return '';
      }

      logger.info('Searching for code patterns across repository', {
        fingerprint: error.fingerprint,
        specificPatterns,
        genericPatterns,
        repo: error.repo,
      });

      for (const pattern of specificPatterns) {
        try {
          const results = await mcpRegistry.execute('github', 'search_code', {
            repo: error.repo,
            query: pattern,
          });

          if (results && results.length > 0 && results.length <= 5) {
            logger.info('Specific pattern found - using as definitive match', {
              pattern,
              matchCount: results.length,
              files: results.map((r: any) => r.path),
            });

            const result = await this.getFileContentForMatch(error, results[0], pattern);
            if (result) return result;
          }
        } catch (searchErr) {
          logger.debug('Specific pattern search failed', { pattern, error: searchErr });
        }
      }

      logger.info('No specific match found, falling back to generic pattern scoring');
      const allMatches: Array<{ file: any; pattern: string; score: number }> = [];
      
      for (const pattern of genericPatterns) {
        try {
          const results = await mcpRegistry.execute('github', 'search_code', {
            repo: error.repo,
            query: pattern,
          });

          if (results && results.length > 0) {
            const patternScore = this.getPatternPriority(pattern);
            results.forEach((file: any) => {
              allMatches.push({ file, pattern, score: patternScore });
            });
          }
        } catch (searchErr) {
          logger.debug('Generic pattern search failed', { pattern, error: searchErr });
        }
      }

      if (allMatches.length === 0) {
        logger.warn('No code patterns found in repository', { 
          fingerprint: error.fingerprint,
          patterns: allPatterns 
        });
        return '';
      }

      const fileScores = new Map<string, number>();
      allMatches.forEach(match => {
        const path = match.file.path;
        const currentScore = fileScores.get(path) || 0;
        fileScores.set(path, currentScore + match.score);
      });

      const sortedFiles = Array.from(fileScores.entries())
        .sort((a, b) => b[1] - a[1]);

      logger.info('File scoring completed', {
        topFiles: sortedFiles.slice(0, 3).map(([path, score]) => ({ path, score })),
      });

      const bestMatch = allMatches.find(m => m.file.path === sortedFiles[0][0]);
      if (bestMatch) {
        const result = await this.getFileContentForMatch(error, bestMatch.file, bestMatch.pattern);
        return result || '';
      }

      return '';
    } catch (err) {
      logger.error('Code pattern search failed', { error: err });
      return '';
    }
  }

  private async getFileContentForMatch(error: SentryError, matchFile: any, pattern: string): Promise<string | null> {
    try {
      const content = await mcpRegistry.execute('github', 'get_file', {
        repo: error.repo,
        path: matchFile.path,
      });

      const lines = content.split('\n');
      let matchingLineIndex = lines.findIndex((line: string) => 
        line.includes(pattern) || this.fuzzyMatch(line, pattern)
      );

      if (matchingLineIndex !== -1) {
        const startLine = Math.max(0, matchingLineIndex - 20);
        const endLine = Math.min(lines.length, matchingLineIndex + 20);
        const relevantLines = lines.slice(startLine, endLine);

        const numberedLines = relevantLines.map((line: string, idx: number) => {
          const lineNum = startLine + idx + 1;
          const marker = lineNum === matchingLineIndex + 1 ? '>>> ' : '    ';
          return `${marker}${lineNum}: ${line}`;
        }).join('\n');

        const originalFile = error.file;
        error.repoPath = matchFile.path;
        error.file = matchFile.path;
        error.line = matchingLineIndex + 1;

        logger.info('Code pattern matched in file', {
          file: matchFile.path,
          line: matchingLineIndex + 1,
          pattern,
        });

        return `// Found in: ${matchFile.path}\n// Original minified file: ${originalFile}\n\n${numberedLines}`;
      }

      return null;
    } catch (err) {
      logger.debug('Failed to get file content for match', { file: matchFile.path, error: err });
      return null;
    }
  }

  private extractPatternsFromAI(aiContext: ContextAnalysis): { specificPatterns: string[]; genericPatterns: string[] } {
    logger.debug('Extracting patterns from AI analysis', {
      specificPatterns: aiContext.searchStrategy.specificPatterns,
      contextualPatterns: aiContext.searchStrategy.contextualPatterns,
    });

    return {
      specificPatterns: aiContext.searchStrategy.specificPatterns || [],
      genericPatterns: [
        ...(aiContext.searchStrategy.contextualPatterns || []),
        ...(aiContext.searchStrategy.technicalPatterns || []),
      ],
    };
  }

  private extractSearchPatterns(error: SentryError): { specificPatterns: string[]; genericPatterns: string[] } {
    const specificPatterns: string[] = [];
    const genericPatterns: string[] = [];

    if (error.message) {
      const errorPattern = error.message.split(':')[0]?.trim();
      if (errorPattern && errorPattern.length > 3) {
        genericPatterns.push(errorPattern);
      }

      const propertyMatch = error.message.match(/reading ['"]([^'"]+)['"]/);
      if (propertyMatch && propertyMatch[1]) {
        genericPatterns.push(`.${propertyMatch[1]}`);
      }
    }

    if (error.stackTrace) {
      const functionMatches = error.stackTrace.matchAll(/\d+\.\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g);
      for (const match of functionMatches) {
        const funcName = match[1];
        if (funcName && funcName.length > 2 && !['Object', 'Function', 'anonymous'].includes(funcName)) {
          specificPatterns.push(funcName);
        }
      }
    }

    if (error.breadcrumbs && error.breadcrumbs.length > 0) {
      error.breadcrumbs.slice(-5).forEach(breadcrumb => {
        if (breadcrumb.category === 'navigation' && breadcrumb.data?.to) {
          const route = breadcrumb.data.to.split('?')[0];
          const segments = route.split('/').filter((s: string) => s && s.length > 2);
          segments.forEach((segment: string) => {
            if (!segment.match(/^\d+$/)) {
              genericPatterns.push(segment);
            }
          });
        }
      });
    }

    if (error.tags) {
      Object.entries(error.tags).forEach(([, value]) => {
        if (typeof value === 'string' && value.length > 3 && !value.includes('http')) {
          genericPatterns.push(value);
        }
      });
    }

    if (error.type) {
      genericPatterns.push(error.type);
    }

    if (error.file && !error.file.includes('.min.') && !error.file.match(/^[a-z]\.js$/)) {
      genericPatterns.push(error.file.replace(/\.[^.]+$/, ''));
    }

    return {
      specificPatterns: [...new Set(specificPatterns)],
      genericPatterns: [...new Set(genericPatterns)],
    };
  }

  private getPatternPriority(pattern: string): number {
    if (pattern.startsWith('.')) return 3;
    if (pattern.match(/^[A-Z]/)) return 2;
    return 1;
  }

  private fuzzyMatch(line: string, pattern: string): boolean {
    const normalizedLine = line.toLowerCase().replace(/\s+/g, '');
    const normalizedPattern = pattern.toLowerCase().replace(/\s+/g, '');
    return normalizedLine.includes(normalizedPattern);
  }

  private async getRepoMetadata(error: SentryError): Promise<RepoMetadata> {
    console.log('getRepoMetadata called', error.repo)
    try {
      const files = await mcpRegistry.execute('github', 'list_files', {
        repo: error.repo,
      });

      const language = this.detectLanguage(files);
      const framework = this.detectFramework(files);

      return {
        language,
        framework,
        defaultBranch: config.github.defaultBranch,
      };
    } catch (err) {
      logger.debug('Failed to get repo metadata', { error: err });
      return {
        language: 'unknown',
        framework: 'unknown',
        defaultBranch: config.github.defaultBranch,
      };
    }
  }

  private detectLanguage(files: string[]): string {
    const ext = files[0]?.split('.').pop();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      py: 'python',
      java: 'java',
      go: 'go',
    };
    return languageMap[ext || ''] || 'unknown';
  }

  private detectFramework(files: string[]): string | undefined {
    if (!files) return undefined;
    if (files.some((f: string) => f.includes('angular.json'))) return 'angular';
    if (files.some((f: string) => f.includes('next.config'))) return 'nextjs';
    if (files.some((f: string) => f.includes('package.json'))) {
      if (files.some((f: string) => f.includes('react'))) return 'react';
      if (files.some((f: string) => f.includes('vue'))) return 'vue';
    }
    return undefined;
  }

  private async getSimilarErrors(error: SentryError): Promise<SimilarError[]> {
    const recentErrors = db.getRecentErrors(24);
    const similar = recentErrors.filter(
      (e: any) =>
        (e.repo === error.repo && e.error_type === error.type) ||
        (e.repo === error.repo && e.file === error.file && Math.abs(e.line - error.line) < 10)
    );

    return similar.map((e: any) => ({
      id: e.id,
      fingerprint: e.fingerprint,
      message: e.message,
      count: e.occurrences || 0,
      lastSeen: new Date(e.last_seen).toISOString(),
      fixType: 'unknown',
      success: false,
    }));
  }
}

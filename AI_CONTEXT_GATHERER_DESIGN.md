# AI-Powered Context Gatherer Design

## Problem Statement

Current context gathering is **mechanical pattern matching**. It doesn't leverage:
- URL routing information (we know the page where error occurred)
- User journey from breadcrumbs (what they were doing)
- AI's ability to reason about Angular/React architecture
- Semantic understanding of error context

## Proposed Solution: Multi-Stage AI Context Gathering

### Stage 1: AI-Powered Context Analysis

**Input to AI:**
```json
{
  "error": {
    "message": "Cannot read properties of undefined (reading 'pipe')",
    "stackTrace": "h.onEmailValueChange (/main.8250bcdd8faf9a17.js:400)",
    "url": "/admin-panel",
    "breadcrumbs": [
      {"category": "navigation", "data": {"to": "/admin-panel"}},
      {"category": "ui.click", "data": {"target": "email-filter"}},
      {"category": "xhr", "data": {"url": "/api/users"}}
    ],
    "tags": {
      "transaction": "/admin-panel"
    }
  },
  "framework": "Angular",
  "repo": "webapp"
}
```

**AI Task:**
```
Analyze this production error and determine:

1. ROUTE ANALYSIS:
   - What Angular route is this? (e.g., /admin-panel)
   - What component likely handles this route?
   - What is the typical file path for this component?

2. FUNCTION CONTEXT:
   - Function name: onEmailValueChange
   - What does this function likely do?
   - What Angular patterns does it use? (RxJS pipe, observables, etc.)

3. USER JOURNEY:
   - What was the user doing before the error?
   - What action triggered this? (navigation, click, form input?)

4. FILE DISCOVERY STRATEGY:
   - Search patterns (in priority order)
   - Expected file locations
   - Component naming conventions

OUTPUT (JSON):
{
  "likelyComponent": "AdminPanelComponent",
  "likelyFilePath": "src/app/admin-panel/admin-panel.component.ts",
  "searchStrategy": {
    "specificPatterns": ["onEmailValueChange", "AdminPanelComponent"],
    "contextualPatterns": ["admin-panel", "email filter"],
    "technicalPatterns": [".pipe(", "savedSourcesNames"]
  },
  "userAction": "User clicked email filter in admin panel",
  "reasoning": "The route /admin-panel + function onEmailValueChange suggests..."
}
```

### Stage 2: Intelligent File Search

Use AI's output to guide search:

```typescript
async searchWithAIGuidance(error: SentryError): Promise<string> {
  // 1. Ask AI to analyze context and suggest search strategy
  const aiAnalysis = await this.analyzeContextWithAI(error);
  
  // 2. Search using AI's suggested patterns in priority order
  const searchResults = await this.searchWithStrategy(
    aiAnalysis.searchStrategy
  );
  
  // 3. If AI suggested a specific file path, check it first
  if (aiAnalysis.likelyFilePath) {
    const fileExists = await this.checkFileExists(aiAnalysis.likelyFilePath);
    if (fileExists) {
      return await this.getFileContent(aiAnalysis.likelyFilePath);
    }
  }
  
  // 4. Use search results with AI's context understanding
  return await this.selectBestMatch(searchResults, aiAnalysis);
}
```

### Stage 3: Routing Intelligence

For Angular/React apps, use routing knowledge:

```typescript
async discoverFileFromRoute(url: string, framework: string): Promise<string[]> {
  // Ask AI: "In an Angular app, what files typically handle route /admin-panel?"
  const aiSuggestions = await this.askAI(`
    In an ${framework} application, the user was on route: ${url}
    
    What are the most likely file paths for the component handling this route?
    Consider common patterns like:
    - src/app/admin-panel/admin-panel.component.ts
    - src/app/pages/admin-panel/admin-panel.page.ts
    - src/components/AdminPanel/AdminPanel.tsx
    
    Return top 3 most likely paths based on the route.
  `);
  
  // Search for these files
  return aiSuggestions.likelyPaths;
}
```

### Stage 4: Breadcrumb Analysis

Use AI to understand user journey:

```typescript
async analyzeBreadcrumbs(breadcrumbs: Breadcrumb[]): Promise<ContextInsights> {
  const aiAnalysis = await this.askAI(`
    Analyze this user journey leading to an error:
    
    ${breadcrumbs.map((b, i) => `${i+1}. [${b.category}] ${b.message || b.type}`).join('\n')}
    
    Questions:
    1. What was the user trying to do?
    2. What UI component were they interacting with?
    3. What data was being loaded/modified?
    4. What files are likely involved?
    
    Provide specific file/component names if possible.
  `);
  
  return aiAnalysis;
}
```

## Example Flow for Issue 7329347868

### Current Approach:
```
1. Extract pattern: ".pipe("
2. Search code: 54 files match
3. Score by pattern priority
4. Pick first match (might be wrong file)
```

### AI-Powered Approach:
```
1. AI analyzes:
   - URL: /admin-panel
   - Function: onEmailValueChange
   - Breadcrumbs: User clicked email filter
   - Error: undefined.pipe() - RxJS observable issue

2. AI reasons:
   "This is an Angular component at /admin-panel route.
   Function onEmailValueChange handles email filter changes.
   Likely file: src/app/admin-panel/admin-panel.component.ts
   The error suggests savedSourcesNames observable is undefined."

3. Search strategy:
   Priority 1: Check if admin-panel.component.ts exists
   Priority 2: Search for "onEmailValueChange" (unique function)
   Priority 3: Search for "AdminPanelComponent"
   Priority 4: Fallback to ".pipe(" in admin-panel directory

4. Result: Correct file found immediately
```

## Implementation Plan

### Phase 1: Add AI Context Analyzer
```typescript
class AIContextAnalyzer {
  async analyzeErrorContext(error: SentryError): Promise<ContextAnalysis> {
    const prompt = this.buildContextAnalysisPrompt(error);
    const response = await this.callLLM(prompt);
    return this.parseContextAnalysis(response);
  }
}
```

### Phase 2: Enhance Context Gatherer
```typescript
class ContextGatherer {
  private aiAnalyzer: AIContextAnalyzer;
  
  async gatherContext(error: SentryError): Promise<ErrorContext> {
    // Step 1: AI analyzes the full context
    const aiContext = await this.aiAnalyzer.analyzeErrorContext(error);
    
    // Step 2: Use AI insights to guide file discovery
    const fileContent = await this.discoverFileWithAI(error, aiContext);
    
    // Step 3: Gather related context (similar errors, etc.)
    return {
      error,
      fileContent,
      aiInsights: aiContext,
      similarErrors: await this.findSimilarErrors(error),
    };
  }
}
```

### Phase 3: Route-Based Discovery
```typescript
async discoverFileWithAI(
  error: SentryError, 
  aiContext: ContextAnalysis
): Promise<string> {
  // 1. Try AI's suggested file path first
  if (aiContext.likelyFilePath) {
    const content = await this.tryGetFile(aiContext.likelyFilePath);
    if (content) return content;
  }
  
  // 2. Use route-based discovery
  if (error.request?.url) {
    const routeFiles = await this.discoverFromRoute(
      error.request.url,
      aiContext.framework
    );
    for (const file of routeFiles) {
      const content = await this.tryGetFile(file);
      if (content) return content;
    }
  }
  
  // 3. Fallback to intelligent pattern search
  return await this.searchWithAIStrategy(error, aiContext.searchStrategy);
}
```

## Benefits

1. **Semantic Understanding**: AI understands what the user was doing, not just pattern matching
2. **Route Intelligence**: Uses URL to find the right component
3. **Context Awareness**: Breadcrumbs inform file discovery
4. **Framework Knowledge**: AI knows Angular/React patterns
5. **Better Accuracy**: Finds correct file on first try
6. **Richer Context**: AI provides insights for better fixes

## Example Prompts

### Context Analysis Prompt:
```
You are analyzing a production error from a Sentry report.

ERROR DETAILS:
- Message: Cannot read properties of undefined (reading 'pipe')
- Stack: h.onEmailValueChange (/main.8250bcdd8faf9a17.js:400)
- URL: /admin-panel
- Framework: Angular

USER JOURNEY (Breadcrumbs):
1. [navigation] Navigated to /admin-panel
2. [ui.click] Clicked element: email-filter
3. [xhr] API call to /api/users
4. [ERROR] TypeError occurred

TASK:
Analyze this error and provide:
1. What component likely handles this route?
2. What is the expected file path?
3. What was the user trying to do?
4. What search patterns should we use to find the file?
5. What is the likely root cause?

Respond in JSON format.
```

## Next Steps

1. Implement `AIContextAnalyzer` class
2. Add route-to-file mapping intelligence
3. Enhance breadcrumb analysis
4. Test with real issues (7329347868, 7269289843)
5. Measure improvement in file discovery accuracy

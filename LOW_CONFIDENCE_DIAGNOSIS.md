# Low Confidence Diagnosis

## The Problem

```
[INFO] Mapped minified error to source file {
  "minifiedFile": "main.8250bcdd8faf9a17.js",
  "sourceFile": "src/app/account/services/subscription-business.service.ts",
  "sourceLine": 819
}
[INFO] Analyzing error with AI {"fingerprint":"7329347868"}
[INFO] AI analysis completed {"confidence":0.1,"fixType":"other","linesChanged":0}
```

**We successfully found the source file, but AI returns only 10% confidence!**

## Why This Happens

The AI returns low confidence when:

1. **No file content** - File was found but content couldn't be retrieved
2. **Empty file content** - GitHub API returned empty content
3. **Wrong line number** - Line 819 doesn't exist in the file
4. **Minified content** - We got the minified file content instead of source
5. **AI can't understand** - Content is there but AI can't parse it

## New Diagnostic Logging

I've added detailed logging to diagnose the issue:

### 1. Prompt Details
```
[DEBUG] AI prompt built {
  "promptLength": 15234,
  "hasBreadcrumbs": true,
  "breadcrumbCount": 47,
  "hasFileContent": true,  ← KEY: Is this true or false?
  "fileContentLength": 2500  ← KEY: Is this > 0?
}
```

### 2. Prompt Preview
```
[DEBUG] AI prompt preview {
  "prompt": "## ERROR INFORMATION\n\n**Error Type:** TypeError\n**Error Message:** Cannot read properties of undefined (reading 'pipe')\n**File:** main.8250bcdd8faf9a17.js\n**Line:** 819\n\n## FILE CONTENT (with error line marked)\n\n```\n    815: ...\n    816: ...\n>>> 819: ...\n```"
}
```

This shows if the AI is actually receiving the file content.

### 3. AI Response
```
[DEBUG] AI response received {
  "responseLength": 500,
  "responsePreview": "{\"rootCause\":\"Insufficient context...\""
}
```

### 4. Analysis Details
```
[INFO] AI analysis completed {
  "confidence": 0.1,
  "fixType": "other",
  "rootCause": "Insufficient context to determine the failure",
  "reasoning": "Stack trace shows minified production files..."
}
```

## Next Steps

### Step 1: Check the New Logs

Restart the server and run the test:
```bash
npm run dev
```

Then:
```bash
curl -X POST http://localhost:3000/api/process-issue \
  -H "Content-Type: application/json" \
  -d '{"url":"https://saras-analytics.sentry.io/issues/7329347868/"}'
```

### Step 2: Look for These Specific Logs

**Check 1: File Content Retrieved?**
```
[DEBUG] AI prompt built {
  "hasFileContent": ???,  ← Should be true
  "fileContentLength": ???  ← Should be > 0
}
```

If `hasFileContent: false` or `fileContentLength: 0`:
- **Problem**: File content not retrieved from GitHub
- **Fix**: Check GitHub API permissions, file path, branch

**Check 2: What's in the Prompt?**
```
[DEBUG] AI prompt preview {
  "prompt": "..."
}
```

Look for:
- Does it say "File content not available (404 or empty)"?
- Or does it show actual code with line numbers?

**Check 3: What's the AI Saying?**
```
[INFO] AI analysis completed {
  "rootCause": "???",
  "reasoning": "???"
}
```

The AI's reasoning will tell us exactly why it returned low confidence.

## Likely Scenarios

### Scenario 1: File Content is Empty

**Logs:**
```
hasFileContent: false
fileContentLength: 0
```

**Cause**: The code search found the file, but when we try to get the content, it fails.

**Why**: 
- File path mismatch (search found `src/app/...` but we're requesting `app/...`)
- Branch mismatch (file exists on `main` but we're checking `dev`)
- GitHub API error

**Fix**: Check the actual file retrieval in context-gatherer.ts

### Scenario 2: File Content is Minified

**Logs:**
```
hasFileContent: true
fileContentLength: 50000
AI reasoning: "Stack trace shows minified code"
```

**Cause**: We're getting the minified file content instead of source.

**Why**: The mapped source file path is wrong, or we're fetching from the wrong location.

**Fix**: Verify the file path mapping is correct.

### Scenario 3: Line Number Mismatch

**Logs:**
```
hasFileContent: true
AI reasoning: "File content does not contain the failing line"
```

**Cause**: Line 819 doesn't exist in the file, or the line numbers don't match.

**Why**: 
- Source file has different line numbers than minified
- We mapped to wrong file
- File has changed since error occurred

**Fix**: Adjust line number mapping or search for the actual code pattern.

### Scenario 4: AI Can't Parse the Code

**Logs:**
```
hasFileContent: true
fileContentLength: 2500
AI reasoning: "Cannot determine root cause from provided context"
```

**Cause**: File content is there but AI doesn't understand it.

**Why**:
- Code is too complex
- Missing imports/context
- Error message is too vague

**Fix**: Provide more context (imports, related functions, etc.)

## Testing the Fix

Once we see the logs, we can apply the appropriate fix:

### If File Content is Missing

Add logging to context-gatherer.ts to see why file retrieval fails:

```typescript
logger.info('Attempting to get file content', {
  repo: error.repo,
  path: error.repoPath,
  owner: error.owner,
});
```

### If Line Number is Wrong

Adjust the line number extraction or search for the code pattern instead:

```typescript
// Instead of using exact line number, search for the code pattern
const matchingLine = lines.findIndex(line => 
  line.includes('pipe') || line.includes('getDatonSubscriptionPlans')
);
```

### If AI Needs More Context

Expand the context window:

```typescript
// Instead of ±20 lines, get ±50 lines
const startLine = Math.max(0, error.line - 50);
const endLine = Math.min(lines.length, error.line + 50);
```

## Summary

**Current Status:**
- ✅ Code search works (found the file)
- ✅ File mapping works (mapped minified → source)
- ❌ AI analysis fails (10% confidence)

**Next Action:**
Run the test with new logging and check:
1. Is `hasFileContent` true?
2. Is `fileContentLength` > 0?
3. What does the AI's `reasoning` say?

Then we'll know exactly what to fix! 🔍

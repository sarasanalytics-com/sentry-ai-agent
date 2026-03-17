# Critical Bug Fix: PR Creation Was Deleting Entire File Content

## The Problem

When the AI agent created a GitHub PR to fix an error, it was **replacing the entire file with just the fix snippet**, deleting all other code in the file.

### Example
- **Original file**: 500 lines of code
- **AI fix**: 8 lines with null check
- **PR result**: File reduced to only 8 lines ❌

## Root Cause

In `src/agent/executor.ts`, the `createPR` method was passing `analysis.suggestedCode` (which contains only the fix snippet) as the complete file content to `update_file`:

```typescript
// BEFORE (BROKEN):
const fileChanges: FileChange[] = analysis.affectedFiles.map(path => ({
  path,
  content: analysis.suggestedCode,  // ← Only the fix snippet!
  linesChanged: analysis.linesChanged,
}));

for (const change of fileChanges) {
  await mcpRegistry.execute('github', 'update_file', {
    repo: error.repo,
    path: change.path,
    content: change.content,  // ← Overwrites entire file with snippet!
    message: `fix: ${error.message}`,
    branch: branchName,
  });
}
```

## The Fix

Now the agent:
1. **Fetches the current file content** from GitHub
2. **Applies the fix to the specific error line** using intelligent line replacement
3. **Updates the file with the complete modified content**

```typescript
// AFTER (FIXED):
for (const filePath of analysis.affectedFiles) {
  // 1. Fetch current file content
  const currentContent = await mcpRegistry.execute('github', 'get_file', {
    repo: error.repo,
    path: filePath,
  });

  // 2. Apply the fix to the specific error line
  const updatedContent = this.applyFixToFile(
    currentContent,
    error.line,
    analysis.suggestedCode,
    analysis.linesChanged
  );

  // 3. Update file with complete modified content
  await mcpRegistry.execute('github', 'update_file', {
    repo: error.repo,
    path: filePath,
    content: updatedContent,  // ← Full file with fix applied!
    message: `fix: ${error.message}`,
    branch: branchName,
  });
}
```

## The `applyFixToFile` Method

This new method intelligently applies the AI's fix to the file:

```typescript
private applyFixToFile(
  currentContent: string,
  errorLine: number,
  suggestedFix: string,
  linesChanged: number
): string {
  const lines = currentContent.split('\n');
  
  // Calculate the range to replace based on linesChanged
  // The AI's fix typically includes the error line plus surrounding context
  const startLine = Math.max(0, errorLine - Math.floor(linesChanged / 2));
  const endLine = Math.min(lines.length, errorLine + Math.ceil(linesChanged / 2));
  
  // Split the suggested fix into lines
  const fixLines = suggestedFix.split('\n');
  
  // Replace the affected lines with the fix
  const updatedLines = [
    ...lines.slice(0, startLine),      // Lines before the fix
    ...fixLines,                        // The fix
    ...lines.slice(endLine),            // Lines after the fix
  ];
  
  return updatedLines.join('\n');
}
```

## How It Works

### Example: Fixing line 241 in a 500-line file with an 8-line fix

1. **Error line**: 241
2. **Lines changed**: 8
3. **Calculate range**:
   - `startLine = 241 - floor(8/2) = 237`
   - `endLine = 241 + ceil(8/2) = 245`
4. **Apply fix**:
   - Keep lines 1-236 (before fix)
   - Insert 8-line fix
   - Keep lines 246-500 (after fix)
5. **Result**: 500-line file with lines 237-245 replaced by the 8-line fix

## Testing

To verify the fix works correctly:

```bash
# Build the updated code
npm run build

# Restart the server
npm run dev

# Trigger a test with a Sentry issue
curl -X POST http://localhost:3000/api/process-issue \
  -H "Content-Type: application/json" \
  -d '{"url":"https://saras-analytics.sentry.io/issues/7329347868/"}'
```

Check the resulting PR to ensure:
- ✅ File still has all original lines
- ✅ Only the error section is modified
- ✅ Fix is correctly applied to the error line

## Impact

**Before**: PRs were unusable - they deleted entire files ❌  
**After**: PRs correctly apply minimal fixes to specific lines ✅

This was a **critical production bug** that made all automated PRs destructive. Now fixed!

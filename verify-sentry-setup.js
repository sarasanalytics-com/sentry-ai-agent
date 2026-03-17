#!/usr/bin/env node
/**
 * Sentry Setup Verification Script
 * Checks if all required Sentry configurations are present
 */

require('dotenv').config();

const checks = {
  '✓ Sentry Webhook Secret': !!process.env.SENTRY_WEBHOOK_SECRET && process.env.SENTRY_WEBHOOK_SECRET !== 'your_sentry_webhook_secret_here',
  '✓ Sentry Auth Token (MCP)': !!process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_AUTH_TOKEN.startsWith('sntrys_'),
  '✓ Sentry Org Slug': !!process.env.SENTRY_ORG_SLUG && process.env.SENTRY_ORG_SLUG !== 'your-organization-slug',
  '✓ Sentry Project Slug': !!process.env.SENTRY_PROJECT_SLUG && process.env.SENTRY_PROJECT_SLUG !== 'your-project-slug',
};

console.log('\n🔍 Sentry Configuration Check\n');
console.log('━'.repeat(50));

let allPassed = true;
for (const [check, passed] of Object.entries(checks)) {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${check}`);
  if (!passed) allPassed = false;
}

console.log('━'.repeat(50));

if (allPassed) {
  console.log('\n✅ All Sentry configurations are set!\n');
  console.log('Next steps:');
  console.log('1. Start server: npm run dev');
  console.log('2. Configure Sentry webhook in Sentry.io');
  console.log('3. Trigger a test error in your app');
  console.log('4. Watch the agent process it!\n');
} else {
  console.log('\n❌ Some configurations are missing.\n');
  console.log('Please update your .env file with:');
  if (!checks['✓ Sentry Webhook Secret']) {
    console.log('  SENTRY_WEBHOOK_SECRET=7448da17314acbe0215ff4dd09d572474fcddd81c781bc967a3415816aa96dd6');
  }
  if (!checks['✓ Sentry Auth Token (MCP)']) {
    console.log('  SENTRY_AUTH_TOKEN=sntrys_your_token_from_sentry');
  }
  if (!checks['✓ Sentry Org Slug']) {
    console.log('  SENTRY_ORG_SLUG=your-org-slug');
  }
  if (!checks['✓ Sentry Project Slug']) {
    console.log('  SENTRY_PROJECT_SLUG=your-project-slug');
  }
  console.log('');
}

// Show what MCP servers will be available
console.log('📡 MCP Servers Status:\n');
console.log(`  GitHub MCP:  ✅ Always enabled`);
console.log(`  Sentry MCP:  ${checks['✓ Sentry Auth Token (MCP)'] ? '✅ Enabled' : '❌ Disabled (no auth token)'}`);
console.log(`  ClickUp MCP: ${process.env.CLICKUP_API_TOKEN ? '✅ Enabled' : '⚠️  Optional'}`);
console.log(`  Slack MCP:   ${process.env.SLACK_BOT_TOKEN ? '✅ Enabled' : '⚠️  Optional'}`);
console.log('');

#!/usr/bin/env node

/**
 * Sentry AI Agent - Issue Processor CLI
 * Usage: npm run process-issue <sentry-issue-url>
 */

import https from 'https';
import http from 'http';

const API_ENDPOINT = process.env.SENTRY_AGENT_API || 'http://localhost:3000';
const SENTRY_BASE_URL = process.env.SENTRY_BASE_URL || 'https://saras-analytics.sentry.io/issues';
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function usage() {
  console.log('Usage: npm run process-issue <issue-number-or-url>');
  console.log('');
  console.log('Examples:');
  console.log('  npm run process-issue 7269288997');
  console.log('  npm run process-issue https://saras-analytics.sentry.io/issues/7269288997/');
  console.log('');
  console.log('Environment Variables:');
  console.log('  SENTRY_AGENT_API - API endpoint (default: http://localhost:3000)');
  console.log('  SENTRY_BASE_URL - Sentry base URL (default: https://saras-analytics.sentry.io/issues)');
  process.exit(1);
}

async function processIssue(issueUrl) {
  const url = new URL(`${API_ENDPOINT}/api/process-issue`);
  const protocol = url.protocol === 'https:' ? https : http;

  const postData = JSON.stringify({ url: issueUrl });

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data,
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    log('Error: Issue number or URL is required', 'red');
    usage();
  }

  const input = args[0];
  let issueUrl;

  // Check if input is just a number or a full URL
  if (/^\d+$/.test(input)) {
    // Just a number, build the full URL
    issueUrl = `${SENTRY_BASE_URL}/${input}/`;
    log(`Building URL from issue number: ${input}`, 'blue');
  } else if (/^https?:\/\/.*sentry\.io\/issues\/\d+\/?$/.test(input)) {
    // Full URL provided
    issueUrl = input;
  } else {
    log('Error: Invalid input format', 'red');
    log('Expected: issue number (e.g., 7269288997) or full URL', 'yellow');
    usage();
  }

  log('Processing Sentry issue...', 'green');
  console.log(`URL: ${issueUrl}`);
  console.log(`API: ${API_ENDPOINT}`);
  console.log('');

  try {
    const response = await processIssue(issueUrl);

    if (response.statusCode === 200 || response.statusCode === 202) {
      log('✓ Success!', 'green');
      try {
        const json = JSON.parse(response.body);
        console.log(JSON.stringify(json, null, 2));
      } catch {
        console.log(response.body);
      }
    } else {
      log(`✗ Failed (HTTP ${response.statusCode})`, 'red');
      console.log(response.body);
      process.exit(1);
    }
  } catch (error) {
    log(`✗ Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

main();

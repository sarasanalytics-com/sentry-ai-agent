#!/bin/bash

# Sentry AI Agent - Issue Processor CLI
# Usage: ./process-issue.sh <issue-number-or-url>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default API endpoint and Sentry base URL
API_ENDPOINT="${SENTRY_AGENT_API:-http://localhost:3000}/api/process-issue"
SENTRY_BASE_URL="${SENTRY_BASE_URL:-https://saras-analytics.sentry.io/issues}"

# Function to display usage
usage() {
    echo "Usage: $0 <issue-number-or-url>"
    echo ""
    echo "Examples:"
    echo "  $0 7269288997"
    echo "  $0 https://saras-analytics.sentry.io/issues/7269288997/"
    echo ""
    echo "Environment Variables:"
    echo "  SENTRY_AGENT_API - API endpoint (default: http://localhost:3000)"
    echo "  SENTRY_BASE_URL - Sentry base URL (default: https://saras-analytics.sentry.io/issues)"
    exit 1
}

# Check if input is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Issue number or URL is required${NC}"
    usage
fi

INPUT="$1"

# Check if input is just a number or a full URL
if [[ "$INPUT" =~ ^[0-9]+$ ]]; then
    # Just a number, build the full URL
    ISSUE_URL="${SENTRY_BASE_URL}/${INPUT}/"
    echo -e "${BLUE}Building URL from issue number: ${INPUT}${NC}"
elif [[ "$INPUT" =~ ^https?://.*sentry\.io/issues/[0-9]+/?$ ]]; then
    # Full URL provided
    ISSUE_URL="$INPUT"
else
    echo -e "${RED}Error: Invalid input format${NC}"
    echo -e "${YELLOW}Expected: issue number (e.g., 7269288997) or full URL${NC}"
    usage
fi

echo -e "${GREEN}Processing Sentry issue...${NC}"
echo "URL: $ISSUE_URL"
echo "API: $API_ENDPOINT"
echo ""

# Make the API call
response=$(curl -s -w "\n%{http_code}" -X POST "$API_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$ISSUE_URL\"}")

# Extract HTTP status code and body
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

# Check response
if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 202 ]; then
    echo -e "${GREEN}✓ Success!${NC}"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ Failed (HTTP $http_code)${NC}"
    echo "$body"
    exit 1
fi

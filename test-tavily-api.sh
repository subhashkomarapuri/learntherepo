#!/bin/bash
# Simple test to verify Tavily integration is working
# This tests the Tavily search functionality directly

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Testing Tavily Integration Directly ===${NC}\n"

# Load environment variables
if [ -f "./supabase/.env" ]; then
    source <(grep -v '^#' ./supabase/.env | sed 's/^/export /')
fi

# Check if Tavily API key is set
if [ -z "$TAVILY_API_KEY" ] || [ "$TAVILY_API_KEY" == "your-tavily-api-key-here" ]; then
    echo -e "${RED}❌ TAVILY_API_KEY not set in supabase/.env${NC}"
    echo -e "${YELLOW}Please add your Tavily API key to supabase/.env${NC}"
    echo -e "${YELLOW}Get one from: https://www.tavily.com/${NC}"
    exit 1
fi

echo -e "${GREEN}✅ TAVILY_API_KEY configured${NC}\n"

# Test 1: Direct Tavily API call
echo -e "${YELLOW}Test 1: Direct Tavily API Call${NC}"
TAVILY_RESPONSE=$(curl -s -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"api_key\": \"$TAVILY_API_KEY\",
    \"query\": \"Supabase tutorial\",
    \"search_depth\": \"advanced\",
    \"max_results\": 3
  }")

# Check if successful
if echo "$TAVILY_RESPONSE" | jq -e '.results' > /dev/null 2>&1; then
    RESULT_COUNT=$(echo "$TAVILY_RESPONSE" | jq '.results | length')
    echo -e "${GREEN}✅ Tavily API working: Found $RESULT_COUNT results${NC}"
    echo -e "\nFirst result:"
    echo "$TAVILY_RESPONSE" | jq '.results[0]'
else
    echo -e "${RED}❌ Tavily API failed${NC}"
    echo "$TAVILY_RESPONSE" | jq '.'
    exit 1
fi

echo ""
echo -e "${GREEN}=== Tavily Integration Verified ===${NC}"
echo -e "${YELLOW}The Tavily search is working correctly!${NC}"
echo -e "${YELLOW}To test the full chat integration:${NC}"
echo -e "  1. Make sure a repository is processed (run ./test-chat.sh first)"
echo -e "  2. Then test chat with queries like 'search for latest updates'"

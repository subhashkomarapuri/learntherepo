#!/bin/bash
# Test script for Tavily integration in chat function

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CHAT_URL="http://127.0.0.1:54321/functions/v1/chat"
GITHUB_URL="https://github.com/octocat/Hello-World"
SESSION_ID=""

# Use the default local development anon key
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

# Get Supabase keys from status command
echo "Fetching Supabase configuration..."
SUPABASE_STATUS=$(sudo npx supabase status 2>/dev/null)
SUPABASE_ANON_KEY=$(echo "$SUPABASE_STATUS" | grep "Publishable key:" | awk '{print $NF}')

if [ -z "$SUPABASE_ANON_KEY" ]; then
    echo -e "${RED}❌ Failed to get Supabase publishable key${NC}"
    echo -e "${YELLOW}Make sure Supabase is running: sudo npx supabase start${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Supabase connection configured${NC}"

# Use the default local development anon key
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

# Load environment variables
if [ -f "./supabase/.env" ]; then
    export $(cat ./supabase/.env | grep -v '^#' | xargs)
fi

echo -e "${YELLOW}=== Tavily Integration Test Suite ===${NC}\n"

# Check if Tavily API key is set
if [ -z "$TAVILY_API_KEY" ] || [ "$TAVILY_API_KEY" == "your-tavily-api-key-here" ]; then
    echo -e "${RED}❌ TAVILY_API_KEY not set in supabase/.env${NC}"
    echo -e "${YELLOW}ℹ️  Tests will run but extended reading and web search will be disabled${NC}\n"
else
    echo -e "${GREEN}✅ TAVILY_API_KEY configured${NC}\n"
fi

# Test 1: Initialize Chat Session
echo -e "${YELLOW}Test 1: Initialize Chat Session${NC}"
INIT_RESPONSE=$(curl -s -X POST "$CHAT_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"init\",
    \"githubUrl\": \"$GITHUB_URL\",
    \"ref\": \"main\"
  }")

SESSION_ID=$(echo "$INIT_RESPONSE" | jq -r '.sessionId')

if [ "$SESSION_ID" != "null" ] && [ -n "$SESSION_ID" ]; then
    echo -e "${GREEN}✅ Session created: $SESSION_ID${NC}\n"
else
    echo -e "${RED}❌ Failed to create session${NC}"
    echo "$INIT_RESPONSE" | jq '.'
    exit 1
fi

# Test 2: Generate Summary with Extended Reading
echo -e "${YELLOW}Test 2: Generate Summary (with Extended Reading if Tavily configured)${NC}"
SUMMARY_RESPONSE=$(curl -s -X POST "$CHAT_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"summary\",
    \"sessionId\": \"$SESSION_ID\",
    \"regenerate\": true
  }")

SUMMARY_SUCCESS=$(echo "$SUMMARY_RESPONSE" | jq -r '.success')
EXTENDED_READING=$(echo "$SUMMARY_RESPONSE" | jq '.summary.extendedReading')

if [ "$SUMMARY_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ Summary generated successfully${NC}"
    
    if [ "$EXTENDED_READING" != "null" ] && [ "$EXTENDED_READING" != "[]" ]; then
        READING_COUNT=$(echo "$EXTENDED_READING" | jq 'length')
        echo -e "${GREEN}✅ Extended Reading: $READING_COUNT resources found${NC}"
        echo "$EXTENDED_READING" | jq '.[0] // empty'
    else
        echo -e "${YELLOW}⚠️  No extended reading (Tavily may not be configured)${NC}"
    fi
else
    echo -e "${RED}❌ Summary generation failed${NC}"
    echo "$SUMMARY_RESPONSE" | jq '.'
fi
echo ""

# Test 3: Regular Chat Question (Should use RAG)
echo -e "${YELLOW}Test 3: Regular Chat Question (RAG should answer)${NC}"
CHAT1_RESPONSE=$(curl -s -X POST "$CHAT_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"message\",
    \"sessionId\": \"$SESSION_ID\",
    \"message\": \"What is Supabase?\"
  }")

CHAT1_SUCCESS=$(echo "$CHAT1_RESPONSE" | jq -r '.success')
USED_RAG=$(echo "$CHAT1_RESPONSE" | jq -r '.usedRagContext')

if [ "$CHAT1_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ Chat response received${NC}"
    echo -e "Used RAG: $USED_RAG"
    echo -e "Answer preview: $(echo "$CHAT1_RESPONSE" | jq -r '.answer' | head -c 100)..."
else
    echo -e "${RED}❌ Chat failed${NC}"
    echo "$CHAT1_RESPONSE" | jq '.'
fi
echo ""

# Test 4: Question Triggering Web Search (Latest information)
echo -e "${YELLOW}Test 4: Question Requiring Web Search (Should trigger Tavily)${NC}"
CHAT2_RESPONSE=$(curl -s -X POST "$CHAT_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"message\",
    \"sessionId\": \"$SESSION_ID\",
    \"message\": \"What are the latest updates and new features in Supabase?\"
  }")

CHAT2_SUCCESS=$(echo "$CHAT2_RESPONSE" | jq -r '.success')
CHAT2_ANSWER=$(echo "$CHAT2_RESPONSE" | jq -r '.answer')

if [ "$CHAT2_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ Chat response received${NC}"
    echo -e "Answer preview: $(echo "$CHAT2_ANSWER" | head -c 150)..."
    
    if [ ! -z "$TAVILY_API_KEY" ] && [ "$TAVILY_API_KEY" != "your-tavily-api-key-here" ]; then
        echo -e "${YELLOW}ℹ️  Check if answer includes web search results${NC}"
    fi
else
    echo -e "${RED}❌ Chat failed${NC}"
    echo "$CHAT2_RESPONSE" | jq '.'
fi
echo ""

# Test 5: Explicit Web Search Request
echo -e "${YELLOW}Test 5: Explicit Web Search Request${NC}"
CHAT3_RESPONSE=$(curl -s -X POST "$CHAT_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"message\",
    \"sessionId\": \"$SESSION_ID\",
    \"message\": \"Search for recent tutorials about Supabase authentication\"
  }")

CHAT3_SUCCESS=$(echo "$CHAT3_RESPONSE" | jq -r '.success')

if [ "$CHAT3_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ Search request processed${NC}"
    echo -e "Answer preview: $(echo "$CHAT3_RESPONSE" | jq -r '.answer' | head -c 150)..."
else
    echo -e "${RED}❌ Search request failed${NC}"
    echo "$CHAT3_RESPONSE" | jq '.'
fi
echo ""

# Test 6: Get Chat History
echo -e "${YELLOW}Test 6: Get Chat History${NC}"
HISTORY_RESPONSE=$(curl -s -X POST "$CHAT_URL" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"history\",
    \"sessionId\": \"$SESSION_ID\",
    \"limit\": 10
  }")

HISTORY_SUCCESS=$(echo "$HISTORY_RESPONSE" | jq -r '.success')
MESSAGE_COUNT=$(echo "$HISTORY_RESPONSE" | jq -r '.totalMessages')

if [ "$HISTORY_SUCCESS" == "true" ]; then
    echo -e "${GREEN}✅ History retrieved: $MESSAGE_COUNT messages${NC}"
else
    echo -e "${RED}❌ Failed to get history${NC}"
    echo "$HISTORY_RESPONSE" | jq '.'
fi
echo ""

# Summary
echo -e "${YELLOW}=== Test Summary ===${NC}"
echo -e "Session ID: ${GREEN}$SESSION_ID${NC}"
echo -e "Tavily Integration: $([ ! -z "$TAVILY_API_KEY" ] && [ "$TAVILY_API_KEY" != "your-tavily-api-key-here" ] && echo -e "${GREEN}Enabled${NC}" || echo -e "${YELLOW}Disabled${NC}")"
echo -e "\n${GREEN}✅ All tests completed${NC}"
echo -e "\n${YELLOW}Note: Check server logs for tool calling details${NC}"

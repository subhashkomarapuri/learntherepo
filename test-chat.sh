#!/bin/bash

# Test script for chat function
# Usage: ./test-chat.sh

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
BASE_URL="http://127.0.0.1:54321/functions/v1/chat"
GITHUB_URL="${1:-https://github.com/octocat/Hello-World}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Chat Function Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Testing with repository: ${YELLOW}$GITHUB_URL${NC}"
echo ""

# Step 1: Initialize session
echo -e "${GREEN}1️⃣  Initializing chat session...${NC}"
INIT_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"init\",\"githubUrl\":\"$GITHUB_URL\",\"ref\":\"main\"}")

echo "$INIT_RESPONSE" | jq '.'

# Extract session ID
SESSION_ID=$(echo "$INIT_RESPONSE" | jq -r '.sessionId')

if [ "$SESSION_ID" = "null" ] || [ -z "$SESSION_ID" ]; then
    echo -e "${YELLOW}❌ Failed to initialize session${NC}"
    echo "$INIT_RESPONSE" | jq '.'
    exit 1
fi

echo -e "${GREEN}✓ Session created: $SESSION_ID${NC}"
echo ""

# Wait a moment for processing
echo -e "${YELLOW}⏳ Waiting for repository processing (this may take 30-60 seconds)...${NC}"
sleep 5

# Step 2: Generate summary
echo -e "${GREEN}2️⃣  Generating repository summary...${NC}"
SUMMARY_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"summary\",\"sessionId\":\"$SESSION_ID\"}")

echo "$SUMMARY_RESPONSE" | jq '.'
echo ""

# Check if summary was successful
SUCCESS=$(echo "$SUMMARY_RESPONSE" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ Summary generated successfully${NC}"
    echo -e "${BLUE}Title:${NC} $(echo "$SUMMARY_RESPONSE" | jq -r '.summary.title')"
    echo -e "${BLUE}Description:${NC} $(echo "$SUMMARY_RESPONSE" | jq -r '.summary.description' | head -c 100)..."
    echo -e "${BLUE}Primary Language:${NC} $(echo "$SUMMARY_RESPONSE" | jq -r '.summary.primaryLanguage')"
else
    echo -e "${YELLOW}⚠️  Summary generation may still be processing${NC}"
fi
echo ""

# Step 3: Send a message
echo -e "${GREEN}3️⃣  Sending chat message...${NC}"
MESSAGE_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"message\",\"sessionId\":\"$SESSION_ID\",\"message\":\"What is this repository about?\"}")

echo "$MESSAGE_RESPONSE" | jq '.'
echo ""

# Check message response
SUCCESS=$(echo "$MESSAGE_RESPONSE" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ Message sent successfully${NC}"
    echo -e "${BLUE}Answer:${NC}"
    echo "$MESSAGE_RESPONSE" | jq -r '.answer'
    echo ""
    echo -e "${BLUE}Sources used:${NC} $(echo "$MESSAGE_RESPONSE" | jq -r '.sources | length')"
    echo -e "${BLUE}Used RAG context:${NC} $(echo "$MESSAGE_RESPONSE" | jq -r '.usedRagContext')"
    echo -e "${BLUE}Used fallback:${NC} $(echo "$MESSAGE_RESPONSE" | jq -r '.usedFallback')"
else
    echo -e "${YELLOW}⚠️  Message failed${NC}"
    echo "$MESSAGE_RESPONSE" | jq '.'
fi
echo ""

# Step 4: Get conversation history
echo -e "${GREEN}4️⃣  Retrieving conversation history...${NC}"
HISTORY_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"history\",\"sessionId\":\"$SESSION_ID\",\"limit\":10}")

echo "$HISTORY_RESPONSE" | jq '.'
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ Test completed!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Session ID: ${YELLOW}$SESSION_ID${NC}"
echo -e "Total messages: $(echo "$HISTORY_RESPONSE" | jq -r '.totalMessages // 0')"
echo ""
echo -e "You can now use this session ID to:"
echo -e "  • Send more messages"
echo -e "  • Retrieve history"
echo -e "  • Regenerate summary"
echo ""
echo -e "${BLUE}Example commands:${NC}"
echo -e "  # Send another message:"
echo -e "  curl -X POST '$BASE_URL' \\"
echo -e "    -H 'Authorization: Bearer $ANON_KEY' \\"
echo -e "    -H 'Content-Type: application/json' \\"
echo -e "    -d '{\"action\":\"message\",\"sessionId\":\"$SESSION_ID\",\"message\":\"How do I use this?\"}'"
echo ""

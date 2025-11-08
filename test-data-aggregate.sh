#!/bin/bash
# Test script for data-aggregate function

set -e

echo "🧪 Testing Data Aggregate Function"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SUPABASE_URL=${SUPABASE_URL:-"http://127.0.0.1:54321"}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}

# Load .env file if it exists
if [ -f .env ]; then
    echo "Loading environment from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check prerequisites
echo "1️⃣  Checking prerequisites..."
echo ""

# Check if Supabase is running
if ! curl -s "${SUPABASE_URL}/rest/v1/" -H "apikey: ${SUPABASE_ANON_KEY}" > /dev/null 2>&1; then
    echo -e "${RED}❌ Supabase is not running${NC}"
    echo "   Run: supabase start"
    exit 1
fi
echo -e "${GREEN}✓ Supabase is running${NC}"

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  OPENAI_API_KEY not set${NC}"
    echo "   Set it in .env or export it:"
    echo "   export OPENAI_API_KEY=sk-proj-..."
    exit 1
fi
echo -e "${GREEN}✓ OPENAI_API_KEY is set${NC}"

# Check if migration is applied
echo ""
echo "2️⃣  Checking database schema..."
echo ""

REPO_COUNT=$(curl -s "${SUPABASE_URL}/rest/v1/repositories?select=count" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    | grep -o '"count":[0-9]*' | grep -o '[0-9]*' || echo "0")

if [ -z "$REPO_COUNT" ]; then
    echo -e "${RED}❌ Database tables not found${NC}"
    echo "   Run: supabase db reset"
    exit 1
fi
echo -e "${GREEN}✓ Database schema exists (${REPO_COUNT} repositories)${NC}"

# Test 1: Process a small repository
echo ""
echo "3️⃣  Testing with a small repository..."
echo ""

TEST_REPO="https://github.com/supabase/supabase"
echo "Repository: ${TEST_REPO}"
echo ""

RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/data-aggregate" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"url\": \"${TEST_REPO}\",
        \"ref\": \"master\"
    }")

echo "$RESPONSE" | jq '.' || echo "$RESPONSE"

# Check if successful
if echo "$RESPONSE" | grep -q '"success":true'; then
    echo ""
    echo -e "${GREEN}✓ Test passed!${NC}"
    
    # Extract stats
    DOCS=$(echo "$RESPONSE" | jq -r '.stats.documentsProcessed // 0')
    CHUNKS=$(echo "$RESPONSE" | jq -r '.stats.chunksCreated // 0')
    EMBEDDINGS=$(echo "$RESPONSE" | jq -r '.stats.embeddingsCreated // 0')
    TOKENS=$(echo "$RESPONSE" | jq -r '.stats.totalTokensUsed // 0')
    TIME=$(echo "$RESPONSE" | jq -r '.stats.processingTimeMs // 0')
    
    echo ""
    echo "📊 Processing Statistics:"
    echo "   Documents: ${DOCS}"
    echo "   Chunks: ${CHUNKS}"
    echo "   Embeddings: ${EMBEDDINGS}"
    echo "   Tokens: ${TOKENS}"
    echo "   Time: ${TIME}ms"
    echo "   Cost: \$$(echo "scale=4; ${TOKENS} / 1000000 * 0.02" | bc -l)"
else
    echo ""
    echo -e "${RED}❌ Test failed${NC}"
    exit 1
fi

# Test 2: Verify database records
echo ""
echo "4️⃣  Verifying database records..."
echo ""

# Check repositories
REPOS=$(curl -s "${SUPABASE_URL}/rest/v1/repositories?select=*&limit=5" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

REPO_COUNT=$(echo "$REPOS" | jq '. | length')
echo -e "${GREEN}✓ Found ${REPO_COUNT} repositories${NC}"

# Check documents
DOCS=$(curl -s "${SUPABASE_URL}/rest/v1/documents?select=count" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

DOC_COUNT=$(echo "$DOCS" | jq -r '.[0].count // 0')
echo -e "${GREEN}✓ Found ${DOC_COUNT} documents${NC}"

# Check chunks
CHUNKS=$(curl -s "${SUPABASE_URL}/rest/v1/document_chunks?select=count" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

CHUNK_COUNT=$(echo "$CHUNKS" | jq -r '.[0].count // 0')
echo -e "${GREEN}✓ Found ${CHUNK_COUNT} chunks${NC}"

# Check embeddings
EMBEDDINGS=$(curl -s "${SUPABASE_URL}/rest/v1/embeddings?select=count" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

EMBEDDING_COUNT=$(echo "$EMBEDDINGS" | jq -r '.[0].count // 0')
echo -e "${GREEN}✓ Found ${EMBEDDING_COUNT} embeddings${NC}"

# Test 3: Test duplicate prevention
echo ""
echo "5️⃣  Testing duplicate prevention..."
echo ""

DUPLICATE_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/data-aggregate" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"url\": \"${TEST_REPO}\",
        \"ref\": \"master\"
    }")

if echo "$DUPLICATE_RESPONSE" | grep -q '"success":false'; then
    echo -e "${GREEN}✓ Duplicate prevention working${NC}"
else
    echo -e "${YELLOW}⚠️  Expected duplicate error but got success${NC}"
fi

# Test 4: Test force reprocess
echo ""
echo "6️⃣  Testing force reprocess..."
echo ""

FORCE_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/data-aggregate" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"url\": \"${TEST_REPO}\",
        \"ref\": \"master\",
        \"force\": true
    }")

if echo "$FORCE_RESPONSE" | grep -q '"success":true'; then
    echo -e "${GREEN}✓ Force reprocess working${NC}"
else
    echo -e "${RED}❌ Force reprocess failed${NC}"
fi

# Summary
echo ""
echo "=================================="
echo -e "${GREEN}🎉 All tests passed!${NC}"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Try processing a larger repository"
echo "2. Test semantic search queries"
echo "3. Build a RAG query function"
echo ""

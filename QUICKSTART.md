# Quick Start Guide - Data Aggregate Function

## Prerequisites

1. **OpenAI API Key** - Get from https://platform.openai.com/api-keys
2. **Supabase Project** - Running locally or on cloud
3. **Crawl4AI** - Running for doc-crawl function

## Step-by-Step Setup

### 1. Set Up Environment Variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:
```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-proj-your-key
```

### 2. Run Database Migration

This creates all required tables and indexes:

```bash
supabase db reset
```

Or apply the specific migration:

```bash
supabase migration up
```

### 3. Start Supabase

```bash
supabase start
```

### 4. Test the Function

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/supabase/supabase",
    "ref": "main"
  }'
```

### 5. Verify Results

Check the database:

```sql
-- View repositories
SELECT * FROM repositories;

-- View documents
SELECT id, url, source_type, content_length FROM documents;

-- View chunks
SELECT id, chunk_index, chunk_length FROM document_chunks LIMIT 10;

-- View embeddings
SELECT id, model, created_at FROM embeddings LIMIT 10;

-- Get repository stats
SELECT * FROM get_repository_stats('supabase', 'supabase', 'main');
```

### 6. Query with Semantic Search

First, generate an embedding for your query:

```typescript
// In your application or another edge function
const response = await fetch('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    input: 'How do I get started with Supabase?',
    model: 'text-embedding-3-small'
  })
})

const { data } = await response.json()
const queryEmbedding = data[0].embedding
```

Then search:

```sql
SELECT * FROM match_documents(
  query_embedding := ARRAY[/* paste embedding array here */]::vector,
  repo_owner := 'supabase',
  repo_name := 'supabase',
  repo_ref := 'main',
  match_threshold := 0.7,
  match_count := 5
);
```

## Workflow Example

### Processing a New Repository

```bash
# 1. Process the repository
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/microsoft/vscode",
    "ref": "main"
  }'
```

Expected response:
```json
{
  "success": true,
  "repository": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "owner": "microsoft",
    "repo": "vscode",
    "ref": "main"
  },
  "stats": {
    "documentsProcessed": 12,
    "chunksCreated": 187,
    "embeddingsCreated": 187,
    "documentsFailed": 0,
    "totalTokensUsed": 23456,
    "processingTimeMs": 45000
  }
}
```

### Reprocessing an Existing Repository

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/microsoft/vscode",
    "ref": "main",
    "force": true
  }'
```

## Common Issues

### Issue: "Missing OPENAI_API_KEY"

**Solution**: Ensure the environment variable is set in Supabase:

```bash
# For local development
echo "OPENAI_API_KEY=sk-proj-..." >> .env

# For production (Supabase dashboard)
# Go to Project Settings > Edge Functions > Add Secret
```

### Issue: "Repository already exists"

**Solution**: Use `force: true` to reprocess:

```json
{
  "url": "https://github.com/owner/repo",
  "force": true
}
```

### Issue: pgvector extension not found

**Solution**: Enable in Supabase dashboard or run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Issue: Rate limited by OpenAI

**Solution**: The function has automatic retry logic. Wait a moment and it will continue.

## Cost Estimation

Before processing large repositories:

```typescript
import { estimateCost } from './lib/embedder.ts'

const exampleChunks = [
  'chunk 1 text...',
  'chunk 2 text...',
  // ... more chunks
]

const cost = estimateCost(exampleChunks)
console.log(`Estimated cost: $${cost.toFixed(4)}`)
```

Typical costs:
- Small repo (< 50 docs): **$0.01 - $0.05**
- Medium repo (50-200 docs): **$0.05 - $0.20**
- Large repo (> 200 docs): **$0.20 - $1.00**

## Next Steps

1. **Build a Query Function** - Create a RAG endpoint that accepts questions and returns answers
2. **Add a Frontend** - Build a UI for repository search
3. **Implement Caching** - Cache frequently accessed embeddings
4. **Monitor Usage** - Track OpenAI API costs and optimize

## Monitoring

View function logs:

```bash
supabase functions logs data-aggregate --follow
```

Check database size:

```sql
SELECT 
  pg_size_pretty(pg_total_relation_size('embeddings')) as embeddings_size,
  pg_size_pretty(pg_total_relation_size('document_chunks')) as chunks_size,
  pg_size_pretty(pg_total_relation_size('documents')) as documents_size;
```

## Support

- Check the [README.md](./README.md) for detailed documentation
- Review [Supabase Edge Functions docs](https://supabase.com/docs/guides/functions)
- See [pgvector documentation](https://github.com/pgvector/pgvector)

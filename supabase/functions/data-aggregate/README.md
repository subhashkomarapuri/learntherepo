# Data Aggregate Function

A comprehensive Supabase Edge Function that orchestrates document gathering, chunking, embedding, and storage for RAG (Retrieval-Augmented Generation) applications.

## Overview

The `data-aggregate` function provides an end-to-end pipeline for processing GitHub repositories into searchable, AI-ready knowledge bases:

1. **Document Collection** - Fetches README and documentation from GitHub repositories
2. **Text Chunking** - Splits documents into semantic chunks using LangChain
3. **Embedding Generation** - Creates vector embeddings using OpenAI
4. **Vector Storage** - Stores chunks and embeddings in Supabase with pgvector
5. **RAG Ready** - Enables semantic search and retrieval for LLM applications

## Features

✅ **Intelligent Document Gathering**
- Fetches README files via `github-doc` function
- Crawls documentation links via `doc-crawl` function
- Combines multiple sources into unified knowledge base

✅ **Markdown-Aware Chunking**
- Uses LangChain's RecursiveCharacterTextSplitter
- Respects semantic boundaries (headers, paragraphs, sentences)
- Configurable chunk size (default: 1000 chars) and overlap (default: 200 chars)

✅ **Production-Ready Embeddings**
- OpenAI text-embedding-3-small (1536 dimensions)
- Batch processing with automatic retry logic
- Rate limiting and error handling
- Cost estimation and tracking

✅ **Efficient Vector Storage**
- PostgreSQL with pgvector extension
- HNSW index for fast similarity search
- Repository-based organization and filtering
- Automatic deduplication

✅ **Comprehensive Metadata**
- Tracks source URLs, anchor text, chunk positions
- Repository ownership (owner/repo/ref)
- Processing statistics and timestamps
- Error logging for debugging

## Architecture

```
┌─────────────────────┐
│  GitHub Repository  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  data-aggregate     │
│  Edge Function      │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌─────────┐  ┌──────────┐
│github-  │  │doc-crawl │
│doc      │  │          │
└────┬────┘  └─────┬────┘
     │             │
     └──────┬──────┘
            │
            ▼
    ┌───────────────┐
    │   Documents   │
    │  Collection   │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │   LangChain   │
    │   Chunking    │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │    OpenAI     │
    │  Embeddings   │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │   Supabase    │
    │  PostgreSQL   │
    │  + pgvector   │
    └───────────────┘
```

## Database Schema

### Tables

1. **`repositories`** - GitHub repository metadata
   - Tracks processing status and statistics
   - Unique constraint on (owner, repo, ref)

2. **`documents`** - Raw markdown content
   - Links to parent repository
   - Stores source URL and type (readme/documentation)

3. **`document_chunks`** - Text chunks for embedding
   - Links to parent document and repository
   - Includes chunk position and metadata

4. **`embeddings`** - Vector embeddings
   - 1536-dimensional vectors (OpenAI)
   - HNSW index for fast similarity search
   - Links to chunk and repository

### SQL Functions

- **`match_documents()`** - Semantic similarity search
- **`get_repository_stats()`** - Repository statistics

## Prerequisites

1. **Supabase Project** with:
   - PostgreSQL database
   - pgvector extension enabled
   - Edge Functions runtime

2. **Environment Variables**:
   ```bash
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENAI_API_KEY=sk-your-openai-key
   ```

3. **Dependencies**:
   - `github-doc` function deployed
   - `doc-crawl` function deployed
   - Crawl4AI service running (for doc-crawl)

## Installation

### 1. Run Database Migration

```bash
# Apply the migration
supabase db reset

# Or manually run the migration
supabase db push
```

This creates:
- All required tables
- pgvector extension
- HNSW indexes
- Helper functions

### 2. Set Environment Variables

Add to your Supabase project settings or `.env` file:

```bash
OPENAI_API_KEY=sk-proj-...
```

### 3. Deploy the Function

```bash
# Deploy all functions
supabase functions deploy data-aggregate

# Or deploy with inline secrets
supabase functions deploy data-aggregate \
  --no-verify-jwt \
  --env-file .env
```

## Usage

### Basic Request

```bash
curl -i --location --request POST \
  'http://127.0.0.1:54321/functions/v1/data-aggregate' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "url": "https://github.com/supabase/supabase",
    "ref": "main"
  }'
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | GitHub repository URL |
| `ref` | string | ❌ | Branch/tag name (default: "main") |
| `force` | boolean | ❌ | Force reprocessing if repo exists |

### Response Format

```json
{
  "success": true,
  "repository": {
    "id": "uuid-here",
    "owner": "supabase",
    "repo": "supabase",
    "ref": "main"
  },
  "stats": {
    "repositoryId": "uuid-here",
    "owner": "supabase",
    "repo": "supabase",
    "ref": "main",
    "documentsProcessed": 15,
    "chunksCreated": 245,
    "embeddingsCreated": 245,
    "documentsSkipped": 0,
    "documentsFailed": 0,
    "totalTokensUsed": 45678,
    "processingTimeMs": 12345
  },
  "errors": []
}
```

### Example Usage

#### Process a Repository

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/microsoft/vscode",
    "ref": "main"
  }'
```

#### Force Reprocess

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/microsoft/vscode",
    "ref": "main",
    "force": true
  }'
```

## Querying Embeddings

### Similarity Search

Use the built-in `match_documents` SQL function:

```sql
SELECT * FROM match_documents(
  query_embedding := (
    -- Your query embedding vector here
    SELECT embedding FROM embeddings LIMIT 1
  ),
  repo_owner := 'supabase',
  repo_name := 'supabase',
  repo_ref := 'main',
  match_threshold := 0.7,
  match_count := 10
);
```

### From Edge Function

```typescript
const { data, error } = await supabase.rpc('match_documents', {
  query_embedding: yourQueryEmbedding,
  repo_owner: 'supabase',
  repo_name: 'supabase',
  match_threshold: 0.7,
  match_count: 10
})
```

### Get Repository Stats

```sql
SELECT * FROM get_repository_stats(
  'supabase',
  'supabase',
  'main'
);
```

## Configuration

### Chunking Configuration

Edit `lib/chunker.ts` to customize:

```typescript
const config = {
  chunkSize: 1000,        // Target chunk size
  chunkOverlap: 200,      // Overlap between chunks
  separators: [           // Custom separators
    '\n## ',
    '\n### ',
    '\n\n',
    // ...
  ]
}
```

### Embedding Configuration

Edit `lib/embedder.ts` to customize:

```typescript
const config = {
  model: 'text-embedding-3-small',  // Embedding model
  batchSize: 100,                   // Texts per batch
  maxRetries: 3                     // Retry attempts
}
```

## Cost Estimation

### OpenAI Pricing (text-embedding-3-small)
- **$0.02 per 1M tokens**

### Typical Repository Costs
- Small repo (< 50 docs): **$0.01 - $0.05**
- Medium repo (50-200 docs): **$0.05 - $0.20**
- Large repo (> 200 docs): **$0.20 - $1.00**

### Calculate Before Processing

```typescript
import { estimateCost } from './lib/embedder.ts'

const texts = ['chunk 1', 'chunk 2', ...]
const cost = estimateCost(texts)
console.log(`Estimated cost: $${cost.toFixed(4)}`)
```

## Error Handling

The function handles errors gracefully:

1. **Partial Success** - Continues processing other documents if one fails
2. **Retry Logic** - Automatically retries failed API calls
3. **Error Logging** - Returns detailed error information
4. **Rate Limiting** - Respects OpenAI rate limits

### Common Errors

| Error | Solution |
|-------|----------|
| `Missing OPENAI_API_KEY` | Set environment variable |
| `Repository already exists` | Use `"force": true` |
| `Rate limit exceeded` | Wait and retry, or increase batch delays |
| `No documents found` | Check repository URL and ref |

## Performance

### Benchmarks (approximate)

| Documents | Chunks | Embeddings | Time | Cost |
|-----------|--------|------------|------|------|
| 10 | 150 | 150 | ~30s | $0.01 |
| 50 | 750 | 750 | ~2min | $0.05 |
| 100 | 1500 | 1500 | ~5min | $0.10 |

### Optimization Tips

1. **Batch Processing** - Already implemented
2. **Parallel Requests** - Limit to avoid rate limits
3. **Chunk Size** - Balance between granularity and performance
4. **Caching** - Use `force: false` to avoid reprocessing

## Development

### Local Testing

```bash
# Start Supabase
supabase start

# Run migration
supabase db reset

# Test the function
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/supabase/supabase"}'
```

### Debugging

Enable verbose logging:

```typescript
// In index.ts
console.log('Processing document:', doc.url)
console.log('Chunk count:', chunks.length)
console.log('Embedding result:', embeddingResult)
```

### Testing Individual Components

```typescript
// Test chunking
import { chunkMarkdown } from './lib/chunker.ts'
const chunks = await chunkMarkdown('# Hello\n\nWorld')

// Test embedding
import { generateEmbeddings } from './lib/embedder.ts'
const result = await generateEmbeddings(['test'], { apiKey: 'sk-...' })

// Test storage
import { createStorageClient } from './lib/storage.ts'
const client = createStorageClient(url, key)
```

## Next Steps

### 1. Build RAG Query Function

Create a complementary function for querying:

```typescript
// supabase/functions/rag-query/index.ts
Deno.serve(async (req) => {
  const { query, owner, repo } = await req.json()
  
  // 1. Generate query embedding
  // 2. Search with match_documents()
  // 3. Pass to LLM with context
  // 4. Return answer
})
```

### 2. Add Incremental Updates

Track document changes and only reprocess modified docs.

### 3. Support Multiple Embedding Models

Add support for local models or Hugging Face.

### 4. Implement Caching

Cache embeddings to reduce API costs.

## Troubleshooting

### Function Won't Deploy

- Check `deno.json` import map
- Verify all dependencies are accessible
- Check function logs: `supabase functions logs data-aggregate`

### Embeddings Fail

- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI account has credits
- Review rate limits in OpenAI dashboard

### Database Errors

- Ensure pgvector extension is enabled
- Run migration: `supabase db reset`
- Check service role key has permissions

## Support

- [Supabase Documentation](https://supabase.com/docs)
- [LangChain Documentation](https://js.langchain.com/docs)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [pgvector Documentation](https://github.com/pgvector/pgvector)

## License

MIT

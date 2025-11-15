# Learn the repo quick

# Interact with AI assistant and get all your doubts cleared in moments

Summarizes any Github repo to an understandable level and gives you the key insights and helps you with the content the developers wanna build further.

## 🎉 New: RAG Pipeline for GitHub Documentation

We've added a complete RAG (Retrieval-Augmented Generation) pipeline that:
- ✅ Fetches README and documentation from GitHub repositories
- ✅ Intelligently chunks content using LangChain
- ✅ Generates embeddings with OpenAI
- ✅ Stores vectors in Supabase pgvector for semantic search
- ✅ Enables AI-powered Q&A about any repository

### Quick Start

1. **Set up environment:**
```bash
cp .env.example .env
# Add your OPENAI_API_KEY to .env
```

2. **Apply database migration:**
```bash
npx supabase db reset
```

3. **Start the functions:**
```bash
./start-functions.sh
```

4. **Process a repository:**
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/supabase/supabase","ref":"main"}'
```

### Documentation

- **[SUCCESS.md](./SUCCESS.md)** - ✅ Working implementation guide
- **[QUICKSTART.md](./QUICKSTART.md)** - Step-by-step setup
- **[ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md)** - Environment configuration
- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** - Architecture details

### Features

- **4 Edge Functions:**
  - `github-doc` - Fetch README files
  - `doc-link-extract` - Extract documentation links
  - `doc-crawl` - Crawl documentation pages
  - `data-aggregate` - ⭐ Complete RAG pipeline

- **PostgreSQL + pgvector:**
  - Semantic search with HNSW indexes
  - Repository-based organization
  - Automatic deduplication

- **Production Ready:**
  - Error handling & retry logic
  - Cost tracking & estimation
  - Batch processing
  - Comprehensive logging

### Architecture

```
GitHub Repository
      ↓
data-aggregate Function
      ↓
   ┌──┴──┐
   ↓     ↓
github  doc-crawl
 -doc      ↓
   └──┬────┘
      ↓
   Chunk (LangChain)
      ↓
   Embed (OpenAI)
      ↓
   Store (pgvector)
```

### Cost

Using OpenAI text-embedding-3-small (~$0.02 per 1M tokens):
- Small repo: $0.01-0.05
- Medium repo: $0.05-0.20
- Large repo: $0.20-1.00

### Next Steps

1. Process your first repository
2. Query the embeddings with semantic search
3. Build a RAG query function
4. Create a frontend interface

See [SUCCESS.md](./SUCCESS.md) for complete usage guide!

## Features

### 🤖 RAG-Powered Repository Analysis
- **Document Aggregation** - Fetches README and documentation from GitHub repos
- **Intelligent Chunking** - Breaks down documents using LangChain's semantic splitter
- **Vector Embeddings** - Generates OpenAI embeddings for semantic search
- **Vector Storage** - Stores in Supabase PostgreSQL with pgvector for fast retrieval
- **Semantic Search** - Find relevant information using similarity search

### 📚 Supabase Edge Functions

1. **`github-doc`** - Fetches README files from GitHub repositories
2. **`doc-link-extract`** - Extracts documentation links from README
3. **`doc-crawl`** - Crawls and converts documentation to markdown
4. **`data-aggregate`** - End-to-end RAG pipeline (NEW! ✨)

## Quick Start

See [QUICKSTART.md](./QUICKSTART.md) for detailed setup instructions.

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [Crawl4AI](https://github.com/unclecode/crawl4ai) running (for doc-crawl)

### Installation

1. Clone and setup:
```bash
git clone <your-repo-url>
cd duke_ai
cp .env.example .env
# Edit .env with your keys
```

2. Run database migration:
```bash
supabase db reset
```

3. Start Supabase:
```bash
supabase start
```

4. Process a repository:
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/data-aggregate \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/supabase/supabase","ref":"main"}'
```

## Architecture

```
GitHub Repo
    ↓
data-aggregate Function
    ├── github-doc (fetch README)
    ├── doc-crawl (fetch docs)
    ↓
LangChain Chunking
    ↓
OpenAI Embeddings
    ↓
Supabase PostgreSQL + pgvector
    ↓
RAG Query Function (coming soon)
```

## Documentation

- [data-aggregate Function](./supabase/functions/data-aggregate/README.md) - Complete RAG pipeline
- [github-doc Function](./supabase/functions/github-doc/) - README fetcher
- [doc-crawl Function](./supabase/functions/doc-crawl/) - Documentation crawler
- [Quick Start Guide](./QUICKSTART.md) - Step-by-step setup

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT

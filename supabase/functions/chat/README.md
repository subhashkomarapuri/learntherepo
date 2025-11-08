# Chat Function

A comprehensive Supabase Edge Function that provides AI-powered chat capabilities for GitHub repositories, including structured summary generation and RAG (Retrieval-Augmented Generation) based Q&A.

## Overview

The chat function provides two main capabilities:

1. **Repository Summary Generation** - Analyzes README and documentation links to create structured summaries
2. **RAG-Based Chat** - Interactive Q&A using vector embeddings and semantic search

## Features

✅ **Dual-Mode Operation**
- Summary generation using README + documentation links (no embeddings required)
- RAG chat using vector embeddings for precise Q&A

✅ **Smart Context Management**
- Automatic repository processing via `data-aggregate`
- Configurable RAG parameters (similarity threshold, chunk count)
- Summary included as context in every chat message

✅ **Intelligent Fallback**
- Explicitly states when no relevant documentation found
- Provides general knowledge as fallback
- Never hallucinates missing documentation

✅ **Full Conversation History**
- Persistent message storage
- Session management
- Source citations for every answer

✅ **Highly Configurable**
- Centralized `lib/config.ts` for all LLM settings
- Template-based prompts in `lib/prompts.ts`
- Easy to customize model, temperature, token limits

✅ **MCP-Ready Architecture**
- Placeholder for Model Context Protocol tools
- Structured for future extension
- Tool execution framework built-in

## Architecture

```
Frontend
    ↓
POST /chat (action: "init")
    ↓
  Initialize Session
  Auto-process repo if needed
    ↓
POST /chat (action: "summary")
    ↓
  Generate Summary
  (README + doc links → LLM → Structured JSON)
    ↓
POST /chat (action: "message")
    ↓
  RAG Chat
  (Query → Embeddings → Vector Search → LLM → Answer)
    ↓
POST /chat (action: "history")
    ↓
  Retrieve Conversation
```

## Prerequisites

1. **Database Migration Applied**:
   ```bash
   supabase db reset
   ```

2. **Environment Variables** (in `supabase/.env`):
   ```
   OPENAI_API_KEY=sk-proj-...
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

3. **Other Functions Deployed**:
   - `data-aggregate` - For processing repositories
   - `github-doc` - For fetching README
   - `doc-link-extract` - For extracting documentation links

## API Reference

### Action 1: Initialize Session

Creates a new chat session and optionally processes the repository.

**Request**:
```json
{
  "action": "init",
  "githubUrl": "https://github.com/owner/repo",
  "ref": "main",
  "force": false
}
```

**Parameters**:
- `action` (required): Must be `"init"`
- `githubUrl` (required): GitHub repository URL
- `ref` (optional): Branch/tag name, default: `"main"`
- `force` (optional): Force reprocess if repo exists, default: `false`

**Response**:
```json
{
  "success": true,
  "sessionId": "uuid-here",
  "repositoryId": "uuid-here",
  "status": "created",
  "message": "Chat session created for owner/repo@main"
}
```

**Example**:
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "init",
    "githubUrl": "https://github.com/supabase/supabase",
    "ref": "main"
  }'
```

---

### Action 2: Generate Summary

Generates a structured summary of the repository using README and documentation links.

**Request**:
```json
{
  "action": "summary",
  "sessionId": "uuid-from-init",
  "regenerate": false
}
```

**Parameters**:
- `action` (required): Must be `"summary"`
- `sessionId` (required): Session ID from init
- `regenerate` (optional): Force regenerate even if cached, default: `false`

**Response**:
```json
{
  "success": true,
  "summary": {
    "title": "Supabase",
    "description": "The open source Firebase alternative...",
    "keyFeatures": [
      "Database: PostgreSQL",
      "Authentication: Built-in auth",
      "Storage: Object storage"
    ],
    "techStack": ["PostgreSQL", "TypeScript", "Deno"],
    "primaryLanguage": "TypeScript",
    "documentationLinks": [
      {"title": "Docs", "url": "https://supabase.com/docs"},
      {"title": "API Reference", "url": "https://supabase.com/docs/reference"}
    ],
    "quickStart": "Install the CLI with npm install -g supabase...",
    "useCases": [
      "Building full-stack applications",
      "Real-time applications"
    ],
    "additionalInfo": "Actively maintained open source project"
  },
  "fromCache": false,
  "modelUsed": "gpt-4o"
}
```

**Example**:
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "summary",
    "sessionId": "YOUR_SESSION_ID"
  }'
```

---

### Action 3: Send Message (RAG Chat)

Send a question and get an AI-powered answer with RAG context.

**Request**:
```json
{
  "action": "message",
  "sessionId": "uuid-from-init",
  "message": "How do I set up authentication?",
  "ragConfig": {
    "matchThreshold": 0.7,
    "matchCount": 5,
    "includeSummary": true
  }
}
```

**Parameters**:
- `action` (required): Must be `"message"`
- `sessionId` (required): Session ID from init
- `message` (required): User's question
- `ragConfig` (optional): RAG configuration
  - `matchThreshold` (0-1): Similarity threshold, default: `0.7`
  - `matchCount`: Number of chunks to retrieve, default: `5`
  - `includeSummary`: Include summary in context, default: `true`

**Response**:
```json
{
  "success": true,
  "messageId": "uuid-here",
  "answer": "To set up authentication in Supabase...",
  "sources": [
    {
      "chunkId": "uuid",
      "chunkText": "Authentication can be configured...",
      "documentUrl": "https://supabase.com/docs/guides/auth",
      "similarity": 0.92
    }
  ],
  "usedRagContext": true,
  "usedFallback": false,
  "modelUsed": "gpt-4o-mini"
}
```

**Example**:
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "message",
    "sessionId": "YOUR_SESSION_ID",
    "message": "How do I get started with Supabase?"
  }'
```

---

### Action 4: Get History

Retrieve conversation history for a session.

**Request**:
```json
{
  "action": "history",
  "sessionId": "uuid-from-init",
  "limit": 50,
  "offset": 0
}
```

**Parameters**:
- `action` (required): Must be `"history"`
- `sessionId` (required): Session ID from init
- `limit` (optional): Max messages to return, default: `50`, max: `200`
- `offset` (optional): Skip first N messages, default: `0`

**Response**:
```json
{
  "success": true,
  "sessionInfo": {
    "sessionId": "uuid",
    "repositoryId": "uuid",
    "repositoryOwner": "supabase",
    "repositoryName": "supabase",
    "repositoryRef": "main",
    "sessionCreatedAt": "2024-01-01T00:00:00Z",
    "messageCount": 10,
    "hasSummary": true
  },
  "messages": [
    {
      "id": "uuid",
      "sessionId": "uuid",
      "role": "user",
      "content": "How do I get started?",
      "createdAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "sessionId": "uuid",
      "role": "assistant",
      "content": "To get started with Supabase...",
      "sources": [...],
      "metadata": {...},
      "createdAt": "2024-01-01T00:00:01Z"
    }
  ],
  "summary": {...},
  "totalMessages": 10
}
```

**Example**:
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "history",
    "sessionId": "YOUR_SESSION_ID",
    "limit": 20
  }'
```

## Configuration

### Model Settings (`lib/config.ts`)

```typescript
export const LLM_CONFIG = {
  models: {
    summary: 'gpt-4o',      // Change to gpt-4-turbo, gpt-3.5-turbo, etc.
    chat: 'gpt-4o-mini'     // Faster/cheaper for chat
  },
  temperature: {
    summary: 0.3,           // More deterministic
    chat: 0.7               // More creative
  },
  maxTokens: {
    summary: 2000,
    chat: 1000
  }
}
```

### RAG Settings (`lib/config.ts`)

```typescript
export const RAG_CONFIG = {
  defaultThreshold: 0.7,     // Similarity threshold
  defaultMatchCount: 5,      // Chunks to retrieve
  maxContextLength: 4000,    // Max characters from chunks
  fallbackThreshold: 0.5     // Trigger "don't know" response
}
```

### Prompt Templates (`lib/prompts.ts`)

Modify the prompt functions to customize chatbot behavior:

```typescript
export function getChatSystemPrompt(summary, ragSources) {
  // Customize the system prompt here
}

export function getSummaryPrompt(readme, docLinks) {
  // Customize the summary generation prompt
}
```

## Usage Examples

### Complete Workflow

```bash
# 1. Initialize session
SESSION_ID=$(curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "init",
    "githubUrl": "https://github.com/supabase/supabase"
  }' | jq -r '.sessionId')

# 2. Generate summary
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"summary\",
    \"sessionId\": \"${SESSION_ID}\"
  }"

# 3. Ask questions
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"message\",
    \"sessionId\": \"${SESSION_ID}\",
    \"message\": \"How do I authenticate users?\"
  }"

# 4. Get history
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"history\",
    \"sessionId\": \"${SESSION_ID}\"
  }"
```

### Frontend Integration (TypeScript)

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Initialize session
async function initChat(githubUrl: string) {
  const { data, error } = await supabase.functions.invoke('chat', {
    body: { action: 'init', githubUrl }
  })
  return data.sessionId
}

// Generate summary
async function getSummary(sessionId: string) {
  const { data } = await supabase.functions.invoke('chat', {
    body: { action: 'summary', sessionId }
  })
  return data.summary
}

// Send message
async function sendMessage(sessionId: string, message: string) {
  const { data } = await supabase.functions.invoke('chat', {
    body: { action: 'message', sessionId, message }
  })
  return data.answer
}

// Get history
async function getHistory(sessionId: string) {
  const { data } = await supabase.functions.invoke('chat', {
    body: { action: 'history', sessionId }
  })
  return data.messages
}
```

## Error Handling

All responses follow a consistent error format:

```json
{
  "success": false,
  "error": "error_code",
  "message": "Human-readable error message"
}
```

**Common Error Codes**:
- `invalid_github_url` - Invalid GitHub repository URL
- `session_not_found` - Chat session doesn't exist
- `repository_not_processed` - Repository not yet processed by data-aggregate
- `repository_not_found` - Repository not in database
- `configuration_error` - Missing environment variables
- `internal_error` - Unexpected server error

## Database Schema

### Tables

1. **`chat_sessions`** - Tracks chat sessions
   - Links to repository
   - Stores metadata
   - Auto-cleanup after 30 days

2. **`chat_messages`** - Conversation history
   - Stores role (user/assistant/system)
   - Includes RAG sources
   - Metadata for debugging

3. **`repository_summaries`** - Cached summaries
   - Structured JSON summary
   - Model used for generation
   - Auto-updated on regenerate

## Performance

### Typical Response Times

| Action | Time | Notes |
|--------|------|-------|
| Init (existing repo) | ~200ms | Database lookup |
| Init (new repo) | ~30-60s | Includes data-aggregate |
| Summary (cached) | ~100ms | Database lookup |
| Summary (generate) | ~15-30s | LLM call + API requests |
| Message | ~2-5s | Embedding + RAG + LLM |
| History | ~100-300ms | Database query |

### Cost Estimates

**Per Repository**:
- Summary generation: ~$0.02-0.05 (one-time)
- Each message: ~$0.001-0.003

**Monthly (100 users, 10 messages each)**:
- Summaries: ~$2-5
- Messages: ~$10-30
- **Total: ~$12-35/month**

## Future Enhancements

- [ ] **Streaming Responses** - Real-time token-by-token display
- [ ] **MCP Tools Integration** - Add web search, code execution, etc.
- [ ] **Multi-turn Context** - Include previous messages in RAG
- [ ] **Fine-tuned Models** - Custom models for specific repositories
- [ ] **Voice Input** - Speech-to-text integration
- [ ] **Export Conversations** - Download as Markdown/PDF

## Troubleshooting

### "Session not found"
- Ensure you're using the correct session ID from init
- Check if session was deleted (30-day auto-cleanup)

### "Repository not processed"
- Wait for data-aggregate to complete
- Use `force: true` to reprocess

### "No relevant documentation found"
- Expected behavior - model will acknowledge and provide general info
- Try adjusting `matchThreshold` lower (e.g., 0.5)

### Summary generation fails
- Check README is accessible
- Verify `github-doc` and `doc-link-extract` functions work
- Check OpenAI API key and credits

## License

MIT

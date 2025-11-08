# Tavily Search Integration

This document describes the Tavily search integration for the chat function, enabling web search capabilities to supplement repository documentation.

## Overview

The chat function now integrates with Tavily's search API to provide:
- **Extended Reading** sections in repository summaries
- **Web search** capabilities when repository documentation is insufficient
- **Latest information** retrieval when users ask for current/recent data

## Configuration

### Environment Variables

Add your Tavily API key to `supabase/.env`:

```bash
TAVILY_API_KEY=tvly-your-api-key-here
```

Get your API key from: https://www.tavily.com/

### Search Parameters

All search parameters are configurable in `lib/config.ts`:

```typescript
export const TAVILY_CONFIG = {
  // API endpoint
  apiUrl: 'https://api.tavily.com/search',
  
  // Default search parameters
  defaultSearchDepth: 'advanced',      // 'basic' | 'advanced'
  defaultMaxResults: 10,                // Number of results
  
  // Content inclusion
  includeImages: false,
  includeAnswer: true,                  // AI-generated answer summary
  
  // Extended reading (for summary generation)
  extendedReadingMaxResults: 5,
  
  // Preferred domains for repository searches
  preferredDomains: [
    'docs.github.com',
    'readthedocs.io',
    'github.io',
    'dev.to',
    'medium.com',
    'stackoverflow.com',
    'hackernoon.com'
  ],
  
  // Context limits
  maxContextLength: 3000,               // Max characters from search results
  
  // Timeout
  timeout: 30000,                       // 30 seconds
  
  // RAG fallback threshold
  ragFallbackThreshold: 0.5             // If RAG similarity < this, consider web search
}
```

## Features

### 1. Extended Reading in Summaries

When generating repository summaries, Tavily automatically searches for:
- Tutorials and guides
- Documentation articles
- Related blog posts
- Community discussions

**Example:**

```json
{
  "title": "Supabase",
  "description": "...",
  "extendedReading": [
    {
      "title": "Getting Started with Supabase - Complete Guide",
      "url": "https://dev.to/...",
      "snippet": "A comprehensive tutorial...",
      "relevance": 0.95
    }
  ]
}
```

### 2. Web Search Tool for Chat

The LLM can now call the `tavily_search` tool when needed. The tool is automatically invoked when:

1. **User explicitly asks** for web search:
   - "search for latest updates"
   - "find recent tutorials"
   - "what are current best practices"

2. **RAG context is insufficient** (similarity < 0.5):
   - No relevant documentation found in repository
   - Question is outside repository scope

3. **User asks for latest information**:
   - Keywords: "latest", "recent", "current", "news", "today"

**Example conversation:**

```
User: "What are the latest security best practices for this framework?"Assistant: [Tool calls tavily_search with query "latest security best practices for [framework]"]
Assistant: "Based on my search, here are the latest security best practices..."
```

## Architecture

### File Structure

```
supabase/functions/chat/
├── lib/
│   ├── tavily.ts          # NEW: Tavily API integration
│   ├── config.ts          # UPDATED: Added TAVILY_CONFIG
│   ├── types.ts           # UPDATED: Added tool call types
│   ├── llm.ts             # UPDATED: Tool calling support
│   ├── summary.ts         # UPDATED: Extended reading
│   └── prompts.ts         # UPDATED: Tool usage instructions
├── index.ts               # UPDATED: Wire everything together
└── TAVILY_INTEGRATION.md  # This file
```

### Tool Calling Flow

```
User Message
    ↓
RAG Search (repository docs)
    ↓
LLM with tavily_search tool
    ↓
[Decision: Use tool?]
    ├─ NO → Return answer
    └─ YES → Call Tavily API
              ↓
         Get search results
              ↓
         Pass to LLM
              ↓
         Generate final answer
```

## API Usage

### Summary with Extended Reading

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "summary",
    "sessionId": "YOUR_SESSION_ID"
  }'
```

Response includes `extendedReading` array with web search results.

### Chat with Web Search

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "message",
    "sessionId": "YOUR_SESSION_ID",
    "message": "What are the latest updates?"
  }'
```

The LLM will automatically use Tavily search if needed.

## Customization

### Adjust Search Depth

```typescript
// In lib/config.ts
export const TAVILY_CONFIG = {
  defaultSearchDepth: 'basic',  // Change to 'basic' for faster, cheaper searches
  // ...
}
```

### Adjust Max Results

```typescript
export const TAVILY_CONFIG = {
  defaultMaxResults: 5,  // Reduce to 5 for faster responses
  // ...
}
```

### Domain Filtering

Add or remove domains from `preferredDomains`:

```typescript
export const TAVILY_CONFIG = {
  preferredDomains: [
    'docs.github.com',
    'your-custom-domain.com',
    // Add your preferred documentation sites
  ],
  // ...
}
```

### RAG Fallback Threshold

Adjust when to trigger web search:

```typescript
export const TAVILY_CONFIG = {
  ragFallbackThreshold: 0.3,  // Lower = more aggressive web search
  // ...
}
```

## Cost Considerations

### Tavily API Pricing

- **Free tier**: 1,000 searches/month
- **Pro tier**: $100/month for 10,000 searches
- See: https://www.tavily.com/pricing

### When Search is Triggered

1. **Every summary generation** (1 search per repository)
2. **Chat when RAG fails** (depends on query quality)
3. **Chat when user asks** (explicit requests)

### Cost Optimization Tips

1. Cache summary extended reading (already implemented)
2. Set `ragFallbackThreshold` higher to reduce fallback searches
3. Use `basic` search depth instead of `advanced`
4. Reduce `defaultMaxResults` to 5

## Troubleshooting

### No Extended Reading in Summary

**Issue**: Summary doesn't include extended reading links

**Solutions**:
1. Check TAVILY_API_KEY is set in `.env`
2. Verify API key is valid at https://www.tavily.com/
3. Check console logs for Tavily errors

### Tool Not Being Called

**Issue**: LLM doesn't use tavily_search tool

**Solutions**:
1. Verify `MCP_CONFIG.enabled = true` in `lib/config.ts`
2. Check TAVILY_API_KEY environment variable
3. Try more explicit queries: "search for..." or "latest..."

### Timeout Errors

**Issue**: Tavily searches timing out

**Solutions**:
1. Increase timeout in `TAVILY_CONFIG.timeout`
2. Switch to `basic` search depth
3. Reduce `defaultMaxResults`

### Rate Limiting

**Issue**: "Rate limit exceeded" errors

**Solutions**:
1. Upgrade Tavily plan
2. Implement caching for common queries
3. Reduce `ragFallbackThreshold` to use RAG more

## Testing

### Test Extended Reading

```bash
# Generate summary and check for extendedReading field
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "summary",
    "sessionId": "YOUR_SESSION_ID",
    "regenerate": true
  }' | jq '.summary.extendedReading'
```

### Test Web Search Tool

```bash
# Ask a question that should trigger web search
curl -X POST http://127.0.0.1:54321/functions/v1/chat \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "message",
    "sessionId": "YOUR_SESSION_ID",
    "message": "What are the latest trends in this technology?"
  }'
```

## Future Enhancements

- [ ] Add search result caching to reduce API calls
- [ ] Support for image search results
- [ ] Time-based filtering (last week, last month)
- [ ] Domain blacklisting
- [ ] Search result ranking/scoring
- [ ] Multi-query search strategies
- [ ] Search analytics and logging

## References

- Tavily Documentation: https://docs.tavily.com/
- Tavily MCP: https://docs.tavily.com/documentation/mcp
- OpenAI Tool Calling: https://platform.openai.com/docs/guides/function-calling

## License

Same as parent project (MIT)

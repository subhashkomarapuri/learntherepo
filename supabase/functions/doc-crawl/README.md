# doc-crawl

A Supabase Edge Function that extracts documentation links from GitHub repositories and crawls them to retrieve markdown content using Crawl4AI.

## Overview

This function orchestrates two key operations:
1. **Extract documentation links** - Calls the `doc-link-extract` function to identify documentation URLs from a GitHub repository's README
2. **Crawl content** - Uses Crawl4AI to fetch and convert each documentation page to markdown

The function processes URLs in batches (4 concurrent requests) to avoid overwhelming the Crawl4AI service, and continues processing even if individual URLs fail.

## Features

- ✅ Automatically extracts documentation links from GitHub repositories
- ✅ Crawls documentation pages using Crawl4AI
- ✅ Rate limiting: 4 concurrent crawl requests
- ✅ Graceful error handling: continues on individual failures
- ✅ Returns structured results with success/failure status
- ✅ Supports specific branch/tag references
- ✅ Comprehensive metadata for each crawled page

## Prerequisites

- **Supabase local development environment** running (`supabase start`)
- **Crawl4AI service** running at `http://localhost:11235` (or custom URL via `CRAWL4AI_BASE_URL`)

### Important: Docker Networking

When running Supabase Edge Functions locally, they execute inside Docker containers. To access services running on your host machine (like Crawl4AI), you must use the special hostname `host.docker.internal` instead of `localhost`.

**Default configuration:**
- The function defaults to `http://host.docker.internal:11235`
- This allows the Docker container to reach your host's port 11235

**Custom configuration:**
Set `CRAWL4AI_BASE_URL` environment variable if your Crawl4AI runs elsewhere:
```bash
export CRAWL4AI_BASE_URL=http://custom-host:11235
```

## API Reference

### Request

**Endpoint**: `POST /functions/v1/doc-crawl`

**Headers**:
```
Authorization: Bearer <SUPABASE_ANON_KEY>
Content-Type: application/json
```

**Body**:
```typescript
{
  url: string      // Required: GitHub repository URL
  ref?: string     // Optional: Git branch, tag, or commit SHA (defaults to 'main')
}
```

**Example Request Body**:
```json
{
  "url": "https://github.com/supabase/supabase",
  "ref": "main"
}
```

### Response

**Success Response** (200):
```typescript
{
  success: true,
  owner: string,                    // Repository owner
  repo: string,                     // Repository name
  ref: string,                      // Git reference used
  totalLinks: number,               // Total documentation links found
  successfulCrawls: number,         // Number of successful crawls
  failedCrawls: number,             // Number of failed crawls
  results: Array<{
    url: string,                    // The documentation URL
    anchorText: string,             // Original link text from README
    markdown?: string,              // Crawled markdown content (if successful)
    success: boolean,               // Whether crawl succeeded
    error?: string                  // Error message (if failed)
  }>
}
```

**Example Success Response**:
```json
{
  "success": true,
  "owner": "supabase",
  "repo": "supabase",
  "ref": "main",
  "totalLinks": 5,
  "successfulCrawls": 4,
  "failedCrawls": 1,
  "results": [
    {
      "url": "https://supabase.com/docs",
      "anchorText": "Documentation",
      "markdown": "# Supabase Documentation\n\n...",
      "success": true
    },
    {
      "url": "https://supabase.com/docs/guides/auth",
      "anchorText": "Auth Guide",
      "markdown": "# Auth\n\nUse Supabase to authenticate...",
      "success": true
    },
    {
      "url": "https://example.com/broken-link",
      "anchorText": "Broken Link",
      "success": false,
      "error": "Crawl4AI returned status 404"
    }
  ]
}
```

**Error Response** (4xx/5xx):
```typescript
{
  error: string,
  message: string,
  details?: object
}
```

## Environment Variables

The function requires the following environment variables:

- `SUPABASE_URL`: Your Supabase project URL (automatically set in Edge Functions)
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key (automatically set in Edge Functions)
- `CRAWL4AI_BASE_URL` (optional): Crawl4AI service URL (defaults to `http://host.docker.internal:11235`)

These are automatically available in Supabase Edge Functions. For local development, ensure they're set in your `.env` file.

## Usage Examples

### Local Development

1. **Start Supabase**:
```bash
supabase start
```

2. **Start Crawl4AI** (in another terminal):
```bash
# Example: if using Docker
docker run -p 11235:11235 crawl4ai/server
```

3. **Call the function**:
```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-crawl' \
  --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://github.com/supabase/supabase"}'
```

### JavaScript/TypeScript Client

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

async function crawlDocs(repoUrl: string, ref?: string) {
  const { data, error } = await supabase.functions.invoke('doc-crawl', {
    body: { url: repoUrl, ref }
  })

  if (error) {
    console.error('Error:', error)
    return null
  }

  return data
}

// Usage
const result = await crawlDocs('https://github.com/supabase/supabase')
console.log(`Crawled ${result.successfulCrawls}/${result.totalLinks} documentation pages`)

result.results.forEach(page => {
  if (page.success) {
    console.log(`✓ ${page.anchorText}: ${page.markdown?.substring(0, 100)}...`)
  } else {
    console.log(`✗ ${page.anchorText}: ${page.error}`)
  }
})
```

### Python Client

```python
from supabase import create_client
import os

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_ANON_KEY"]
)

def crawl_docs(repo_url: str, ref: str = None):
    body = {"url": repo_url}
    if ref:
        body["ref"] = ref
    
    response = supabase.functions.invoke(
        "doc-crawl",
        invoke_options={"body": body}
    )
    
    return response.json()

# Usage
result = crawl_docs("https://github.com/supabase/supabase")
print(f"Crawled {result['successfulCrawls']}/{result['totalLinks']} pages")

for page in result['results']:
    if page['success']:
        print(f"✓ {page['anchorText']}: {page['markdown'][:100]}...")
    else:
        print(f"✗ {page['anchorText']}: {page['error']}")
```

## Testing

### Unit Tests

Run the unit tests that verify crawl helpers with mocked fetch:

```bash
cd supabase/functions/doc-crawl
deno test index.test.ts
```

### Manual Testing

Test the function end-to-end (requires Supabase and Crawl4AI running):

```bash
# Example with a small repository
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-crawl' \
  --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://github.com/octocat/Hello-World"}'
```

## How It Works

1. **Validate Input**: Checks for required `url` parameter
2. **Extract Links**: Calls `doc-link-extract` to get documentation URLs from the repository's README
3. **Batch Processing**: Divides links into batches of 4 for concurrent processing
4. **Crawl URLs**: For each batch:
   - Sends POST request to Crawl4AI with `{ url, f: "fit", q: null, c: "0" }`
   - Parses markdown response
   - Handles errors gracefully without stopping
5. **Aggregate Results**: Returns all results with success/failure statistics

### Crawl4AI Request Format

For each URL, the function sends:
```json
{
  "url": "https://example.com/docs",
  "f": "fit",
  "q": null,
  "c": "0"
}
```

Expected response:
```json
{
  "url": "https://example.com/docs",
  "filter": "fit",
  "query": null,
  "cache": "0",
  "markdown": "# Documentation content...",
  "success": true
}
```

## Error Handling

The function handles various error scenarios:

- **Invalid GitHub URL**: Returns 400 if the URL is not a valid GitHub repository
- **Missing Required Fields**: Returns 400 if the `url` parameter is missing
- **Configuration Errors**: Returns 500 if environment variables are not set
- **Link Extraction Failures**: Propagates errors from `doc-link-extract`
- **Individual Crawl Failures**: Marks specific URLs as failed but continues processing others
- **Crawl4AI Service Errors**: Returns error details for each failed URL

## Rate Limiting

The function processes URLs in batches of 4 concurrent requests to:
- Prevent overwhelming the Crawl4AI service
- Avoid timeout issues with large documentation sets
- Provide better error isolation (one batch failure doesn't affect others)

You can monitor progress via console logs showing batch processing.

## Dependencies

- `@supabase/functions-js@2` - Supabase Edge Runtime
- `doc-link-extract` function - Internal dependency for extracting documentation links
- Crawl4AI service - External service for web crawling and markdown conversion

## Limitations

- **Batch size**: Fixed at 4 concurrent requests (not configurable via API)
- **Network dependency**: Requires running Crawl4AI service
- **Docker networking**: Must use `host.docker.internal` when running locally in Docker
- **No retry logic**: Failed URLs are not automatically retried
- **Memory constraints**: Very large documentation sets may hit Edge Function memory limits

## Troubleshooting

### "Connection refused" errors

**Problem**: The function can't reach Crawl4AI service.

**Solutions**:
1. Verify Crawl4AI is running: `curl http://localhost:11235/health`
2. If running in Docker, ensure using `host.docker.internal:11235` (default)
3. Check firewall settings aren't blocking port 11235
4. Set `CRAWL4AI_BASE_URL` environment variable if service runs elsewhere

### All crawls failing

**Problem**: Every URL returns an error.

**Solutions**:
1. Test Crawl4AI directly:
   ```bash
   curl -X POST http://localhost:11235/md \
     -H "Content-Type: application/json" \
     -d '{"url":"https://supabase.com/docs","f":"fit","q":null,"c":"0"}'
   ```
2. Check Crawl4AI logs for errors
3. Verify network connectivity from the Edge Function container

### No documentation links found

**Problem**: Response shows `totalLinks: 0`.

**Solutions**:
1. Check the repository's README contains documentation links
2. Verify link text includes keywords like "docs", "documentation", "guide", etc.
3. Test `doc-link-extract` directly to see what links it finds

## Future Enhancements

Potential improvements:

- [ ] Configurable batch size via request parameter
- [ ] Retry logic for failed crawls
- [ ] Caching layer to avoid re-crawling same URLs
- [ ] Progress streaming for large documentation sets
- [ ] Support for custom Crawl4AI parameters (filter, cache settings)
- [ ] Parallel processing of multiple repositories
- [ ] Integration with vector databases for semantic search

## License

This function is part of the Duke AI project.

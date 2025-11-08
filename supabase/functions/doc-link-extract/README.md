# doc-link-extract

A Supabase Edge Function that extracts documentation-related links from GitHub repository README files.

## Overview

This function analyzes a GitHub repository's README file and intelligently identifies links that likely point to documentation. It calls the `github-doc` function internally to fetch the README content, then parses and filters links based on:

- **Anchor text patterns**: Keywords like "Documentation", "Docs", "API", "Guide", "Tutorial", "Wiki", "Reference", etc.
- **Documentation platforms**: Common platforms like ReadTheDocs, GitHub Pages, GitBook, etc.
- **URL patterns**: Paths containing `/docs/`, `/api/`, `/guide/`, `/documentation/`, etc.
- **File extensions**: `.md`, `.html`, `.htm`, `.rst` files

## Features

- ✅ Parses Markdown links from README files
- ✅ Intelligently filters documentation-related links
- ✅ Converts relative URLs to absolute GitHub URLs
- ✅ Filters out README files (main and localized versions)
- ✅ Supports specific branch/tag references
- ✅ Returns structured metadata for each link
- ✅ Comprehensive error handling

## API Reference

### Request

**Endpoint**: `POST /functions/v1/doc-link-extract`

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
  totalLinks: number,               // Total links found in README
  documentationLinks: number,       // Number of documentation links
  links: Array<{
    url: string,                    // Absolute URL (relative URLs converted to GitHub URLs)
    anchorText: string              // The link text/label
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
  "totalLinks": 45,
  "documentationLinks": 12,
  "links": [
    {
      "url": "https://supabase.com/docs",
      "anchorText": "Documentation"
    },
    {
      "url": "https://github.com/supabase/supabase/blob/main/DEVELOPERS.md",
      "anchorText": "Developer Guide"
    },
    {
      "url": "https://supabase.com/docs/reference/api",
      "anchorText": "API Reference"
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

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key

These are automatically available in Supabase Edge Functions but should be set in `.env` for local development.

## Usage Examples

### Local Development

1. **Start Supabase**:
```bash
supabase start
```

2. **Call the function**:
```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-link-extract' \
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

async function extractDocLinks(repoUrl: string, ref?: string) {
  const { data, error } = await supabase.functions.invoke('doc-link-extract', {
    body: { url: repoUrl, ref }
  })

  if (error) {
    console.error('Error:', error)
    return null
  }

  return data
}

// Usage
const result = await extractDocLinks('https://github.com/supabase/supabase')
console.log(`Found ${result.documentationLinks} documentation links`)
result.links.forEach(link => {
  console.log(`- ${link.anchorText}: ${link.url}`)
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

def extract_doc_links(repo_url: str, ref: str = None):
    body = {"url": repo_url}
    if ref:
        body["ref"] = ref
    
    response = supabase.functions.invoke(
        "doc-link-extract",
        invoke_options={"body": body}
    )
    
    return response.json()

# Usage
result = extract_doc_links("https://github.com/supabase/supabase")
print(f"Found {result['documentationLinks']} documentation links")
for link in result['links']:
    print(f"- {link['anchorText']}: {link['url']}")
```

## Testing

### Unit Tests

Run the unit tests that verify individual helper functions:

```bash
cd supabase/functions/doc-link-extract
deno test --allow-env --allow-net index.test.ts
```

### Integration Tests

Run integration tests that call the actual edge function (requires Supabase to be running):

```bash
# Start Supabase
supabase start

# Run integration tests
RUN_INTEGRATION_TESTS=true deno test --allow-env --allow-net integration.test.ts
```

## How It Works

1. **Parse GitHub URL**: Extracts owner and repository name from the provided URL
2. **Fetch README**: Calls the `github-doc` function to retrieve the README in raw Markdown format
3. **Extract Links**: Uses regex to parse all Markdown links `[text](url)`
4. **Filter Documentation Links**: Applies pattern matching on both anchor text and URLs to identify documentation-related links
5. **Convert Relative URLs**: Transforms relative paths to absolute GitHub URLs (e.g., `./docs/api.md` → `https://github.com/owner/repo/blob/main/docs/api.md`)
6. **Filter README Files**: Removes all README files (main `README.md` and localized versions like `README.zh-CN.md`, `README.es.md`, etc.) since the main README is already obtained
7. **Return Results**: Returns structured data with metadata and the filtered list of documentation links

## Documentation Detection Criteria

A link is considered "documentation-related" if it matches any of these criteria:

### Anchor Text Keywords
- doc, documentation, docs
- api, reference, guide, tutorial
- wiki, manual, handbook
- getting started, quickstart
- learn, examples, how to

### URL Patterns
- Documentation platforms: `readthedocs.io`, `github.io`, `gitbook.io`
- URL paths: `/docs/`, `/api/`, `/guide/`, `/tutorial/`, `/wiki/`, `/manual/`
- Domain prefixes: `docs.*`
- File extensions: `.md`, `.html`, `.htm`, `.rst`

## Error Handling

The function handles various error scenarios:

- **Invalid GitHub URL**: Returns 400 if the URL is not a valid GitHub repository URL
- **Missing Required Fields**: Returns 400 if the `url` parameter is missing
- **README Not Found**: Returns 404 if the repository or README doesn't exist
- **Configuration Errors**: Returns 500 if environment variables are not set
- **API Failures**: Properly propagates errors from the `github-doc` function

## Dependencies

- `@supabase/functions-js@2` - Supabase Edge Runtime
- `github-doc` function - Internal dependency for fetching README content

## Limitations

- Only analyzes the README file (does not crawl other documentation files)
- Relies on pattern matching (may have false positives/negatives)
- Does not validate that links are actually accessible
- Anchor-only links (`#section`) are filtered out
- README files (including localized versions) are filtered out since the main README is already obtained

## Future Enhancements

Potential improvements:

- [ ] Support for analyzing multiple documentation files beyond README
- [ ] Link validation (checking if URLs are accessible)
- [ ] Machine learning-based classification for better accuracy
- [ ] Caching to reduce API calls for frequently accessed repositories
- [ ] Support for other version control platforms (GitLab, Bitbucket)

## License

This function is part of the Duke AI project.

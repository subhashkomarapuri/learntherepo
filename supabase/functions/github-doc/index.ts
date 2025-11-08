// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"

/**
 * Interface for the request body
 */
interface GitHubDocRequest {
  url: string
  ref?: string
  mediaType?: 'default' | 'raw' | 'html'
}

/**
 * Parses a GitHub URL to extract owner and repository name
 * @param url - GitHub repository URL
 * @returns Object containing owner and repo, or null if invalid
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    // Support various GitHub URL formats:
    // - https://github.com/owner/repo
    // - https://github.com/owner/repo.git
    // - github.com/owner/repo
    const regex = /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\.]+)(?:\.git)?/i
    const match = url.match(regex)
    
    if (match && match[1] && match[2]) {
      return {
        owner: match[1],
        repo: match[2]
      }
    }
    
    return null
  } catch (_error) {
    return null
  }
}

/**
 * Gets the appropriate Accept header based on media type
 * @param mediaType - The requested media type
 * @returns The Accept header value
 */
function getAcceptHeader(mediaType?: string): string {
  switch (mediaType) {
    case 'raw':
      return 'application/vnd.github.raw+json'
    case 'html':
      return 'application/vnd.github.html+json'
    default:
      return 'application/vnd.github+json'
  }
}

/**
 * Attempts to fetch README with different filename variations
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Optional branch/tag reference
 * @param mediaType - The requested media type
 * @returns Response from GitHub API or null if not found
 */
async function fetchReadmeWithFallback(
  owner: string,
  repo: string,
  ref?: string,
  mediaType?: string
): Promise<{ response: Response; filename: string } | null> {
  // Common README filename variations (in order of preference)
  const readmeFilenames = ['README.md', 'README', 'readme.md', 'readme', 'Readme.md']
  
  const headers = {
    'Accept': getAcceptHeader(mediaType),
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Supabase-Edge-Function'
  }

  for (const filename of readmeFilenames) {
    let apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`
    if (ref) {
      apiUrl += `?ref=${encodeURIComponent(ref)}`
    }

    try {
      const response = await fetch(apiUrl, { headers })
      
      if (response.ok) {
        return { response, filename }
      }
      
      // If it's not a 404, it might be a rate limit or other error
      // In that case, we should return the error rather than continue trying
      if (response.status !== 404) {
        return { response, filename }
      }
    } catch (error) {
      console.error(`Error fetching ${filename}:`, error)
      // Continue to next filename variation
    }
  }
  
  return null
}

console.log("GitHub Doc Fetcher Function Started!")

Deno.serve(async (req) => {
  try {
    // Parse request body
    const body: GitHubDocRequest = await req.json()
    
    // Validate required fields
    if (!body.url) {
      return new Response(
        JSON.stringify({
          error: 'Missing required field: url',
          message: 'Please provide a GitHub repository URL'
        }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Parse GitHub URL
    const parsed = parseGitHubUrl(body.url)
    if (!parsed) {
      return new Response(
        JSON.stringify({
          error: 'Invalid GitHub URL',
          message: 'Please provide a valid GitHub repository URL (e.g., https://github.com/owner/repo)'
        }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const { owner, repo } = parsed

    // Fetch README from GitHub API with fallback for different filename variations
    const result = await fetchReadmeWithFallback(owner, repo, body.ref, body.mediaType)

    if (!result) {
      return new Response(
        JSON.stringify({
          error: 'README not found',
          message: `No README file found in repository ${owner}/${repo}${body.ref ? ` for ref '${body.ref}'` : ''}`,
          status: 404
        }),
        { 
          status: 404,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const { response, filename } = result

    // Handle GitHub API response
    if (!response.ok) {
      let errorMessage = 'Failed to fetch README from GitHub'
      
      switch (response.status) {
        case 404:
          errorMessage = `README not found in repository${body.ref ? ` for ref '${body.ref}'` : ''}`
          break
        case 403:
          errorMessage = 'Rate limit exceeded or access forbidden'
          break
        case 422:
          errorMessage = 'Invalid request parameters'
          break
      }

      const errorData = await response.json().catch(() => ({}))
      
      return new Response(
        JSON.stringify({
          error: errorMessage,
          status: response.status,
          details: errorData
        }),
        { 
          status: response.status,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Parse response based on media type
    let data
    if (body.mediaType === 'raw') {
      // For raw format, GitHub returns plain text
      const textContent = await response.text()
      data = {
        type: 'raw',
        content: textContent
      }
    } else if (body.mediaType === 'html') {
      // For HTML format, GitHub returns HTML content
      const htmlContent = await response.text()
      data = {
        type: 'html',
        content: htmlContent
      }
    } else {
      // For default format, GitHub returns JSON with base64-encoded content
      data = await response.json()
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        owner,
        repo,
        ref: body.ref,
        filename,
        mediaType: body.mediaType || 'default',
        data
      }),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  # Example 1: Get README from a public repository (default format)
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/github-doc' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/octocat/Hello-World"}'

  # Example 2: Get README with specific branch/tag
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/github-doc' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/octocat/Hello-World","ref":"main"}'

  # Example 3: Get README as raw content => This returns markdown that we can feed into LLMs!
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/github-doc' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/octocat/Hello-World","mediaType":"raw"}'

  # Example 4: Get README as HTML
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/github-doc' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/octocat/Hello-World","mediaType":"html"}'

*/

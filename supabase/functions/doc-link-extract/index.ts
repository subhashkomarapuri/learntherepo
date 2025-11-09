// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"

/**
 * Interface for the request body
 */
interface DocLinkExtractRequest {
  url: string
  ref?: string
}

/**
 * Interface for extracted documentation links
 */
interface DocumentationLink {
  url: string
  anchorText: string
}

/**
 * Interface for the response from github-doc function
 */
interface GitHubDocResponse {
  success: boolean
  owner: string
  repo: string
  data: {
    content?: string
    type?: string
  }
}

/**
 * Parses a GitHub URL to extract owner and repository name
 * @param url - GitHub repository URL
 * @returns Object containing owner and repo, or null if invalid
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
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
 * Detects the default branch for a GitHub repository
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Optional explicit ref; if provided, returns it directly
 * @returns The branch name to use
 */
async function detectDefaultBranch(
  owner: string,
  repo: string,
  ref?: string
): Promise<string> {
  // If ref is explicitly provided, use it
  if (ref) {
    return ref
  }

  try {
    // Query GitHub API for repository info to get default branch
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Supabase-Edge-Function'
    }

    const response = await fetch(apiUrl, { headers })
    
    if (response.ok) {
      const repoData = await response.json()
      if (repoData.default_branch) {
        console.log(`Detected default branch: ${repoData.default_branch}`)
        return repoData.default_branch
      }
    }
  } catch (error) {
    console.warn('Failed to detect default branch from API:', error)
  }

  // Fallback: try 'main' first, then 'master'
  console.log('Using fallback default branch: main')
  return 'main'
}

/**
 * Extracts all markdown links from content
 * Returns array of {text, url} objects
 */
function extractMarkdownLinks(markdown: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = []
  
  // Regex to match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  
  let match
  while ((match = linkRegex.exec(markdown)) !== null) {
    links.push({
      text: match[1].trim(),
      url: match[2].trim()
    })
  }
  
  return links
}

/**
 * Determines if a link is likely documentation based on anchor text and URL
 * @param text - The anchor text of the link
 * @param url - The URL of the link
 * @returns true if the link appears to be documentation-related
 */
function isLikelyDocumentation(text: string, url: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerUrl = url.toLowerCase()
  
  // Documentation-related keywords in anchor text
  const docKeywords = [
    'doc', 'documentation', 'docs',
    'api', 'reference', 'guide', 'tutorial',
    'wiki', 'manual', 'handbook',
    'getting started', 'quickstart', 'quick start',
    'learn', 'examples', 'how to'
  ]
  
  // Check if anchor text contains documentation keywords
  const hasDocKeyword = docKeywords.some(keyword => lowerText.includes(keyword))
  
  // Documentation platform patterns in URL
  const docPlatforms = [
    'readthedocs.io',
    'github.io',
    'gitbook.io',
    'docs.',
    '/docs/',
    '/doc/',
    '/documentation/',
    '/api/',
    '/reference/',
    '/guide/',
    '/tutorial/',
    '/wiki/',
    '/manual/'
  ]
  
  // Check if URL contains documentation platform patterns
  const hasDocPlatform = docPlatforms.some(platform => lowerUrl.includes(platform))
  
  // Documentation file extensions
  const docExtensions = ['.md', '.html', '.htm', '.rst']
  const hasDocExtension = docExtensions.some(ext => lowerUrl.endsWith(ext))
  
  return hasDocKeyword || hasDocPlatform || hasDocExtension
}

/**
 * Checks if a URL points to a README file (main or localized)
 * @param url - The URL to check
 * @returns true if the URL points to any README file
 */
function isReadmeFile(url: string): boolean {
  const lowerUrl = url.toLowerCase()
  
  // Extract the filename from the URL
  const urlParts = lowerUrl.split('/')
  const filename = urlParts[urlParts.length - 1]
  
  // Check for main README files (with or without extension)
  if (filename === 'readme' || filename === 'readme.md' || 
      filename === 'readme.markdown' || filename === 'readme.rst' ||
      filename === 'readme.txt') {
    return true
  }
  
  // Check for localized README files (e.g., README.zh-CN.md, README.es.md)
  // Pattern: readme.<language-code>.<extension> or readme-<language-code>.<extension>
  const localizedReadmePattern = /^readme[._-][a-z]{2}(-[a-z]{2})?\.?(md|markdown|rst|txt)?$/i
  if (localizedReadmePattern.test(filename)) {
    return true
  }
  
  return false
}

/**
 * Converts relative URLs to absolute GitHub URLs
 * @param url - The URL to convert (may be relative or absolute)
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param ref - Git reference (branch/tag), defaults to main
 * @returns Absolute URL
 */
function toAbsoluteUrl(url: string, owner: string, repo: string, ref: string = 'main'): string {
  // If already absolute, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  
  // Handle anchor-only links (skip them)
  if (url.startsWith('#')) {
    return url
  }
  
  // Remove leading ./ or /
  const cleanUrl = url.replace(/^\.\//, '').replace(/^\//, '')
  
  // Convert to GitHub blob/tree URL
  // For markdown and other text files, use 'blob'
  // For directories, use 'tree'
  const urlType = cleanUrl.endsWith('/') ? 'tree' : 'blob'
  
  return `https://github.com/${owner}/${repo}/${urlType}/${ref}/${cleanUrl}`
}

console.log("Doc Link Extract Function Started!")

Deno.serve(async (req) => {
  try {
    // Parse request body
    const body: DocLinkExtractRequest = await req.json()
    
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

    // Parse GitHub URL to get owner and repo
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

    // Detect the default branch if not explicitly provided
    const detectedRef = await detectDefaultBranch(owner, repo, body.ref)

    // Get Supabase configuration from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          error: 'Configuration error',
          message: 'SUPABASE_URL and SUPABASE_ANON_KEY environment variables must be set'
        }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Call github-doc function to fetch README in raw format
    const githubDocUrl = `${supabaseUrl}/functions/v1/github-doc`
    const githubDocRequest = {
      url: body.url,
      ref: detectedRef,
      mediaType: 'raw'
    }

    console.log(`Calling github-doc function: ${githubDocUrl}`)
    
    const githubDocResponse = await fetch(githubDocUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(githubDocRequest)
    })

    if (!githubDocResponse.ok) {
      const errorData = await githubDocResponse.json()
      return new Response(
        JSON.stringify({
          error: 'Failed to fetch README',
          message: 'github-doc function returned an error',
          details: errorData
        }),
        { 
          status: githubDocResponse.status,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const githubDocData: GitHubDocResponse = await githubDocResponse.json()
    
    if (!githubDocData.success || !githubDocData.data.content) {
      return new Response(
        JSON.stringify({
          error: 'Invalid response from github-doc',
          message: 'Could not retrieve README content'
        }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const readmeContent = githubDocData.data.content

    // Extract all markdown links
    const allLinks = extractMarkdownLinks(readmeContent)
    
    // Filter for documentation-related links
    const docLinks = allLinks
      .filter(link => isLikelyDocumentation(link.text, link.url))
      .map(link => {
        // Convert relative URLs to absolute GitHub URLs
        const absoluteUrl = toAbsoluteUrl(link.url, owner, repo, detectedRef)
        
        return {
          url: absoluteUrl,
          anchorText: link.text
        } as DocumentationLink
      })
      // Remove anchor-only links
      .filter(link => !link.url.startsWith('#'))
      // Remove README files (main and localized versions)
      .filter(link => !isReadmeFile(link.url))

    return new Response(
      JSON.stringify({
        success: true,
        owner,
        repo,
        ref: detectedRef,
        totalLinks: allLinks.length,
        documentationLinks: docLinks.length,
        links: docLinks
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

  # Example 1: Extract documentation links from a repository
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-link-extract' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/supabase/supabase"}'

  # Example 2: Extract from a specific branch
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-link-extract' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/supabase/supabase","ref":"main"}'

*/

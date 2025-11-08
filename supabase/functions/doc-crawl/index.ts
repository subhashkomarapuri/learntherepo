// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"

/**
 * Interface for the request body
 */
interface DocCrawlRequest {
  url: string
  ref?: string
}

/**
 * Interface for a documentation link from doc-link-extract
 */
interface DocumentationLink {
  url: string
  anchorText: string
}

/**
 * Interface for the response from doc-link-extract function
 */
interface DocLinkExtractResponse {
  success: boolean
  owner: string
  repo: string
  ref: string
  totalLinks: number
  documentationLinks: number
  links: DocumentationLink[]
}

/**
 * Interface for Crawl4AI request
 */
interface Crawl4AIRequest {
  url: string
  f: string
  q: null
  c: string
}

/**
 * Interface for Crawl4AI response
 */
interface Crawl4AIResponse {
  url: string
  filter: string
  query: null
  cache: string
  markdown: string
  success: boolean
}

/**
 * Interface for a single crawl result
 */
interface CrawlResult {
  url: string
  anchorText: string
  markdown?: string
  success: boolean
  error?: string
}

/**
 * Crawls a single URL using Crawl4AI
 * @param url - The URL to crawl
 * @param anchorText - The original anchor text from the link
 * @param crawl4aiBaseUrl - Base URL for Crawl4AI service
 * @returns CrawlResult with markdown content or error
 */
async function crawlUrl(
  url: string,
  anchorText: string,
  crawl4aiBaseUrl: string
): Promise<CrawlResult> {
  try {
    const crawl4aiUrl = `${crawl4aiBaseUrl}/md`
    const requestBody: Crawl4AIRequest = {
      url,
      f: "fit",
      q: null,
      c: "0"
    }

    console.log(`Crawling: ${url}`)

    const response = await fetch(crawl4aiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      return {
        url,
        anchorText,
        success: false,
        error: `Crawl4AI returned status ${response.status}`
      }
    }

    const data: Crawl4AIResponse = await response.json()

    if (!data.success) {
      return {
        url,
        anchorText,
        success: false,
        error: 'Crawl4AI indicated failure in response'
      }
    }

    return {
      url,
      anchorText,
      markdown: data.markdown,
      success: true
    }
  } catch (error) {
    console.error(`Error crawling ${url}:`, error)
    return {
      url,
      anchorText,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

/**
 * Processes URLs in batches with concurrency limit
 * @param links - Array of documentation links to crawl
 * @param crawl4aiBaseUrl - Base URL for Crawl4AI service
 * @param batchSize - Number of concurrent requests (default: 4)
 * @returns Array of crawl results
 */
async function crawlInBatches(
  links: DocumentationLink[],
  crawl4aiBaseUrl: string,
  batchSize: number = 4
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  // Process links in batches
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize)
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} URLs)`)

    // Crawl all URLs in current batch concurrently
    const batchResults = await Promise.all(
      batch.map(link => crawlUrl(link.url, link.anchorText, crawl4aiBaseUrl))
    )

    results.push(...batchResults)
  }

  return results
}

console.log("Doc Crawl Function Started!")

Deno.serve(async (req) => {
  try {
    // Parse request body
    const body: DocCrawlRequest = await req.json()

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

    // Get configuration from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')
    // Use host.docker.internal to access host machine's localhost from Docker container
    const crawl4aiBaseUrl = Deno.env.get('CRAWL4AI_BASE_URL') || 'http://host.docker.internal:11235'

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

    // Call doc-link-extract function to get documentation links
    const docLinkExtractUrl = `${supabaseUrl}/functions/v1/doc-link-extract`
    const docLinkExtractRequest = {
      url: body.url,
      ref: body.ref
    }

    console.log(`Calling doc-link-extract function: ${docLinkExtractUrl}`)

    const docLinkExtractResponse = await fetch(docLinkExtractUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(docLinkExtractRequest)
    })

    if (!docLinkExtractResponse.ok) {
      const errorData = await docLinkExtractResponse.json()
      return new Response(
        JSON.stringify({
          error: 'Failed to extract documentation links',
          message: 'doc-link-extract function returned an error',
          details: errorData
        }),
        {
          status: docLinkExtractResponse.status,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const docLinkExtractData: DocLinkExtractResponse = await docLinkExtractResponse.json()

    if (!docLinkExtractData.success) {
      return new Response(
        JSON.stringify({
          error: 'Invalid response from doc-link-extract',
          message: 'Could not retrieve documentation links'
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const { owner, repo, ref, links } = docLinkExtractData

    if (!links || links.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          owner,
          repo,
          ref,
          totalLinks: 0,
          results: [],
          message: 'No documentation links found to crawl'
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    console.log(`Found ${links.length} documentation links to crawl`)

    // Crawl all documentation links with rate limiting (4 concurrent)
    const crawlResults = await crawlInBatches(links, crawl4aiBaseUrl, 4)

    // Calculate statistics
    const successCount = crawlResults.filter(r => r.success).length
    const failureCount = crawlResults.filter(r => !r.success).length

    console.log(`Crawling complete: ${successCount} successful, ${failureCount} failed`)

    return new Response(
      JSON.stringify({
        success: true,
        owner,
        repo,
        ref,
        totalLinks: links.length,
        successfulCrawls: successCount,
        failedCrawls: failureCount,
        results: crawlResults
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
  2. Make sure Crawl4AI is running at http://localhost:11235
  3. Make an HTTP request:

  # Example 1: Crawl documentation links from a repository
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-crawl' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/supabase/supabase"}'

  # Example 2: Crawl from a specific branch
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/doc-crawl' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/microsoft/vs-code-copilot-chat","ref":"main"}'

*/

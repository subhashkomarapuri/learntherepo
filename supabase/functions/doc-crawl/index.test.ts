import { assertEquals, assertExists } from "jsr:@std/assert"

/**
 * Unit tests for doc-crawl helpers
 * Run with: deno test supabase/functions/doc-crawl/index.test.ts
 * These tests mock global fetch to avoid network calls.
 */

interface DocumentationLink {
  url: string
  anchorText: string
}

interface CrawlResult {
  url: string
  anchorText: string
  markdown?: string
  success: boolean
  error?: string
}

// Minimal Crawl4AI response shape used in tests
const sampleCrawlResponse = {
  url: "https://supabase.com/docs/guides/auth",
  filter: "fit",
  query: null,
  cache: "0",
  markdown: "# Auth\nAuth content...",
  success: true
}

// Implementation copied/adapted from function for unit testing
async function crawlUrl(
  url: string,
  anchorText: string,
  crawl4aiBaseUrl: string
): Promise<CrawlResult> {
  try {
    const crawl4aiUrl = `${crawl4aiBaseUrl}/md`
    const requestBody = {
      url,
      f: "fit",
      q: null,
      c: "0"
    }

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

    const data = await response.json()

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
    return {
      url,
      anchorText,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

async function crawlInBatches(
  links: DocumentationLink[],
  crawl4aiBaseUrl: string,
  batchSize: number = 4
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = []

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(link => crawlUrl(link.url, link.anchorText, crawl4aiBaseUrl))
    )
    results.push(...batchResults)
  }

  return results
}

// Helper to set global fetch with proper typing (avoids using `any`)
function setFetch(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(globalThis as unknown as { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }).fetch = fn
}

Deno.test("crawlUrl - success", async () => {
  const originalFetch = globalThis.fetch
  try {
    setFetch((_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(new Response(JSON.stringify(sampleCrawlResponse), { status: 200 }))
    })

    const res = await crawlUrl(sampleCrawlResponse.url, "Auth Guide", "http://host")
    assertEquals(res.success, true)
    assertExists(res.markdown)
    assertEquals(res.markdown?.startsWith('# Auth'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("crawlUrl - non-200 response", async () => {
  const originalFetch = globalThis.fetch
  try {
    setFetch((_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(new Response('err', { status: 500 }))
    })

    const res = await crawlUrl('https://example.com/bad', "Bad", "http://host")
    assertEquals(res.success, false)
    assertEquals(typeof res.error, 'string')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("crawlInBatches - batches and returns all results", async () => {
  const originalFetch = globalThis.fetch
  try {
    let callCount = 0
    setFetch((_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1
      return Promise.resolve(new Response(JSON.stringify(sampleCrawlResponse), { status: 200 }))
    })

    const links: DocumentationLink[] = Array.from({ length: 6 }).map((_, idx) => ({
      url: `https://example.com/page-${idx}`,
      anchorText: `Page ${idx}`
    }))

    const results = await crawlInBatches(links, 'http://host', 4)
    assertEquals(results.length, 6)
    assertEquals(results.every(r => r.success), true)
    // ensure batching triggered (calls should equal number of links)
    assertEquals(callCount, 6)
  } finally {
    globalThis.fetch = originalFetch
  }
})

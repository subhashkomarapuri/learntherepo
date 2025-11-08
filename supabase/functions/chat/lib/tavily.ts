/**
 * Tavily Search API Integration
 * Provides web search capabilities for the chat function
 * Documentation: https://docs.tavily.com/
 */

import { TAVILY_CONFIG } from './config.ts'

/**
 * Tavily search request parameters
 */
export interface TavilySearchParams {
  query: string
  searchDepth?: 'basic' | 'advanced'
  maxResults?: number
  includeImages?: boolean
  includeAnswer?: boolean
  includeRawContent?: boolean
  includeDomains?: string[]
  excludeDomains?: string[]
}

/**
 * Tavily search result item
 */
export interface TavilySearchResult {
  title: string
  url: string
  content: string
  score: number
  publishedDate?: string
}

/**
 * Tavily API response
 */
export interface TavilySearchResponse {
  query: string
  answer?: string
  results: TavilySearchResult[]
  images?: Array<{
    url: string
    description: string
  }>
  responseTime: number
}

/**
 * Formatted search result for LLM context
 */
export interface FormattedSearchResult {
  sources: Array<{
    title: string
    url: string
    snippet: string
    relevance: number
  }>
  summary?: string
  searchQuery: string
}

/**
 * Call Tavily Search API
 */
export async function searchTavily(
  query: string,
  apiKey: string,
  options?: Partial<TavilySearchParams>
): Promise<TavilySearchResponse> {
  const params: TavilySearchParams = {
    query,
    searchDepth: options?.searchDepth ?? TAVILY_CONFIG.defaultSearchDepth,
    maxResults: options?.maxResults ?? TAVILY_CONFIG.defaultMaxResults,
    includeImages: options?.includeImages ?? TAVILY_CONFIG.includeImages,
    includeAnswer: options?.includeAnswer ?? TAVILY_CONFIG.includeAnswer,
    includeRawContent: options?.includeRawContent ?? false,
    includeDomains: options?.includeDomains,
    excludeDomains: options?.excludeDomains
  }

  console.log(`Searching Tavily: "${query}" (depth: ${params.searchDepth}, max: ${params.maxResults})`)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TAVILY_CONFIG.timeout)

    const response = await fetch(TAVILY_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: params.query,
        search_depth: params.searchDepth,
        max_results: params.maxResults,
        include_images: params.includeImages,
        include_answer: params.includeAnswer,
        include_raw_content: params.includeRawContent,
        include_domains: params.includeDomains,
        exclude_domains: params.excludeDomains
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Tavily API error (${response.status}): ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()

    return {
      query: data.query,
      answer: data.answer,
      results: data.results || [],
      images: data.images,
      responseTime: data.response_time || 0
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Tavily search timeout after ${TAVILY_CONFIG.timeout}ms`)
    }
    throw error
  }
}

/**
 * Format Tavily search results for LLM consumption
 */
export function formatSearchResults(
  response: TavilySearchResponse,
  maxLength: number = 3000
): FormattedSearchResult {
  const sources = response.results.map(result => ({
    title: result.title,
    url: result.url,
    snippet: result.content.substring(0, 500), // Limit snippet length
    relevance: result.score
  }))

  // Sort by relevance
  sources.sort((a, b) => b.relevance - a.relevance)

  // Build context text
  let contextText = ''
  const includedSources: typeof sources = []

  for (const source of sources) {
    const sourceText = `\n\n[${source.title}](${source.url})\n${source.snippet}`
    
    if (contextText.length + sourceText.length <= maxLength) {
      contextText += sourceText
      includedSources.push(source)
    } else {
      break
    }
  }

  return {
    sources: includedSources,
    summary: response.answer,
    searchQuery: response.query
  }
}

/**
 * Search for repository-related information
 * Used in summary generation for "Extended Reading"
 */
export async function searchRepositoryInfo(
  repositoryName: string,
  repositoryOwner: string,
  apiKey: string
): Promise<FormattedSearchResult> {
  const query = `${repositoryOwner}/${repositoryName} GitHub repository tutorial guide documentation`
  
  const response = await searchTavily(query, apiKey, {
    searchDepth: 'advanced',
    maxResults: TAVILY_CONFIG.extendedReadingMaxResults,
    includeAnswer: true,
    // Focus on documentation and tutorial sites
    includeDomains: TAVILY_CONFIG.preferredDomains.length > 0 
      ? TAVILY_CONFIG.preferredDomains 
      : undefined
  })

  return formatSearchResults(response, TAVILY_CONFIG.maxContextLength)
}

/**
 * Search for general web information
 * Used when RAG context is insufficient or user asks for web search
 */
export async function searchWeb(
  query: string,
  apiKey: string,
  options?: {
    maxResults?: number
    includeDomains?: string[]
    excludeDomains?: string[]
  }
): Promise<FormattedSearchResult> {
  const response = await searchTavily(query, apiKey, {
    searchDepth: 'advanced',
    maxResults: options?.maxResults ?? TAVILY_CONFIG.defaultMaxResults,
    includeAnswer: true,
    includeDomains: options?.includeDomains,
    excludeDomains: options?.excludeDomains
  })

  return formatSearchResults(response, TAVILY_CONFIG.maxContextLength)
}

/**
 * Determine if a query should trigger web search
 * Based on keywords and context
 */
export function shouldUseWebSearch(query: string, ragSimilarity?: number): boolean {
  const lowerQuery = query.toLowerCase()
  
  // Keywords that suggest web search is needed
  const webSearchKeywords = [
    'latest',
    'recent',
    'current',
    'news',
    'search',
    'web search',
    'google',
    'find',
    'look up',
    'what is happening',
    'update',
    'today',
    'now'
  ]

  const hasWebSearchKeyword = webSearchKeywords.some(keyword => 
    lowerQuery.includes(keyword)
  )

  // Use web search if:
  // 1. User explicitly asks for it
  // 2. RAG similarity is very low (< 0.5)
  if (hasWebSearchKeyword) {
    return true
  }

  if (ragSimilarity !== undefined && ragSimilarity < TAVILY_CONFIG.ragFallbackThreshold) {
    return true
  }

  return false
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return url
  }
}

/**
 * Filter search results by minimum relevance score
 */
export function filterByRelevance(
  results: TavilySearchResult[],
  minScore: number = 0.5
): TavilySearchResult[] {
  return results.filter(result => result.score >= minScore)
}

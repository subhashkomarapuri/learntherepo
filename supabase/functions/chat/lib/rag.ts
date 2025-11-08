/**
 * RAG (Retrieval-Augmented Generation) module
 * Handles vector search and context preparation for LLM
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { RAG_CONFIG } from './config.ts'
import type { RAGConfig, RAGSource, MatchDocumentsResult } from './types.ts'

/**
 * Retrieve relevant document chunks using vector similarity search
 */
export async function retrieveContext(
  client: SupabaseClient,
  queryEmbedding: number[],
  repositoryOwner: string,
  repositoryName: string,
  repositoryRef: string,
  config?: RAGConfig
): Promise<RAGSource[]> {
  const matchThreshold = config?.matchThreshold ?? RAG_CONFIG.defaultThreshold
  const matchCount = Math.min(
    config?.matchCount ?? RAG_CONFIG.defaultMatchCount,
    RAG_CONFIG.maxMatchCount
  )

  console.log(`Searching for relevant context: threshold=${matchThreshold}, count=${matchCount}`)

  try {
    const { data, error } = await client.rpc('match_documents', {
      query_embedding: queryEmbedding,
      repo_owner: repositoryOwner,
      repo_name: repositoryName,
      repo_ref: repositoryRef,
      match_threshold: matchThreshold,
      match_count: matchCount
    })

    if (error) {
      console.error('Error calling match_documents:', error)
      throw new Error(`RAG search failed: ${error.message}`)
    }

    if (!data || data.length === 0) {
      console.log('No relevant documents found')
      return []
    }

    console.log(`Found ${data.length} relevant documents`)

    // Convert database results to RAGSource format
    const sources: RAGSource[] = data.map((result: MatchDocumentsResult) => ({
      chunkId: result.chunk_id,
      chunkText: result.chunk_text,
      documentUrl: result.document_url,
      similarity: result.similarity
    }))

    // Sort by similarity (highest first)
    sources.sort((a, b) => b.similarity - a.similarity)

    return sources
  } catch (error) {
    console.error('Error in retrieveContext:', error)
    throw error
  }
}

/**
 * Generate embedding for a query using OpenAI
 */
export async function generateQueryEmbedding(
  query: string,
  apiKey: string
): Promise<number[]> {
  const url = 'https://api.openai.com/v1/embeddings'
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: query,
        model: 'text-embedding-3-small'
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`OpenAI embedding error (${response.status}): ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    
    if (!data.data || data.data.length === 0) {
      throw new Error('No embedding returned from OpenAI')
    }

    return data.data[0].embedding
  } catch (error) {
    console.error('Error generating query embedding:', error)
    throw error
  }
}

/**
 * Prepare RAG context for LLM
 * Truncates context if it exceeds maximum length
 */
export function prepareContext(
  sources: RAGSource[],
  maxLength: number = RAG_CONFIG.maxContextLength
): { sources: RAGSource[]; truncated: boolean } {
  if (sources.length === 0) {
    return { sources: [], truncated: false }
  }

  let totalLength = 0
  const selectedSources: RAGSource[] = []

  for (const source of sources) {
    const sourceLength = source.chunkText.length
    
    if (totalLength + sourceLength <= maxLength) {
      selectedSources.push(source)
      totalLength += sourceLength
    } else {
      // Try to fit a truncated version of this source
      const remainingSpace = maxLength - totalLength
      if (remainingSpace > 200) {  // Only include if we can fit at least 200 chars
        selectedSources.push({
          ...source,
          chunkText: source.chunkText.substring(0, remainingSpace - 3) + '...'
        })
      }
      break
    }
  }

  const truncated = selectedSources.length < sources.length

  if (truncated) {
    console.log(`Context truncated: using ${selectedSources.length}/${sources.length} sources`)
  }

  return { sources: selectedSources, truncated }
}

/**
 * Check if RAG context is sufficient
 * Returns true if we have enough high-quality matches
 */
export function isContextSufficient(sources: RAGSource[]): boolean {
  if (sources.length === 0) {
    return false
  }

  // Check if we have at least the minimum number of chunks
  if (sources.length < RAG_CONFIG.minChunksForContext) {
    return false
  }

  // Check if the best match is above the fallback threshold
  const bestSimilarity = Math.max(...sources.map(s => s.similarity))
  if (bestSimilarity < RAG_CONFIG.fallbackThreshold) {
    console.log(`Best similarity ${bestSimilarity} below fallback threshold ${RAG_CONFIG.fallbackThreshold}`)
    return false
  }

  return true
}

/**
 * Perform complete RAG workflow for a query
 * Returns sources and whether to use fallback
 */
export async function performRAG(
  client: SupabaseClient,
  query: string,
  repositoryOwner: string,
  repositoryName: string,
  repositoryRef: string,
  apiKey: string,
  config?: RAGConfig
): Promise<{
  sources: RAGSource[]
  useFallback: boolean
  embedding: number[]
}> {
  console.log('Starting RAG workflow for query:', query.substring(0, 100))

  // Step 1: Generate query embedding
  const embedding = await generateQueryEmbedding(query, apiKey)
  console.log(`Generated embedding: ${embedding.length} dimensions`)

  // Step 2: Retrieve relevant context
  const allSources = await retrieveContext(
    client,
    embedding,
    repositoryOwner,
    repositoryName,
    repositoryRef,
    config
  )

  // Step 3: Prepare context (truncate if needed)
  const { sources, truncated } = prepareContext(allSources)

  if (truncated) {
    console.log(`Context was truncated to fit within ${RAG_CONFIG.maxContextLength} characters`)
  }

  // Step 4: Determine if we should use fallback
  const useFallback = !isContextSufficient(sources)

  if (useFallback) {
    console.log('Insufficient context - will use fallback mode')
  } else {
    console.log(`Using ${sources.length} sources for context`)
  }

  return {
    sources,
    useFallback,
    embedding
  }
}

/**
 * Calculate context statistics
 */
export function getContextStats(sources: RAGSource[]): {
  count: number
  totalChars: number
  avgSimilarity: number
  minSimilarity: number
  maxSimilarity: number
} {
  if (sources.length === 0) {
    return {
      count: 0,
      totalChars: 0,
      avgSimilarity: 0,
      minSimilarity: 0,
      maxSimilarity: 0
    }
  }

  const similarities = sources.map(s => s.similarity)
  const totalChars = sources.reduce((sum, s) => sum + s.chunkText.length, 0)

  return {
    count: sources.length,
    totalChars,
    avgSimilarity: similarities.reduce((sum, s) => sum + s, 0) / similarities.length,
    minSimilarity: Math.min(...similarities),
    maxSimilarity: Math.max(...similarities)
  }
}

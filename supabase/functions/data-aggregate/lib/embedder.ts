/**
 * OpenAI embedding utilities
 * Generates vector embeddings using OpenAI's embedding models
 */

import type { BatchEmbeddingResult } from './types.ts'

/**
 * Configuration for embedding generation
 */
export interface EmbedderConfig {
  apiKey: string
  model?: string           // Default: 'text-embedding-3-small'
  batchSize?: number       // Maximum texts per batch (default: 100)
  maxRetries?: number      // Retry failed requests (default: 3)
}

/**
 * Default embedding model
 * text-embedding-3-small: 1536 dimensions, cheaper and faster than ada-002
 */
const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_MAX_RETRIES = 3
const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings'

/**
 * Interface for OpenAI embedding request
 */
interface EmbeddingRequest {
  input: string | string[]
  model: string
}

/**
 * Interface for OpenAI embedding response
 */
interface EmbeddingResponse {
  object: string
  data: Array<{
    object: string
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

/**
 * Sleeps for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generates embeddings for a batch of texts using OpenAI API
 * 
 * @param texts - Array of text strings to embed
 * @param config - Embedder configuration with API key
 * @returns Batch embedding result with vectors and metadata
 */
export async function generateEmbeddings(
  texts: string[],
  config: EmbedderConfig
): Promise<BatchEmbeddingResult> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    maxRetries = DEFAULT_MAX_RETRIES
  } = config

  if (!apiKey) {
    throw new Error('OpenAI API key is required')
  }

  if (!texts || texts.length === 0) {
    throw new Error('No texts provided for embedding')
  }

  // Validate texts
  const validTexts = texts.filter(text => text && text.trim().length > 0)
  if (validTexts.length === 0) {
    throw new Error('No valid texts after filtering empty strings')
  }

  let lastError: Error | null = null

  // Retry logic
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const requestBody: EmbeddingRequest = {
        input: validTexts,
        model
      }

      console.log(`Generating embeddings for ${validTexts.length} texts (attempt ${attempt + 1}/${maxRetries})`)

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10)
          console.warn(`Rate limited, retrying after ${retryAfter}s...`)
          await sleep(retryAfter * 1000)
          continue
        }

        throw new Error(`OpenAI API error (${response.status}): ${JSON.stringify(errorData)}`)
      }

      const data: EmbeddingResponse = await response.json()

      // Sort embeddings by index to ensure correct order
      const sortedEmbeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding)

      console.log(`Successfully generated ${sortedEmbeddings.length} embeddings (${data.usage.total_tokens} tokens)`)

      return {
        embeddings: sortedEmbeddings,
        model: data.model,
        totalTokens: data.usage.total_tokens
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error')
      console.error(`Embedding attempt ${attempt + 1} failed:`, lastError.message)
      
      if (attempt < maxRetries - 1) {
        // Exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000)
        console.log(`Retrying in ${backoffMs}ms...`)
        await sleep(backoffMs)
      }
    }
  }

  throw new Error(`Failed to generate embeddings after ${maxRetries} attempts: ${lastError?.message}`)
}

/**
 * Generates embeddings for texts in batches to avoid API limits
 * 
 * @param texts - Array of text strings to embed
 * @param config - Embedder configuration with API key
 * @returns Combined batch embedding result
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  config: EmbedderConfig
): Promise<BatchEmbeddingResult> {
  const { batchSize = DEFAULT_BATCH_SIZE } = config

  if (!texts || texts.length === 0) {
    throw new Error('No texts provided for batch embedding')
  }

  // If texts fit in single batch, use direct method
  if (texts.length <= batchSize) {
    return generateEmbeddings(texts, config)
  }

  console.log(`Processing ${texts.length} texts in batches of ${batchSize}`)

  const allEmbeddings: number[][] = []
  let totalTokens = 0
  let model = ''

  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(texts.length / batchSize)

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} texts)`)

    try {
      const result = await generateEmbeddings(batch, config)
      allEmbeddings.push(...result.embeddings)
      totalTokens += result.totalTokens
      model = result.model

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < texts.length) {
        await sleep(100)
      }
    } catch (error) {
      console.error(`Failed to process batch ${batchNum}:`, error)
      throw error
    }
  }

  console.log(`Completed batch embedding: ${allEmbeddings.length} embeddings, ${totalTokens} total tokens`)

  return {
    embeddings: allEmbeddings,
    model,
    totalTokens
  }
}

/**
 * Estimates the token count for texts
 * Rough estimation: ~1 token per 4 characters for English text
 * 
 * @param texts - Array of text strings
 * @returns Estimated token count
 */
export function estimateTokens(texts: string[]): number {
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  return Math.ceil(totalChars / 4)
}

/**
 * Estimates the cost for embedding texts using OpenAI
 * Based on text-embedding-3-small pricing: $0.02 per 1M tokens
 * 
 * @param texts - Array of text strings
 * @param model - Embedding model (default: text-embedding-3-small)
 * @returns Estimated cost in USD
 */
export function estimateCost(texts: string[], model: string = DEFAULT_MODEL): number {
  const tokens = estimateTokens(texts)
  
  // Pricing per 1M tokens
  const pricing: Record<string, number> = {
    'text-embedding-3-small': 0.02,
    'text-embedding-3-large': 0.13,
    'text-embedding-ada-002': 0.10
  }
  
  const pricePerMillion = pricing[model] || 0.02
  return (tokens / 1_000_000) * pricePerMillion
}

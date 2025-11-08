/**
 * Type definitions for data-aggregate function
 */

/**
 * Interface for the request body
 */
export interface DataAggregateRequest {
  url: string
  ref?: string
  force?: boolean // Force reprocessing even if repo exists
}

/**
 * Interface for GitHub repository info
 */
export interface RepositoryInfo {
  owner: string
  repo: string
  ref: string
  url: string
}

/**
 * Interface for a document from crawling
 */
export interface Document {
  url: string
  anchorText?: string
  content: string
  sourceType: 'readme' | 'documentation'
}

/**
 * Interface for a text chunk
 */
export interface DocumentChunk {
  text: string
  index: number
  metadata?: {
    url?: string
    anchorText?: string
    sourceType?: string
    chunkIndex?: number
    totalChunks?: number
  }
}

/**
 * Interface for embedding result
 */
export interface EmbeddingResult {
  embedding: number[]
  model: string
  usage?: {
    prompt_tokens: number
    total_tokens: number
  }
}

/**
 * Interface for batch embedding result
 */
export interface BatchEmbeddingResult {
  embeddings: number[][]
  model: string
  totalTokens: number
}

/**
 * Interface for stored repository record
 */
export interface RepositoryRecord {
  id: string
  owner: string
  repo: string
  ref: string
  url: string
  lastProcessedAt: string
  totalDocuments: number
  totalChunks: number
  createdAt: string
  updatedAt: string
}

/**
 * Interface for stored document record
 */
export interface DocumentRecord {
  id: string
  repositoryId: string
  url: string
  anchorText?: string
  content: string
  contentLength: number
  sourceType: 'readme' | 'documentation'
  createdAt: string
  updatedAt: string
}

/**
 * Interface for stored chunk record
 */
export interface ChunkRecord {
  id: string
  documentId: string
  repositoryId: string
  chunkText: string
  chunkIndex: number
  chunkLength: number
  metadata?: Record<string, unknown>
  createdAt: string
}

/**
 * Interface for stored embedding record
 */
export interface EmbeddingRecord {
  id: string
  chunkId: string
  repositoryId: string
  embedding: number[]
  model: string
  createdAt: string
}

/**
 * Interface for processing statistics
 */
export interface ProcessingStats {
  repositoryId: string
  owner: string
  repo: string
  ref: string
  documentsProcessed: number
  chunksCreated: number
  embeddingsCreated: number
  documentsSkipped: number
  documentsFailed: number
  totalTokensUsed: number
  processingTimeMs: number
}

/**
 * Interface for error details
 */
export interface ProcessingError {
  step: string
  url?: string
  error: string
  timestamp: string
}

/**
 * Interface for the response
 */
export interface DataAggregateResponse {
  success: boolean
  repository: {
    id: string
    owner: string
    repo: string
    ref: string
  }
  stats: ProcessingStats
  errors?: ProcessingError[]
  message?: string
}

/**
 * Interface for GitHub doc response
 */
export interface GitHubDocResponse {
  success: boolean
  owner: string
  repo: string
  ref?: string
  filename: string
  mediaType: string
  data: {
    type: string
    content: string
  }
}

/**
 * Interface for doc crawl response
 */
export interface DocCrawlResponse {
  success: boolean
  owner: string
  repo: string
  ref: string
  totalLinks: number
  successfulCrawls: number
  failedCrawls: number
  results: CrawlResult[]
}

/**
 * Interface for a single crawl result
 */
export interface CrawlResult {
  url: string
  anchorText: string
  markdown?: string
  success: boolean
  error?: string
}

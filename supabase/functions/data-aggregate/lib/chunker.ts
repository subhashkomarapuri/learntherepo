/**
 * Text chunking utilities using LangChain
 * Provides markdown-aware text splitting for optimal RAG performance
 */

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import type { DocumentChunk } from './types.ts'

/**
 * Configuration for text chunking
 */
export interface ChunkerConfig {
  chunkSize?: number      // Target size of each chunk (default: 1000)
  chunkOverlap?: number   // Overlap between chunks (default: 200)
  separators?: string[]   // Custom separators (default: markdown-optimized)
}

/**
 * Default separators optimized for markdown content
 * Prioritizes semantic boundaries (headers, paragraphs, sentences)
 */
const MARKDOWN_SEPARATORS = [
  '\n## ',     // H2 headers
  '\n### ',    // H3 headers
  '\n#### ',   // H4 headers
  '\n##### ',  // H5 headers
  '\n\n',      // Paragraphs
  '\n',        // Lines
  '. ',        // Sentences
  ' ',         // Words
  ''           // Characters (fallback)
]

/**
 * Creates a text splitter configured for markdown content
 */
function createMarkdownSplitter(config: ChunkerConfig = {}): RecursiveCharacterTextSplitter {
  const {
    chunkSize = 1000,
    chunkOverlap = 200,
    separators = MARKDOWN_SEPARATORS
  } = config

  return new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators,
    lengthFunction: (text: string) => text.length
  })
}

/**
 * Chunks markdown text into smaller segments for embedding
 * 
 * @param text - The markdown text to chunk
 * @param metadata - Optional metadata to attach to each chunk
 * @param config - Optional chunker configuration
 * @returns Array of document chunks with metadata
 */
export async function chunkMarkdown(
  text: string,
  metadata: Record<string, unknown> = {},
  config: ChunkerConfig = {}
): Promise<DocumentChunk[]> {
  try {
    // Validate input
    if (!text || text.trim().length === 0) {
      console.warn('Empty text provided for chunking')
      return []
    }

    // Create splitter
    const splitter = createMarkdownSplitter(config)

    // Split text into chunks
    const chunks = await splitter.splitText(text)

    // Convert to DocumentChunk format with metadata
    const documentChunks: DocumentChunk[] = chunks.map((chunkText: string, index: number) => ({
      text: chunkText,
      index,
      metadata: {
        ...metadata,
        chunkIndex: index,
        totalChunks: chunks.length,
        chunkLength: chunkText.length
      }
    }))

    console.log(`Chunked text into ${documentChunks.length} segments (avg size: ${Math.round(text.length / documentChunks.length)} chars)`)

    return documentChunks
  } catch (error) {
    console.error('Error chunking markdown:', error)
    throw new Error(`Failed to chunk markdown: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Chunks multiple documents in batch
 * 
 * @param documents - Array of {content, metadata} objects
 * @param config - Optional chunker configuration
 * @returns Array of all chunks from all documents
 */
export async function chunkDocuments(
  documents: Array<{ content: string; metadata?: Record<string, unknown> }>,
  config: ChunkerConfig = {}
): Promise<DocumentChunk[]> {
  const allChunks: DocumentChunk[] = []

  for (const doc of documents) {
    try {
      const chunks = await chunkMarkdown(doc.content, doc.metadata, config)
      allChunks.push(...chunks)
    } catch (error) {
      console.error(`Failed to chunk document:`, error)
      // Continue with other documents even if one fails
    }
  }

  return allChunks
}

/**
 * Estimates the number of chunks that will be created from text
 * Useful for planning and cost estimation
 * 
 * @param text - The text to estimate
 * @param config - Optional chunker configuration
 * @returns Estimated number of chunks
 */
export function estimateChunkCount(text: string, config: ChunkerConfig = {}): number {
  const { chunkSize = 1000, chunkOverlap = 200 } = config
  const textLength = text.length
  
  if (textLength <= chunkSize) {
    return 1
  }
  
  // Rough estimation accounting for overlap
  const effectiveChunkSize = chunkSize - chunkOverlap
  return Math.ceil((textLength - chunkSize) / effectiveChunkSize) + 1
}

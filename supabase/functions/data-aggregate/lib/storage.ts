/**
 * Database storage utilities
 * Handles all interactions with Supabase PostgreSQL database
 */

import { createClient } from '@supabase/supabase-js'
import type {
  RepositoryInfo,
  RepositoryRecord,
  DocumentRecord,
  ChunkRecord,
  EmbeddingRecord,
  DocumentChunk
} from './types.ts'

/**
 * Initialize Supabase client with service role key for full access
 */
export function createStorageClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

/**
 * Finds or creates a repository record
 * Returns existing record if found, creates new one otherwise
 */
export async function upsertRepository(
  client: ReturnType<typeof createClient>,
  repoInfo: RepositoryInfo
): Promise<RepositoryRecord> {
  try {
    const { owner, repo, ref, url } = repoInfo

    // Try to find existing repository
    const { data: existing, error: findError } = await client
      .from('repositories')
      .select('*')
      .eq('owner', owner)
      .eq('repo', repo)
      .eq('ref', ref)
      .single()

    if (findError && findError.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw findError
    }

    if (existing) {
      // Update last_processed_at
      const { data: updated, error: updateError } = await client
        .from('repositories')
        .update({ 
          last_processed_at: new Date().toISOString(),
          url 
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (updateError) throw updateError

      console.log(`Updated existing repository: ${owner}/${repo}@${ref}`)
      return mapToRepositoryRecord(updated)
    }

    // Create new repository
    const { data: created, error: createError } = await client
      .from('repositories')
      .insert({
        owner,
        repo,
        ref,
        url,
        last_processed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (createError) throw createError

    console.log(`Created new repository: ${owner}/${repo}@${ref}`)
    return mapToRepositoryRecord(created)

  } catch (error) {
    console.error('Error upserting repository:', error)
    throw new Error(`Failed to upsert repository: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Stores a document in the database
 */
export async function storeDocument(
  client: ReturnType<typeof createClient>,
  repositoryId: string,
  document: {
    url: string
    anchorText?: string
    content: string
    sourceType: 'readme' | 'documentation'
  }
): Promise<DocumentRecord> {
  try {
    const { url, anchorText, content, sourceType } = document

    // Upsert document (update if exists, insert if new)
    const { data, error } = await client
      .from('documents')
      .upsert({
        repository_id: repositoryId,
        url,
        anchor_text: anchorText,
        content,
        content_length: content.length,
        source_type: sourceType,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'repository_id,url'
      })
      .select()
      .single()

    if (error) throw error

    console.log(`Stored document: ${url} (${content.length} chars)`)
    return mapToDocumentRecord(data)

  } catch (error) {
    console.error('Error storing document:', error)
    throw new Error(`Failed to store document: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Stores chunks for a document
 */
export async function storeChunks(
  client: ReturnType<typeof createClient>,
  documentId: string,
  repositoryId: string,
  chunks: DocumentChunk[]
): Promise<ChunkRecord[]> {
  try {
    if (!chunks || chunks.length === 0) {
      return []
    }

    // Delete existing chunks for this document
    const { error: deleteError } = await client
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId)

    if (deleteError) throw deleteError

    // Insert new chunks
    const chunkData = chunks.map(chunk => ({
      document_id: documentId,
      repository_id: repositoryId,
      chunk_text: chunk.text,
      chunk_index: chunk.index,
      chunk_length: chunk.text.length,
      metadata: chunk.metadata || {}
    }))

    const { data, error } = await client
      .from('document_chunks')
      .insert(chunkData)
      .select()

    if (error) throw error

    console.log(`Stored ${data.length} chunks for document ${documentId}`)
    return data.map(mapToChunkRecord)

  } catch (error) {
    console.error('Error storing chunks:', error)
    throw new Error(`Failed to store chunks: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Stores embeddings for chunks
 */
export async function storeEmbeddings(
  client: ReturnType<typeof createClient>,
  repositoryId: string,
  chunkRecords: ChunkRecord[],
  embeddings: number[][],
  model: string
): Promise<EmbeddingRecord[]> {
  try {
    if (!chunkRecords || chunkRecords.length === 0) {
      return []
    }

    if (chunkRecords.length !== embeddings.length) {
      throw new Error(`Mismatch: ${chunkRecords.length} chunks but ${embeddings.length} embeddings`)
    }

    // Prepare embedding data
    const embeddingData = chunkRecords.map((chunk, index) => ({
      chunk_id: chunk.id,
      repository_id: repositoryId,
      embedding: embeddings[index],
      model
    }))

    // Delete existing embeddings for these chunks
    const chunkIds = chunkRecords.map(c => c.id)
    const { error: deleteError } = await client
      .from('embeddings')
      .delete()
      .in('chunk_id', chunkIds)

    if (deleteError) throw deleteError

    // Insert new embeddings in batches to avoid payload size limits
    const batchSize = 100
    const allResults: EmbeddingRecord[] = []

    for (let i = 0; i < embeddingData.length; i += batchSize) {
      const batch = embeddingData.slice(i, i + batchSize)
      
      const { data, error } = await client
        .from('embeddings')
        .insert(batch)
        .select()

      if (error) throw error

      allResults.push(...data.map(mapToEmbeddingRecord))
    }

    console.log(`Stored ${allResults.length} embeddings`)
    return allResults

  } catch (error) {
    console.error('Error storing embeddings:', error)
    throw new Error(`Failed to store embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Updates repository statistics
 */
export async function updateRepositoryStats(
  client: ReturnType<typeof createClient>,
  repositoryId: string
): Promise<void> {
  try {
    // Count documents
    const { count: docCount, error: docError } = await client
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('repository_id', repositoryId)

    if (docError) throw docError

    // Count chunks
    const { count: chunkCount, error: chunkError } = await client
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('repository_id', repositoryId)

    if (chunkError) throw chunkError

    // Update repository
    const { error: updateError } = await client
      .from('repositories')
      .update({
        total_documents: docCount || 0,
        total_chunks: chunkCount || 0
      })
      .eq('id', repositoryId)

    if (updateError) throw updateError

    console.log(`Updated repository stats: ${docCount} docs, ${chunkCount} chunks`)

  } catch (error) {
    console.error('Error updating repository stats:', error)
    throw new Error(`Failed to update stats: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Checks if a repository has already been processed
 */
export async function isRepositoryProcessed(
  client: ReturnType<typeof createClient>,
  owner: string,
  repo: string,
  ref: string
): Promise<boolean> {
  try {
    const { count, error } = await client
      .from('repositories')
      .select('*', { count: 'exact', head: true })
      .eq('owner', owner)
      .eq('repo', repo)
      .eq('ref', ref)

    if (error) throw error

    return (count || 0) > 0

  } catch (error) {
    console.error('Error checking repository:', error)
    return false
  }
}

/**
 * Helper function to map database row to RepositoryRecord
 */
// deno-lint-ignore no-explicit-any
function mapToRepositoryRecord(data: any): RepositoryRecord {
  return {
    id: data.id,
    owner: data.owner,
    repo: data.repo,
    ref: data.ref,
    url: data.url,
    lastProcessedAt: data.last_processed_at,
    totalDocuments: data.total_documents || 0,
    totalChunks: data.total_chunks || 0,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  }
}

/**
 * Helper function to map database row to DocumentRecord
 */
// deno-lint-ignore no-explicit-any
function mapToDocumentRecord(data: any): DocumentRecord {
  return {
    id: data.id,
    repositoryId: data.repository_id,
    url: data.url,
    anchorText: data.anchor_text,
    content: data.content,
    contentLength: data.content_length,
    sourceType: data.source_type,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  }
}

/**
 * Helper function to map database row to ChunkRecord
 */
// deno-lint-ignore no-explicit-any
function mapToChunkRecord(data: any): ChunkRecord {
  return {
    id: data.id,
    documentId: data.document_id,
    repositoryId: data.repository_id,
    chunkText: data.chunk_text,
    chunkIndex: data.chunk_index,
    chunkLength: data.chunk_length,
    metadata: data.metadata,
    createdAt: data.created_at
  }
}

/**
 * Helper function to map database row to EmbeddingRecord
 */
// deno-lint-ignore no-explicit-any
function mapToEmbeddingRecord(data: any): EmbeddingRecord {
  return {
    id: data.id,
    chunkId: data.chunk_id,
    repositoryId: data.repository_id,
    embedding: data.embedding,
    model: data.model,
    createdAt: data.created_at
  }
}

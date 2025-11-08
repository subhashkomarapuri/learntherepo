/**
 * Storage module for database operations
 * Handles sessions, messages, and summaries
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChatSessionRecord,
  ChatMessageRecord,
  RepositorySummaryRecord,
  ChatSessionInfo,
  ChatMessage,
  RepositorySummary,
  RAGSource,
  RepositoryInfo
} from './types.ts'

/**
 * Create a new chat session
 */
export async function createChatSession(
  client: SupabaseClient,
  repositoryId: string
): Promise<ChatSessionRecord> {
  const { data, error } = await client
    .from('chat_sessions')
    .insert({
      repository_id: repositoryId,
      metadata: {}
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating chat session:', error)
    throw new Error(`Failed to create chat session: ${error.message}`)
  }

  return data
}

/**
 * Get chat session info with repository details
 */
export async function getChatSessionInfo(
  client: SupabaseClient,
  sessionId: string
): Promise<ChatSessionInfo | null> {
  const { data, error } = await client
    .rpc('get_chat_session_info', {
      session_id_param: sessionId
    })
    .single()

  if (error) {
    console.error('Error getting chat session info:', error)
    return null
  }

  if (!data) {
    return null
  }

  // Type assertion for the RPC response
  const result = data as {
    session_id: string
    repository_id: string
    repository_owner: string
    repository_name: string
    repository_ref: string
    session_created_at: string
    message_count: string | number
    has_summary: boolean
  }

  return {
    sessionId: result.session_id,
    repositoryId: result.repository_id,
    repositoryOwner: result.repository_owner,
    repositoryName: result.repository_name,
    repositoryRef: result.repository_ref,
    sessionCreatedAt: result.session_created_at,
    messageCount: typeof result.message_count === 'string' ? parseInt(result.message_count) : result.message_count,
    hasSummary: result.has_summary
  }
}

/**
 * Get repository info by session ID
 */
export async function getRepositoryBySession(
  client: SupabaseClient,
  sessionId: string
): Promise<RepositoryInfo | null> {
  // First get the session
  const { data: session, error: sessionError } = await client
    .from('chat_sessions')
    .select('repository_id')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    console.error('Error getting session:', sessionError)
    return null
  }

  // Then get the repository
  const { data: repo, error: repoError } = await client
    .from('repositories')
    .select('id, owner, repo, ref, url')
    .eq('id', session.repository_id)
    .single()

  if (repoError || !repo) {
    console.error('Error getting repository:', repoError)
    return null
  }

  return {
    id: repo.id,
    owner: repo.owner,
    repo: repo.repo,
    ref: repo.ref,
    url: repo.url
  }
}

/**
 * Store a chat message
 */
export async function storeChatMessage(
  client: SupabaseClient,
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  sources?: RAGSource[],
  metadata?: Record<string, unknown>
): Promise<ChatMessageRecord> {
  const { data, error } = await client
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      sources: sources || null,
      metadata: metadata || {}
    })
    .select()
    .single()

  if (error) {
    console.error('Error storing chat message:', error)
    throw new Error(`Failed to store chat message: ${error.message}`)
  }

  return data
}

/**
 * Get chat history for a session
 */
export async function getChatHistory(
  client: SupabaseClient,
  sessionId: string,
  limit: number = 50,
  offset: number = 0
): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error getting chat history:', error)
    throw new Error(`Failed to get chat history: ${error.message}`)
  }

  return data.map((record: ChatMessageRecord) => ({
    id: record.id,
    sessionId: record.session_id,
    role: record.role,
    content: record.content,
    sources: record.sources || undefined,
    metadata: record.metadata,
    createdAt: record.created_at
  }))
}

/**
 * Get total message count for a session
 */
export async function getMessageCount(
  client: SupabaseClient,
  sessionId: string
): Promise<number> {
  const { data, error } = await client
    .rpc('get_session_message_count', {
      session_id_param: sessionId
    })

  if (error) {
    console.error('Error getting message count:', error)
    return 0
  }

  return parseInt(data) || 0
}

/**
 * Store a repository summary
 */
export async function storeSummary(
  client: SupabaseClient,
  repositoryId: string,
  summary: RepositorySummary,
  modelUsed: string,
  generationParams?: Record<string, unknown>
): Promise<RepositorySummaryRecord> {
  const { data, error } = await client
    .from('repository_summaries')
    .upsert({
      repository_id: repositoryId,
      summary_json: summary,
      model_used: modelUsed,
      generation_params: generationParams || {}
    })
    .select()
    .single()

  if (error) {
    console.error('Error storing summary:', error)
    throw new Error(`Failed to store summary: ${error.message}`)
  }

  return data
}

/**
 * Get repository summary
 */
export async function getSummary(
  client: SupabaseClient,
  repositoryId: string
): Promise<RepositorySummary | null> {
  const { data, error } = await client
    .from('repository_summaries')
    .select('summary_json')
    .eq('repository_id', repositoryId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null
    }
    console.error('Error getting summary:', error)
    throw new Error(`Failed to get summary: ${error.message}`)
  }

  return data.summary_json as RepositorySummary
}

/**
 * Check if summary exists for repository
 */
export async function hasSummary(
  client: SupabaseClient,
  repositoryId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('repository_summaries')
    .select('id')
    .eq('repository_id', repositoryId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return false
    }
    console.error('Error checking summary:', error)
    return false
  }

  return !!data
}

/**
 * Delete a chat session and all its messages
 */
export async function deleteChatSession(
  client: SupabaseClient,
  sessionId: string
): Promise<void> {
  const { error } = await client
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    console.error('Error deleting chat session:', error)
    throw new Error(`Failed to delete chat session: ${error.message}`)
  }
}

/**
 * Get or create repository record
 * Returns existing repository or throws error if not found
 */
export async function getRepository(
  client: SupabaseClient,
  owner: string,
  repo: string,
  ref: string
): Promise<RepositoryInfo | null> {
  const { data, error } = await client
    .from('repositories')
    .select('id, owner, repo, ref, url')
    .eq('owner', owner)
    .eq('repo', repo)
    .eq('ref', ref)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null
    }
    console.error('Error getting repository:', error)
    throw new Error(`Failed to get repository: ${error.message}`)
  }

  return {
    id: data.id,
    owner: data.owner,
    repo: data.repo,
    ref: data.ref,
    url: data.url
  }
}

/**
 * Check if repository has been processed (has embeddings)
 */
export async function isRepositoryProcessed(
  client: SupabaseClient,
  repositoryId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('embeddings')
    .select('id')
    .eq('repository_id', repositoryId)
    .limit(1)

  if (error) {
    console.error('Error checking repository processing:', error)
    return false
  }

  return data && data.length > 0
}

/**
 * Update session metadata
 */
export async function updateSessionMetadata(
  client: SupabaseClient,
  sessionId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await client
    .from('chat_sessions')
    .update({ metadata })
    .eq('id', sessionId)

  if (error) {
    console.error('Error updating session metadata:', error)
    throw new Error(`Failed to update session metadata: ${error.message}`)
  }
}

/**
 * Get recent chat sessions for a repository
 */
export async function getRecentSessions(
  client: SupabaseClient,
  repositoryId: string,
  limit: number = 10
): Promise<ChatSessionInfo[]> {
  const { data, error } = await client
    .from('chat_sessions')
    .select(`
      id,
      repository_id,
      created_at,
      repositories (
        owner,
        repo,
        ref
      )
    `)
    .eq('repository_id', repositoryId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error getting recent sessions:', error)
    return []
  }

  return data.map((session: { id: string; repository_id: string; created_at: string; repositories: { owner: string; repo: string; ref: string }[] }) => {
    const repo = Array.isArray(session.repositories) ? session.repositories[0] : session.repositories
    return {
      sessionId: session.id,
      repositoryId: session.repository_id,
      repositoryOwner: repo.owner,
      repositoryName: repo.repo,
      repositoryRef: repo.ref,
      sessionCreatedAt: session.created_at,
      messageCount: 0,  // Would need to query separately
      hasSummary: false  // Would need to query separately
    }
  })
}

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"

import { createClient } from '@supabase/supabase-js'
import type {
  ChatRequest,
  InitChatRequest,
  SummaryRequest,
  MessageRequest,
  HistoryRequest,
  InitChatResponse,
  SummaryResponse,
  MessageResponse,
  HistoryResponse,
  ErrorResponse
} from './lib/types.ts'
import {
  createChatSession,
  getChatSessionInfo,
  getRepository,
  isRepositoryProcessed,
  storeChatMessage,
  getChatHistory,
  storeSummary,
  getSummary,
  getRepositoryBySession,
  getMessageCount
} from './lib/storage.ts'
import { generateSummary } from './lib/summary.ts'
import { performRAG } from './lib/rag.ts'
import { generateChatCompletion } from './lib/llm.ts'
import { getChatSystemPrompt } from './lib/prompts.ts'
import { SESSION_CONFIG } from './lib/config.ts'

/**
 * Parse GitHub URL to extract owner and repo
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
 * Call data-aggregate function to process repository
 */
async function processRepository(
  githubUrl: string,
  ref: string,
  force: boolean,
  supabaseUrl: string,
  supabaseKey: string
): Promise<{ repositoryId: string; status: 'created' | 'existing' }> {
  const dataAggregateUrl = `${supabaseUrl}/functions/v1/data-aggregate`
  
  const response = await fetch(dataAggregateUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: githubUrl,
      ref,
      force
    })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    if (response.status === 409 && !force) {
      // Repository already exists - this is okay
      // We'll get the repo ID from the database
      return { repositoryId: '', status: 'existing' }
    }
    throw new Error(`data-aggregate failed: ${JSON.stringify(errorData)}`)
  }

  const data = await response.json()
  
  if (!data.success) {
    throw new Error('data-aggregate returned success: false')
  }

  return {
    repositoryId: data.repository.id,
    status: 'created'
  }
}

/**
 * Handle init action - create chat session
 */
async function handleInit(
  request: InitChatRequest,
  supabaseUrl: string,
  supabaseServiceKey: string,
  supabaseAnonKey: string
): Promise<InitChatResponse | ErrorResponse> {
  const { githubUrl, ref = 'main', force = false } = request

  // Parse GitHub URL
  const parsed = parseGitHubUrl(githubUrl)
  if (!parsed) {
    return {
      success: false,
      error: 'invalid_github_url',
      message: 'Invalid GitHub repository URL'
    }
  }

  const { owner, repo } = parsed

  // Create Supabase client
  const client = createClient(supabaseUrl, supabaseServiceKey)

  // Check if repository exists in database
  let repository = await getRepository(client, owner, repo, ref)
  let status: 'created' | 'existing' = 'existing'

  if (!repository) {
    // Process repository with data-aggregate
    console.log(`Processing new repository: ${owner}/${repo}@${ref}`)
    const result = await processRepository(githubUrl, ref, force, supabaseUrl, supabaseAnonKey)
    
    if (result.repositoryId) {
      repository = { id: result.repositoryId, owner, repo, ref, url: githubUrl }
    } else {
      // Get from database (exists but wasn't processed)
      repository = await getRepository(client, owner, repo, ref)
    }
    status = result.status
  } else {
    console.log(`Repository already exists: ${owner}/${repo}@${ref}`)
    
    // Check if it has embeddings
    const hasEmbeddings = await isRepositoryProcessed(client, repository.id)
    if (!hasEmbeddings && !force) {
      return {
        success: false,
        error: 'repository_not_processed',
        message: 'Repository found but not yet processed. Set force=true to reprocess.'
      }
    }
  }

  if (!repository) {
    return {
      success: false,
      error: 'repository_not_found',
      message: 'Failed to find or create repository'
    }
  }

  // Create chat session
  const session = await createChatSession(client, repository.id)
  
  console.log(`Created chat session: ${session.id}`)

  return {
    success: true,
    sessionId: session.id,
    repositoryId: repository.id,
    status,
    message: `Chat session created for ${owner}/${repo}@${ref}`
  }
}

/**
 * Handle summary action - generate or retrieve summary
 */
async function handleSummary(
  request: SummaryRequest,
  supabaseUrl: string,
  supabaseServiceKey: string,
  supabaseAnonKey: string,
  openaiApiKey: string
): Promise<SummaryResponse | ErrorResponse> {
  const { sessionId, regenerate = false } = request

  const client = createClient(supabaseUrl, supabaseServiceKey)

  // Get session info
  const sessionInfo = await getChatSessionInfo(client, sessionId)
  if (!sessionInfo) {
    return {
      success: false,
      error: 'session_not_found',
      message: 'Chat session not found'
    }
  }

  // Check if summary exists
  const existingSummary = await getSummary(client, sessionInfo.repositoryId)

  if (existingSummary && !regenerate) {
    console.log('Returning cached summary')
    return {
      success: true,
      summary: existingSummary,
      fromCache: true,
      modelUsed: 'cached'
    }
  }

  // Generate new summary
  console.log('Generating new summary...')
  const githubUrl = `https://github.com/${sessionInfo.repositoryOwner}/${sessionInfo.repositoryName}`
  
  const summary = await generateSummary(
    githubUrl,
    sessionInfo.repositoryRef,
    supabaseUrl,
    supabaseAnonKey,
    openaiApiKey
  )

  // Store summary
  await storeSummary(client, sessionInfo.repositoryId, summary, 'gpt-4o')

  return {
    success: true,
    summary,
    fromCache: false,
    modelUsed: 'gpt-4o'
  }
}

/**
 * Handle message action - RAG chat
 */
async function handleMessage(
  request: MessageRequest,
  supabaseUrl: string,
  supabaseServiceKey: string,
  openaiApiKey: string
): Promise<MessageResponse | ErrorResponse> {
  const { sessionId, message, ragConfig } = request

  const client = createClient(supabaseUrl, supabaseServiceKey)

  // Get session and repository info
  const sessionInfo = await getChatSessionInfo(client, sessionId)
  if (!sessionInfo) {
    return {
      success: false,
      error: 'session_not_found',
      message: 'Chat session not found'
    }
  }

  const repository = await getRepositoryBySession(client, sessionId)
  if (!repository) {
    return {
      success: false,
      error: 'repository_not_found',
      message: 'Repository not found for session'
    }
  }

  // Get summary (optional but recommended)
  const summary = await getSummary(client, repository.id)

  // Store user message
  await storeChatMessage(client, sessionId, 'user', message)

  // Perform RAG search
  const ragResult = await performRAG(
    client,
    message,
    repository.owner,
    repository.repo,
    repository.ref,
    openaiApiKey,
    ragConfig
  )

  // Generate response with LLM
  const systemPrompt = getChatSystemPrompt(
    summary || {
      title: `${repository.owner}/${repository.repo}`,
      description: 'Repository documentation',
      keyFeatures: [],
      techStack: [],
      primaryLanguage: 'Unknown',
      documentationLinks: [],
      quickStart: 'No quick start available',
      useCases: []
    },
    ragResult.useFallback ? null : ragResult.sources
  )

  const llmResponse = await generateChatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ],
    'chat',
    openaiApiKey
  )

  // Store assistant message
  const assistantMessage = await storeChatMessage(
    client,
    sessionId,
    'assistant',
    llmResponse.content,
    ragResult.sources,
    {
      model: llmResponse.model,
      usedRagContext: !ragResult.useFallback,
      usedFallback: ragResult.useFallback,
      tokensUsed: llmResponse.usage.totalTokens
    }
  )

  return {
    success: true,
    messageId: assistantMessage.id,
    answer: llmResponse.content,
    sources: ragResult.sources,
    usedRagContext: !ragResult.useFallback,
    usedFallback: ragResult.useFallback,
    modelUsed: llmResponse.model
  }
}

/**
 * Handle history action - retrieve conversation history
 */
async function handleHistory(
  request: HistoryRequest,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<HistoryResponse | ErrorResponse> {
  const { sessionId, limit = SESSION_CONFIG.defaultHistoryLimit, offset = 0 } = request

  const client = createClient(supabaseUrl, supabaseServiceKey)

  // Get session info
  const sessionInfo = await getChatSessionInfo(client, sessionId)
  if (!sessionInfo) {
    return {
      success: false,
      error: 'session_not_found',
      message: 'Chat session not found'
    }
  }

  // Get messages
  const messages = await getChatHistory(
    client,
    sessionId,
    Math.min(limit, SESSION_CONFIG.maxHistoryLimit),
    offset
  )

  // Get summary
  const summary = await getSummary(client, sessionInfo.repositoryId)

  // Get total message count
  const totalMessages = await getMessageCount(client, sessionId)

  return {
    success: true,
    sessionInfo,
    messages,
    summary: summary || undefined,
    totalMessages
  }
}

console.log("Chat Function Started!")

Deno.serve(async (req) => {
  try {
    // Parse request body
    const body: ChatRequest = await req.json()

    // Validate action
    if (!body.action) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'missing_action',
          message: 'Missing required field: action'
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'configuration_error',
          message: 'Missing Supabase configuration'
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'configuration_error',
          message: 'Missing OPENAI_API_KEY environment variable'
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Route to appropriate handler
    let result

    switch (body.action) {
      case 'init':
        result = await handleInit(body, supabaseUrl, supabaseServiceKey, supabaseAnonKey)
        break

      case 'summary':
        result = await handleSummary(body, supabaseUrl, supabaseServiceKey, supabaseAnonKey, openaiApiKey)
        break

      case 'message':
        result = await handleMessage(body, supabaseUrl, supabaseServiceKey, openaiApiKey)
        break

      case 'history':
        result = await handleHistory(body, supabaseUrl, supabaseServiceKey)
        break

      default:
        return new Response(
          JSON.stringify({
            success: false,
            error: 'invalid_action',
            message: `Invalid action: ${(body as { action: string }).action}`
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        )
    }

    // Return result
    const status = result.success ? 200 : 400
    return new Response(
      JSON.stringify(result),
      {
        status,
        headers: { "Content-Type": "application/json" }
      }
    )

  } catch (error) {
    console.error('Error in chat function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: 'internal_error',
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

  1. Apply database migration:
     supabase db reset

  2. Start Supabase:
     supabase start

  3. Start functions with environment:
     supabase functions serve --env-file ./supabase/.env

  4. Initialize a chat session:
     curl -X POST http://127.0.0.1:54321/functions/v1/chat \
       -H "Authorization: Bearer YOUR_ANON_KEY" \
       -H "Content-Type: application/json" \
       -d '{"action":"init","githubUrl":"https://github.com/supabase/supabase","ref":"main"}'

  5. Generate summary:
     curl -X POST http://127.0.0.1:54321/functions/v1/chat \
       -H "Authorization: Bearer YOUR_ANON_KEY" \
       -H "Content-Type: application/json" \
       -d '{"action":"summary","sessionId":"SESSION_ID_FROM_INIT"}'

  6. Send a message:
     curl -X POST http://127.0.0.1:54321/functions/v1/chat \
       -H "Authorization: Bearer YOUR_ANON_KEY" \
       -H "Content-Type: application/json" \
       -d '{"action":"message","sessionId":"SESSION_ID","message":"How do I get started?"}'

  7. Get history:
     curl -X POST http://127.0.0.1:54321/functions/v1/chat \
       -H "Authorization: Bearer YOUR_ANON_KEY" \
       -H "Content-Type: application/json" \
       -d '{"action":"history","sessionId":"SESSION_ID"}'

*/

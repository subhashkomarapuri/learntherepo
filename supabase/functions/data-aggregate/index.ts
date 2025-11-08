// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"

import { chunkMarkdown } from './lib/chunker.ts'
import { generateEmbeddingsBatch, estimateCost } from './lib/embedder.ts'
import {
  createStorageClient,
  upsertRepository,
  storeDocument,
  storeChunks,
  storeEmbeddings,
  updateRepositoryStats,
  isRepositoryProcessed
} from './lib/storage.ts'
import type {
  DataAggregateRequest,
  DataAggregateResponse,
  GitHubDocResponse,
  DocCrawlResponse,
  ProcessingStats,
  ProcessingError,
  Document
} from './lib/types.ts'

/**
 * Parses a GitHub URL to extract owner and repository name
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
 * Fetches README content using github-doc function
 */
async function fetchReadme(
  url: string,
  ref: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<Document | null> {
  try {
    const githubDocUrl = `${supabaseUrl}/functions/v1/github-doc`
    const response = await fetch(githubDocUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        ref,
        mediaType: 'raw'
      })
    })

    if (!response.ok) {
      console.error(`Failed to fetch README: ${response.status}`)
      return null
    }

    const data: GitHubDocResponse = await response.json()

    if (!data.success || !data.data.content) {
      console.error('Invalid README response')
      return null
    }

    return {
      url: `https://github.com/${data.owner}/${data.repo}/blob/${ref}/${data.filename}`,
      anchorText: data.filename,
      content: data.data.content,
      sourceType: 'readme'
    }

  } catch (error) {
    console.error('Error fetching README:', error)
    return null
  }
}

/**
 * Fetches documentation pages using doc-crawl function
 */
async function fetchDocumentation(
  url: string,
  ref: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<Document[]> {
  try {
    const docCrawlUrl = `${supabaseUrl}/functions/v1/doc-crawl`
    const response = await fetch(docCrawlUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        ref
      })
    })

    if (!response.ok) {
      console.error(`Failed to crawl documentation: ${response.status}`)
      return []
    }

    const data: DocCrawlResponse = await response.json()

    if (!data.success || !data.results) {
      console.error('Invalid doc-crawl response')
      return []
    }

    // Convert successful crawl results to documents
    return data.results
      .filter(result => result.success && result.markdown)
      .map(result => ({
        url: result.url,
        anchorText: result.anchorText,
        content: result.markdown!,
        sourceType: 'documentation' as const
      }))

  } catch (error) {
    console.error('Error fetching documentation:', error)
    return []
  }
}

console.log("Data Aggregate Function Started!")

Deno.serve(async (req) => {
  const startTime = Date.now()
  const errors: ProcessingError[] = []

  try {
    // Parse request body
    const body: DataAggregateRequest = await req.json()

    // Validate required fields
    if (!body.url) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Missing required field: url'
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Parse GitHub URL
    const parsed = parseGitHubUrl(body.url)
    if (!parsed) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Invalid GitHub URL. Please provide a valid GitHub repository URL'
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const { owner, repo } = parsed
    const ref = body.ref || 'main'

    // Get configuration from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          success: false,
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
          message: 'Missing OPENAI_API_KEY environment variable'
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    // Initialize storage client
    const storage = createStorageClient(supabaseUrl, supabaseServiceKey)

    // Check if repository already exists (unless force=true)
    if (!body.force) {
      const exists = await isRepositoryProcessed(storage, owner, repo, ref)
      if (exists) {
        console.log(`Repository ${owner}/${repo}@${ref} already processed. Use force=true to reprocess.`)
        return new Response(
          JSON.stringify({
            success: false,
            message: `Repository ${owner}/${repo}@${ref} already exists. Use "force": true to reprocess.`
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" }
          }
        )
      }
    }

    console.log(`Processing repository: ${owner}/${repo}@${ref}`)

    // Step 1: Fetch README
    console.log('Step 1: Fetching README...')
    const readme = await fetchReadme(body.url, ref, supabaseUrl, supabaseAnonKey)

    // Step 2: Fetch documentation pages
    console.log('Step 2: Fetching documentation pages...')
    const docPages = await fetchDocumentation(body.url, ref, supabaseUrl, supabaseAnonKey)

    // Combine all documents
    const allDocuments: Document[] = []
    if (readme) allDocuments.push(readme)
    allDocuments.push(...docPages)

    if (allDocuments.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No documents found to process'
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    console.log(`Found ${allDocuments.length} documents to process`)

    // Step 3: Create/update repository record
    console.log('Step 3: Creating repository record...')
    const repository = await upsertRepository(storage, {
      owner,
      repo,
      ref,
      url: body.url
    })

    // Step 4: Process each document
    console.log('Step 4: Processing documents...')
    
    let documentsProcessed = 0
    let chunksCreated = 0
    let embeddingsCreated = 0
    let documentsFailed = 0
    let totalTokensUsed = 0

    for (const doc of allDocuments) {
      try {
        console.log(`Processing: ${doc.url}`)

        // Store document
        const docRecord = await storeDocument(storage, repository.id, {
          url: doc.url,
          anchorText: doc.anchorText,
          content: doc.content,
          sourceType: doc.sourceType
        })

        // Chunk document
        const chunks = await chunkMarkdown(doc.content, {
          url: doc.url,
          anchorText: doc.anchorText,
          sourceType: doc.sourceType
        })

        if (chunks.length === 0) {
          console.warn(`No chunks created for ${doc.url}`)
          continue
        }

        // Store chunks
        const chunkRecords = await storeChunks(storage, docRecord.id, repository.id, chunks)
        chunksCreated += chunkRecords.length

        // Generate embeddings
        const chunkTexts = chunks.map(c => c.text)
        const estimatedCost = estimateCost(chunkTexts)
        console.log(`Generating embeddings for ${chunkTexts.length} chunks (estimated cost: $${estimatedCost.toFixed(4)})`)

        const embeddingResult = await generateEmbeddingsBatch(chunkTexts, {
          apiKey: openaiApiKey
        })

        // Store embeddings
        await storeEmbeddings(
          storage,
          repository.id,
          chunkRecords,
          embeddingResult.embeddings,
          embeddingResult.model
        )

        embeddingsCreated += embeddingResult.embeddings.length
        totalTokensUsed += embeddingResult.totalTokens
        documentsProcessed++

        console.log(`✓ Processed ${doc.url}: ${chunkRecords.length} chunks, ${embeddingResult.embeddings.length} embeddings`)

      } catch (error) {
        documentsFailed++
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`✗ Failed to process ${doc.url}:`, errorMsg)
        errors.push({
          step: 'document_processing',
          url: doc.url,
          error: errorMsg,
          timestamp: new Date().toISOString()
        })
      }
    }

    // Step 5: Update repository statistics
    console.log('Step 5: Updating repository statistics...')
    await updateRepositoryStats(storage, repository.id)

    const processingTimeMs = Date.now() - startTime

    const stats: ProcessingStats = {
      repositoryId: repository.id,
      owner,
      repo,
      ref,
      documentsProcessed,
      chunksCreated,
      embeddingsCreated,
      documentsSkipped: 0,
      documentsFailed,
      totalTokensUsed,
      processingTimeMs
    }

    console.log(`✓ Processing complete in ${(processingTimeMs / 1000).toFixed(2)}s`)
    console.log(`  - Documents: ${documentsProcessed}/${allDocuments.length}`)
    console.log(`  - Chunks: ${chunksCreated}`)
    console.log(`  - Embeddings: ${embeddingsCreated}`)
    console.log(`  - Tokens: ${totalTokensUsed}`)
    console.log(`  - Cost: $${((totalTokensUsed / 1_000_000) * 0.02).toFixed(4)}`)

    const response: DataAggregateResponse = {
      success: true,
      repository: {
        id: repository.id,
        owner,
        repo,
        ref
      },
      stats,
      ...(errors.length > 0 && { errors })
    }

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )

  } catch (error) {
    console.error('Fatal error:', error)

    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        errors
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})

/* To invoke locally:

  1. Make sure you have the required environment variables set:
     - SUPABASE_URL
     - SUPABASE_ANON_KEY
     - SUPABASE_SERVICE_ROLE_KEY
     - OPENAI_API_KEY

  2. Run the database migration:
     supabase db reset

  3. Start Supabase:
     supabase start

  4. Make an HTTP request:

  # Example 1: Process a repository
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/data-aggregate' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/supabase/supabase","ref":"main"}'

  # Example 2: Force reprocess an existing repository
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/data-aggregate' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"url":"https://github.com/supabase/supabase","ref":"main","force":true}'

*/

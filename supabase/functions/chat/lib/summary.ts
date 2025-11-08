/**
 * Summary generation module
 * Generates structured summaries from README and documentation links
 */

import { SUMMARY_CONFIG } from './config.ts'
import { getSummaryPrompt, getSummaryUserMessage } from './prompts.ts'
import { generateStructuredOutput } from './llm.ts'
import { searchRepositoryInfo } from './tavily.ts'
import type { RepositorySummary, DocumentationLink } from './types.ts'

/**
 * Fetch README content from github-doc function
 */
async function fetchReadme(
  githubUrl: string,
  ref: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<string | null> {
  try {
    const githubDocUrl = `${supabaseUrl}/functions/v1/github-doc`
    const response = await fetch(githubDocUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: githubUrl,
        ref,
        mediaType: 'raw'
      })
    })

    if (!response.ok) {
      console.error(`Failed to fetch README: ${response.status}`)
      return null
    }

    const data = await response.json()

    if (!data.success || !data.data.content) {
      console.error('Invalid README response')
      return null
    }

    return data.data.content
  } catch (error) {
    console.error('Error fetching README:', error)
    return null
  }
}

/**
 * Extract documentation links from doc-link-extract function
 */
async function extractDocLinks(
  githubUrl: string,
  ref: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<DocumentationLink[]> {
  try {
    const docLinkExtractUrl = `${supabaseUrl}/functions/v1/doc-link-extract`
    const response = await fetch(docLinkExtractUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: githubUrl,
        ref
      })
    })

    if (!response.ok) {
      console.error(`Failed to extract doc links: ${response.status}`)
      return []
    }

    const data = await response.json()

    if (!data.success || !data.links) {
      console.error('Invalid doc-link-extract response')
      return []
    }

    // Convert to DocumentationLink format
    return data.links
      .slice(0, SUMMARY_CONFIG.maxDocLinks)
      .map((link: { url: string; anchorText: string }) => ({
        title: link.anchorText,
        url: link.url
      }))
  } catch (error) {
    console.error('Error extracting doc links:', error)
    return []
  }
}

/**
 * Generate repository summary using LLM
 */
export async function generateSummary(
  githubUrl: string,
  ref: string,
  supabaseUrl: string,
  supabaseKey: string,
  openaiApiKey: string,
  tavilyApiKey?: string
): Promise<RepositorySummary> {
  console.log('Generating summary for repository...')

  // Step 1: Fetch README
  console.log('Fetching README...')
  const readme = await fetchReadme(githubUrl, ref, supabaseUrl, supabaseKey)
  
  if (!readme) {
    throw new Error('Failed to fetch README content')
  }

  // Truncate README if too long
  const truncatedReadme = readme.length > SUMMARY_CONFIG.maxReadmeLength
    ? readme.substring(0, SUMMARY_CONFIG.maxReadmeLength) + '\n\n[README truncated for length]'
    : readme

  console.log(`README length: ${readme.length} chars (${truncatedReadme.length} after truncation)`)

  // Step 2: Extract documentation links
  console.log('Extracting documentation links...')
  const docLinks = await extractDocLinks(githubUrl, ref, supabaseUrl, supabaseKey)
  console.log(`Found ${docLinks.length} documentation links`)

  // Step 3: Generate summary using LLM
  console.log('Calling LLM for summary generation...')
  
  const systemPrompt = getSummaryPrompt(truncatedReadme, docLinks)
  const userMessage = getSummaryUserMessage()

  const response = await generateStructuredOutput(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    openaiApiKey
  )

  console.log(`LLM response received: ${response.usage.totalTokens} tokens used`)

  // Step 4: Parse and validate JSON response
  let summary: RepositorySummary
  
  try {
    summary = JSON.parse(response.content || '{}')
  } catch (error) {
    console.error('Failed to parse LLM response as JSON:', error)
    throw new Error('LLM did not return valid JSON')
  }

  // Validate required fields
  const requiredFields = [
    'title',
    'description',
    'keyFeatures',
    'techStack',
    'primaryLanguage',
    'documentationLinks',
    'quickStart',
    'useCases'
  ]

  for (const field of requiredFields) {
    if (!(field in summary)) {
      throw new Error(`Missing required field in summary: ${field}`)
    }
  }

  // Step 5: Add Extended Reading using Tavily search (if API key provided)
  if (tavilyApiKey) {
    console.log('Searching for extended reading materials...')
    try {
      // Extract owner and repo from GitHub URL
      const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/)
      if (urlMatch) {
        const [, owner, repo] = urlMatch
        const searchResult = await searchRepositoryInfo(repo, owner, tavilyApiKey)
        
        summary.extendedReading = searchResult.sources.map(source => ({
          title: source.title,
          url: source.url,
          snippet: source.snippet,
          relevance: source.relevance
        }))
        
        console.log(`Found ${summary.extendedReading.length} extended reading resources`)
      }
    } catch (error) {
      console.error('Failed to fetch extended reading:', error)
      // Don't fail the entire summary generation if extended reading fails
      summary.extendedReading = []
    }
  } else {
    console.log('Tavily API key not provided, skipping extended reading')
  }

  console.log('Summary generated successfully')
  console.log(`Title: ${summary.title}`)
  console.log(`Features: ${summary.keyFeatures.length}`)
  console.log(`Tech Stack: ${summary.techStack.length}`)

  return summary
}

/**
 * Validate a repository summary structure
 */
export function validateSummary(summary: unknown): summary is RepositorySummary {
  if (typeof summary !== 'object' || summary === null) {
    return false
  }

  const s = summary as Record<string, unknown>

  return (
    typeof s.title === 'string' &&
    typeof s.description === 'string' &&
    Array.isArray(s.keyFeatures) &&
    Array.isArray(s.techStack) &&
    typeof s.primaryLanguage === 'string' &&
    Array.isArray(s.documentationLinks) &&
    typeof s.quickStart === 'string' &&
    Array.isArray(s.useCases)
  )
}

/**
 * Format summary for display
 */
export function formatSummary(summary: RepositorySummary): string {
  let formatted = `
# ${summary.title}

${summary.description}

## Key Features
${summary.keyFeatures.map(f => `- ${f}`).join('\n')}

## Tech Stack
${summary.techStack.map(t => `- ${t}`).join('\n')}

## Primary Language
${summary.primaryLanguage}

## Quick Start
${summary.quickStart}

## Use Cases
${summary.useCases.map(u => `- ${u}`).join('\n')}

## Documentation Links
${summary.documentationLinks.map(l => `- [${l.title}](${l.url})`).join('\n')}
`

  // Add Extended Reading section if available
  if (summary.extendedReading && summary.extendedReading.length > 0) {
    formatted += `\n## Extended Reading\n`
    formatted += summary.extendedReading.map(r => 
      `- [${r.title}](${r.url})\n  ${r.snippet}`
    ).join('\n\n')
  }

  if (summary.additionalInfo) {
    formatted += `\n\n## Additional Information\n${summary.additionalInfo}`
  }

  return formatted.trim()
}

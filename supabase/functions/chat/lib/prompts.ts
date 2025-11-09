/**
 * Prompt templates for different chatbot scenarios
 * Modify these prompts to customize chatbot behavior
 */

import type { RepositorySummary, RAGSource } from './types.ts'

/**
 * Generate system prompt for summary generation
 * Input: README content and documentation links
 * Output: Structured JSON summary
 */
export function getSummaryPrompt(readme: string, docLinks: { title: string; url: string }[]): string {
  const linksText = docLinks.length > 0
    ? docLinks.map(link => `- ${link.title}: ${link.url}`).join('\n')
    : 'No documentation links found'

  return `You are a technical documentation analyzer specialized in creating comprehensive repository summaries.

Your task is to analyze the README content and documentation links to generate a structured summary.

## README Content:
${readme}

## Documentation Links:
${linksText}

## Instructions:
1. Analyze the README to understand the project's purpose, features, and technical details
2. Identify the primary programming language and technology stack
3. Extract key features and use cases
4. Summarize the quick start or installation process
5. Include all provided documentation links in the summary

## Output Format:
Return ONLY a valid JSON object with this exact structure (no additional text):

{
  "title": "Project name or title",
  "description": "2-3 sentence comprehensive description of what this project does",
  "keyFeatures": ["Feature 1", "Feature 2", "Feature 3", ...],
  "techStack": ["Technology 1", "Technology 2", ...],
  "primaryLanguage": "Main programming language (e.g., TypeScript, Python, etc.)",
  "documentationLinks": [
    {"title": "Link title", "url": "https://..."},
    ...
  ],
  "quickStart": "Consise and step-by-step guide of how to get started (installation, setup, basic usage); Make sure to include code snippets or commands if applicable.",
  "useCases": ["Use case 1", "Use case 2", ...],
  "additionalInfo": "Any other relevant information about the project"
}

Be concise but comprehensive. Focus on actionable information.`
}

/**
 * Generate system prompt for RAG-based chat
 * Includes repository summary and retrieved context
 * Now with Tavily search tool support
 */
export function getChatSystemPrompt(
  summary: RepositorySummary,
  ragSources: RAGSource[] | null
): string {
  const baseContext = `You are an AI assistant specialized in helping users understand and work with the "${summary.title}" repository.

## Repository Overview:
${JSON.stringify(summary, null, 2)}

## Available Tools:
You have access to a web search tool (tavily_search) that can help you find:
- Latest information and updates
- Tutorials and guides
- Related articles and documentation
- Current trends and best practices

## When to Use Web Search:
1. User explicitly asks for "latest", "recent", "current", or "search" information
2. The repository documentation doesn't contain the answer
3. User asks about external integrations or comparisons
4. User needs broader context or real-world examples

## Your Role:
- Answer questions about this repository using the provided documentation
- Use web search when appropriate to supplement repository information
- Be helpful, accurate, and concise
- Cite sources when referencing specific documentation
- If uncertain, acknowledge limitations honestly

## Formating:
- Use appropriate markdown, especially for code snippets, code blocks, links and lists.
- For the code blocks, always correctly specify the language for syntax highlighting.`

  // No relevant documentation found - suggest using web search
  if (!ragSources || ragSources.length === 0) {
    return baseContext + `
## IMPORTANT - No Specific Documentation Found:
No relevant documentation was found in the repository for this specific query.

**You SHOULD consider using the tavily_search tool to find information online.**

**Response Strategy:**
1. Start by stating: "I don't have specific documentation about this topic in the repository."
2. Use tavily_search to find relevant information online
3. Provide helpful information from search results with citations
4. Suggest checking the repository's documentation links or README for project-specific details

**Example workflow:**
- User asks about a topic not in docs
- Acknowledge lack of repository docs
- Call tavily_search with relevant query
- Synthesize search results with repository context
`
  }

  // We have relevant context from RAG
  const contextText = ragSources
    .map((source, index) => `
### Source ${index + 1} (Similarity: ${(source.similarity * 100).toFixed(1)}%)
URL: ${source.documentUrl}

${source.chunkText}
`)
    .join('\n---\n')

  return baseContext + `
## Relevant Documentation:
${contextText}

## Instructions:
1. Answer the user's question using the documentation above
2. Cite sources by mentioning the document URL when referencing specific information
3. If the documentation doesn't fully answer the question, consider using tavily_search for additional context
4. Be specific and include code examples or commands when present in the documentation
5. Keep responses focused and relevant to the question asked
6. Use web search for latest updates, comparisons, or external information
`
}

/**
 * Generate user message for summary generation
 */
export function getSummaryUserMessage(): string {
  return 'Please analyze the README and documentation links to generate a comprehensive summary following the specified JSON format.'
}

/**
 * Format RAG sources for display to user
 */
export function formatSourceCitations(sources: RAGSource[]): string {
  if (sources.length === 0) {
    return 'No sources cited.'
  }

  return sources
    .map((source, index) => {
      const similarity = (source.similarity * 100).toFixed(1)
      return `**Source ${index + 1}** (${similarity}% match)\n` +
             `📄 ${source.documentUrl}\n` +
             `> ${source.chunkText.substring(0, 200)}${source.chunkText.length > 200 ? '...' : ''}`
    })
    .join('\n\n')
}

/**
 * Generate a helpful error message for users
 */
export function getErrorMessage(error: string): string {
  const errorMap: Record<string, string> = {
    'session_not_found': 'Chat session not found. Please initialize a new session first.',
    'repository_not_processed': 'Repository has not been processed yet. Please wait for processing to complete.',
    'no_summary': 'Repository summary has not been generated yet. Please generate a summary first.',
    'invalid_github_url': 'Invalid GitHub repository URL. Please provide a valid URL.',
    'openai_error': 'Error communicating with OpenAI API. Please try again.',
    'database_error': 'Database error occurred. Please try again later.',
    'rate_limit': 'Rate limit exceeded. Please wait a moment and try again.'
  }

  return errorMap[error] || `An error occurred: ${error}`
}

/**
 * Generate initial system message when creating a new chat session
 */
export function getWelcomeMessage(repoOwner: string, repoName: string): string {
  return `Welcome! I'm here to help you understand the **${repoOwner}/${repoName}** repository. 

I can help you with:
- 📊 Generating a comprehensive summary of the repository
- 💬 Answering questions about the code and documentation
- 🔍 Finding specific information in the documentation
- 🚀 Understanding how to get started with the project

Feel free to ask me anything about this repository!`
}

/**
 * Generate message when RAG retrieval is successful
 */
export function getRagSuccessMessage(sourceCount: number): string {
  return `Found ${sourceCount} relevant ${sourceCount === 1 ? 'section' : 'sections'} from the documentation to answer your question.`
}

/**
 * Generate message when falling back to general knowledge
 */
export function getFallbackMessage(): string {
  return "I couldn't find specific documentation about this in the repository, but I can provide general information based on my knowledge."
}

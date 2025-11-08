/**
 * Centralized configuration for LLM and RAG settings
 * Modify these values to customize chatbot behavior
 */

/**
 * LLM Configuration
 * Adjust models, temperature, and token limits for different use cases
 */
export const LLM_CONFIG = {
  // Model selection
  models: {
    summary: 'gpt-4o',        // Better for structured output and complex analysis
    chat: 'gpt-4o-mini'        // Faster and cheaper for conversational chat
  },
  
  // Temperature settings (Note: GPT-4o and newer only support temperature=1.0)
  // Setting to 1.0 to comply with newer model requirements
  temperature: {
    summary: 1.0,              // GPT-4o only supports default temperature
    chat: 1.0                  // GPT-4o-mini only supports default temperature
  },
  
  // Maximum tokens in response
  maxTokens: {
    summary: 2000,             // Longer for comprehensive summaries
    chat: 1000                 // Shorter for quick responses
  },
  
  // Top-p sampling (alternative to temperature)
  topP: {
    summary: 0.9,
    chat: 0.9
  },
  
  // Frequency penalty (reduce repetition)
  frequencyPenalty: {
    summary: 0.0,
    chat: 0.3
  },
  
  // Presence penalty (encourage topic diversity)
  presencePenalty: {
    summary: 0.0,
    chat: 0.3
  }
} as const

/**
 * RAG Configuration
 * Control how the chatbot retrieves and uses context
 */
export const RAG_CONFIG = {
  // Default similarity threshold (0.0 - 1.0)
  // Higher = more strict matching, Lower = more lenient
  defaultThreshold: 0.7,
  
  // Default number of chunks to retrieve
  defaultMatchCount: 5,
  
  // Maximum number of chunks allowed
  maxMatchCount: 10,
  
  // Minimum number of chunks to consider RAG "successful"
  minChunksForContext: 1,
  
  // Maximum total characters from all chunks combined
  maxContextLength: 4000,
  
  // Include summary in chat context by default
  includeSummaryByDefault: true,
  
  // Similarity threshold to consider "no relevant docs"
  // If best match is below this, trigger fallback
  fallbackThreshold: 0.5
} as const

/**
 * Tavily Search Configuration
 * All search parameters are configurable here
 */
export const TAVILY_CONFIG = {
  // API endpoint
  apiUrl: 'https://api.tavily.com/search',
  
  // Default search parameters
  defaultSearchDepth: 'advanced' as 'basic' | 'advanced',
  defaultMaxResults: 10,
  
  // Content inclusion
  includeImages: false,
  includeAnswer: true,        // Get AI-generated answer summary
  
  // Extended reading (for summary generation)
  extendedReadingMaxResults: 5,
  
  // Preferred domains for repository searches
  preferredDomains: [
    // Documentation sites
    'docs.github.com',
    'readthedocs.io',
    'github.io',
    // Tutorial sites
    'dev.to',
    'medium.com',
    'stackoverflow.com',
    'hackernoon.com'
  ] as string[],
  
  // Context limits
  maxContextLength: 3000,     // Max characters from search results
  
  // Timeout
  timeout: 30000,             // 30 seconds
  
  // RAG fallback threshold
  // If RAG similarity < this, consider web search
  ragFallbackThreshold: 0.5
} as const

/**
 * MCP Tools Configuration
 * Structure for future Model Context Protocol integration
 */
export const MCP_CONFIG = {
  // Enable/disable MCP tools
  enabled: true,              // NOW ENABLED for Tavily integration
  
  // Available tools (to be populated when MCP is integrated)
  tools: [] as MCPTool[],
  
  // Tool execution settings
  maxToolCalls: 5,           // Maximum sequential tool calls
  toolTimeout: 30000,        // Timeout per tool call (ms)
  
  // Tool selection strategy
  autoSelectTools: true      // Let LLM choose tools automatically
} as const

/**
 * MCP Tool definition interface
 * This structure will be used when adding MCP tools
 */
export interface MCPTool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (params: Record<string, unknown>) => Promise<unknown>
}

/**
 * Summary Generation Configuration
 */
export const SUMMARY_CONFIG = {
  // JSON schema for structured output
  // This ensures consistent summary format
  jsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      keyFeatures: {
        type: 'array',
        items: { type: 'string' }
      },
      techStack: {
        type: 'array',
        items: { type: 'string' }
      },
      primaryLanguage: { type: 'string' },
      documentationLinks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' }
          },
          required: ['title', 'url']
        }
      },
      quickStart: { type: 'string' },
      useCases: {
        type: 'array',
        items: { type: 'string' }
      },
      additionalInfo: { type: 'string' }
    },
    required: [
      'title',
      'description',
      'keyFeatures',
      'techStack',
      'primaryLanguage',
      'documentationLinks',
      'quickStart',
      'useCases'
    ]
  },
  
  // Maximum length of README to process (characters)
  maxReadmeLength: 50000,
  
  // Maximum number of documentation links to include
  maxDocLinks: 20
} as const

/**
 * Session Configuration
 */
export const SESSION_CONFIG = {
  // Default message history limit
  defaultHistoryLimit: 50,
  
  // Maximum message history limit
  maxHistoryLimit: 200,
  
  // Session timeout (days of inactivity)
  sessionTimeoutDays: 30
} as const

/**
 * OpenAI API Configuration
 */
export const OPENAI_CONFIG = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  
  // Retry configuration
  maxRetries: 3,
  retryDelay: 1000,  // ms
  
  // Timeout for API calls
  timeout: 60000  // ms
} as const

/**
 * Helper function to get model config for a specific use case
 */
export function getModelConfig(useCase: 'summary' | 'chat') {
  return {
    model: LLM_CONFIG.models[useCase],
    temperature: LLM_CONFIG.temperature[useCase],
    maxTokens: LLM_CONFIG.maxTokens[useCase],
    topP: LLM_CONFIG.topP[useCase],
    frequencyPenalty: LLM_CONFIG.frequencyPenalty[useCase],
    presencePenalty: LLM_CONFIG.presencePenalty[useCase]
  }
}

/**
 * Helper function to validate RAG config
 */
export function validateRAGConfig(config?: {
  defaultThreshold?: number
  defaultMatchCount?: number
  includeSummaryByDefault?: boolean
}) {
  return {
    defaultThreshold: Math.max(0, Math.min(1, config?.defaultThreshold ?? RAG_CONFIG.defaultThreshold)),
    defaultMatchCount: Math.max(1, Math.min(RAG_CONFIG.maxMatchCount, config?.defaultMatchCount ?? RAG_CONFIG.defaultMatchCount)),
    maxMatchCount: RAG_CONFIG.maxMatchCount,
    minChunksForContext: RAG_CONFIG.minChunksForContext,
    maxContextLength: RAG_CONFIG.maxContextLength,
    includeSummaryByDefault: config?.includeSummaryByDefault ?? RAG_CONFIG.includeSummaryByDefault,
    fallbackThreshold: RAG_CONFIG.fallbackThreshold
  }
}

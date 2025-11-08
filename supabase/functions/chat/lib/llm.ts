/**
 * OpenAI LLM integration module
 * Supports both conversational chat and structured JSON output
 * Includes MCP tool calling support
 */

import { OPENAI_CONFIG, LLM_CONFIG, MCP_CONFIG } from './config.ts'
import type { OpenAIChatMessage, OpenAIChatResponse, OpenAITool, OpenAIToolCall } from './types.ts'
import { searchWeb } from './tavily.ts'

/**
 * LLM request configuration
 */
export interface LLMConfig {
  model: string
  temperature: number
  maxTokens: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  responseFormat?: 'text' | 'json_object'
  tools?: OpenAITool[]  // MCP tools
}

/**
 * LLM response
 */
export interface LLMResponse {
  content: string | null
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason: string
  toolCalls?: OpenAIToolCall[]
}

/**
 * Sleep utility for retry logic
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Call OpenAI Chat Completion API
 */
export async function callOpenAI(
  messages: OpenAIChatMessage[],
  config: LLMConfig,
  apiKey: string
): Promise<LLMResponse> {
  let lastError: Error | null = null

  // Retry logic
  for (let attempt = 0; attempt < OPENAI_CONFIG.maxRetries; attempt++) {
    try {
      const requestBody: Record<string, unknown> = {
        model: config.model,
        messages,
        max_completion_tokens: config.maxTokens  // Updated from max_tokens to max_completion_tokens
      }

      // Only add temperature if it's 1.0 (default) - GPT-4o and newer models only support temperature=1
      if (config.temperature === 1.0) {
        requestBody.temperature = config.temperature
      }

      // Omit optional parameters that may not be supported by newer models
      // topP, frequencyPenalty, presencePenalty are not supported by GPT-4o
      // If you need these, consider using an older model like GPT-3.5-turbo


      // Add response format for JSON mode
      if (config.responseFormat === 'json_object') {
        requestBody.response_format = { type: 'json_object' }
      }

      // Add tools if MCP is enabled and tools are provided
      if (MCP_CONFIG.enabled && config.tools && config.tools.length > 0) {
        requestBody.tools = config.tools
        requestBody.tool_choice = MCP_CONFIG.autoSelectTools ? 'auto' : 'none'
      }

      console.log(`Calling OpenAI API (attempt ${attempt + 1}/${OPENAI_CONFIG.maxRetries})`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), OPENAI_CONFIG.timeout)

      const response = await fetch(OPENAI_CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

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

      const data: OpenAIChatResponse = await response.json()

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No choices returned from OpenAI API')
      }

      const choice = data.choices[0]

      return {
        content: choice.message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        },
        finishReason: choice.finish_reason,
        toolCalls: choice.message.tool_calls
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`Attempt ${attempt + 1} failed:`, lastError.message)

      if (attempt < OPENAI_CONFIG.maxRetries - 1) {
        const backoffMs = OPENAI_CONFIG.retryDelay * Math.pow(2, attempt)
        console.log(`Retrying in ${backoffMs}ms...`)
        await sleep(backoffMs)
      }
    }
  }

  throw new Error(`Failed to call OpenAI after ${OPENAI_CONFIG.maxRetries} attempts: ${lastError?.message}`)
}

/**
 * Generate chat completion for conversational use
 */
export function generateChatCompletion(
  messages: OpenAIChatMessage[],
  useCase: 'summary' | 'chat',
  apiKey: string
): Promise<LLMResponse> {
  const config: LLMConfig = {
    model: LLM_CONFIG.models[useCase],
    temperature: LLM_CONFIG.temperature[useCase],
    maxTokens: LLM_CONFIG.maxTokens[useCase],
    topP: LLM_CONFIG.topP[useCase],
    frequencyPenalty: LLM_CONFIG.frequencyPenalty[useCase],
    presencePenalty: LLM_CONFIG.presencePenalty[useCase],
    responseFormat: 'text'
  }

  return callOpenAI(messages, config, apiKey)
}

/**
 * Generate structured JSON output (for summary generation)
 */
export function generateStructuredOutput(
  messages: OpenAIChatMessage[],
  apiKey: string
): Promise<LLMResponse> {
  const config: LLMConfig = {
    model: LLM_CONFIG.models.summary,
    temperature: LLM_CONFIG.temperature.summary,
    maxTokens: LLM_CONFIG.maxTokens.summary,
    topP: LLM_CONFIG.topP.summary,
    frequencyPenalty: LLM_CONFIG.frequencyPenalty.summary,
    presencePenalty: LLM_CONFIG.presencePenalty.summary,
    responseFormat: 'json_object'
  }

  return callOpenAI(messages, config, apiKey)
}

/**
 * Estimate token count (rough approximation)
 * 1 token ≈ 4 characters for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate cost for OpenAI API call
 * Based on current pricing as of 2024
 */
export function estimateCost(
  promptTokens: number,
  completionTokens: number,
  model: string
): number {
  // Pricing per 1M tokens
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.150, output: 0.600 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
  }

  const modelPricing = pricing[model] || pricing['gpt-4o-mini']
  
  const inputCost = (promptTokens / 1_000_000) * modelPricing.input
  const outputCost = (completionTokens / 1_000_000) * modelPricing.output
  
  return inputCost + outputCost
}

/**
 * Execute MCP tool call
 */
export async function executeToolCall(
  toolName: string,
  toolParams: Record<string, unknown>,
  tavilyApiKey?: string
): Promise<string> {
  if (!MCP_CONFIG.enabled) {
    throw new Error('MCP tools are not enabled')
  }

  console.log(`Executing tool: ${toolName}`, toolParams)
  
  try {
    switch (toolName) {
      case 'tavily_search': {
        if (!tavilyApiKey) {
          throw new Error('Tavily API key not provided')
        }
        
        const query = toolParams.query as string
        const maxResults = toolParams.max_results as number | undefined
        
        const result = await searchWeb(query, tavilyApiKey, { maxResults })
        
        // Format results for LLM
        const formatted = {
          query: result.searchQuery,
          summary: result.summary,
          sources: result.sources.map(s => ({
            title: s.title,
            url: s.url,
            content: s.snippet
          }))
        }
        
        return JSON.stringify(formatted, null, 2)
      }
      
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  } catch (error) {
    console.error(`Tool execution failed: ${toolName}`, error)
    throw error
  }
}

/**
 * Generate chat completion with tool calling support
 * Handles iterative tool calling loop
 */
export async function generateChatCompletionWithTools(
  messages: OpenAIChatMessage[],
  tools: OpenAITool[],
  apiKey: string,
  tavilyApiKey?: string,
  useCase: 'summary' | 'chat' = 'chat'
): Promise<LLMResponse> {
  const config: LLMConfig = {
    model: LLM_CONFIG.models[useCase],
    temperature: LLM_CONFIG.temperature[useCase],
    maxTokens: LLM_CONFIG.maxTokens[useCase],
    topP: LLM_CONFIG.topP[useCase],
    frequencyPenalty: LLM_CONFIG.frequencyPenalty[useCase],
    presencePenalty: LLM_CONFIG.presencePenalty[useCase],
    responseFormat: 'text',
    tools
  }

  const currentMessages = [...messages]
  let iterationCount = 0
  const totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }

  while (iterationCount < MCP_CONFIG.maxToolCalls) {
    iterationCount++
    
    const response = await callOpenAI(currentMessages, config, apiKey)
    
    // Accumulate token usage
    totalUsage.promptTokens += response.usage.promptTokens
    totalUsage.completionTokens += response.usage.completionTokens
    totalUsage.totalTokens += response.usage.totalTokens

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        ...response,
        usage: totalUsage
      }
    }

    // Execute tool calls
    console.log(`Processing ${response.toolCalls.length} tool call(s)`)
    
    // Add assistant message with tool calls
    currentMessages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls
    })

    // Execute each tool call and add results
    for (const toolCall of response.toolCalls) {
      try {
        const params = JSON.parse(toolCall.function.arguments)
        const result = await executeToolCall(toolCall.function.name, params, tavilyApiKey)
        
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: result
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({ error: errorMessage })
        })
      }
    }
  }

  // Max iterations reached
  throw new Error(`Maximum tool call iterations (${MCP_CONFIG.maxToolCalls}) exceeded`)
}

/**
 * Format messages for logging (truncate long content)
 */
export function formatMessagesForLog(messages: OpenAIChatMessage[]): string {
  return messages
    .map(msg => {
      const content = msg.content.length > 100
        ? msg.content.substring(0, 100) + '...'
        : msg.content
      return `[${msg.role}]: ${content}`
    })
    .join('\n')
}

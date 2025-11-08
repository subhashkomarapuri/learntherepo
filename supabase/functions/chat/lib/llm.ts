/**
 * OpenAI LLM integration module
 * Supports both conversational chat and structured JSON output
 */

import { OPENAI_CONFIG, LLM_CONFIG, MCP_CONFIG } from './config.ts'
import type { OpenAIChatMessage, OpenAIChatResponse } from './types.ts'

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
  tools?: unknown[]  // For future MCP integration
}

/**
 * LLM response
 */
export interface LLMResponse {
  content: string
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason: string
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
        finishReason: choice.finish_reason
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
export async function generateChatCompletion(
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
export async function generateStructuredOutput(
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
 * Placeholder for future MCP tool execution
 * This will be implemented when adding MCP support
 */
export async function executeToolCall(
  toolName: string,
  toolParams: Record<string, unknown>
): Promise<unknown> {
  if (!MCP_CONFIG.enabled) {
    throw new Error('MCP tools are not enabled')
  }

  const tool = MCP_CONFIG.tools.find(t => t.name === toolName)
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`)
  }

  console.log(`Executing tool: ${toolName}`, toolParams)
  
  try {
    const result = await tool.handler(toolParams)
    return result
  } catch (error) {
    console.error(`Tool execution failed: ${toolName}`, error)
    throw error
  }
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

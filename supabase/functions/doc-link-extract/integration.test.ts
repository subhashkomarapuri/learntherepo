/**
 * Integration tests for doc-link-extract edge function
 * These tests require the Supabase local environment to be running
 * 
 * Run with:
 * 1. Start Supabase: supabase start
 * 2. Run tests: deno test --allow-env --allow-net integration.test.ts
 */

import { assertEquals, assertExists } from "@std/assert"

const FUNCTION_URL = Deno.env.get("SUPABASE_URL") 
  ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/doc-link-extract`
  : "http://127.0.0.1:54321/functions/v1/doc-link-extract"

const AUTH_TOKEN = Deno.env.get("SUPABASE_ANON_KEY") || 
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

interface DocumentationLink {
  url: string
  anchorText: string
}

interface ApiResponse {
  success?: boolean
  owner?: string
  repo?: string
  ref?: string
  totalLinks?: number
  documentationLinks?: number
  links?: DocumentationLink[]
  error?: string
  message?: string
}

async function callFunction(url: string, ref?: string): Promise<ApiResponse> {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url, ref })
  })

  return await response.json()
}

Deno.test({
  name: "Integration - Extract doc links from Supabase repo",
  ignore: !Deno.env.get("RUN_INTEGRATION_TESTS"), // Only run when explicitly enabled
  fn: async () => {
    const result = await callFunction("https://github.com/supabase/supabase")
    
    assertExists(result.success)
    assertEquals(result.success, true)
    assertEquals(result.owner, "supabase")
    assertEquals(result.repo, "supabase")
    assertExists(result.links)
    
    // Supabase README should have documentation links
    if (result.links) {
      assertEquals(result.links.length > 0, true)
      
      // Verify structure of returned links
      const firstLink = result.links[0]
      assertExists(firstLink.url)
      assertExists(firstLink.anchorText)
      
      console.log(`Found ${result.documentationLinks} documentation links`)
      console.log("Sample links:", result.links.slice(0, 3))
    }
  }
})

Deno.test({
  name: "Integration - Invalid GitHub URL",
  ignore: !Deno.env.get("RUN_INTEGRATION_TESTS"),
  fn: async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: "https://gitlab.com/user/repo" })
    })

    assertEquals(response.ok, false)
    assertEquals(response.status, 400)
    
    const result: ApiResponse = await response.json()
    assertExists(result.error)
  }
})

Deno.test({
  name: "Integration - Missing URL parameter",
  ignore: !Deno.env.get("RUN_INTEGRATION_TESTS"),
  fn: async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    })

    assertEquals(response.ok, false)
    assertEquals(response.status, 400)
    
    const result: ApiResponse = await response.json()
    assertExists(result.error)
    assertEquals(result.message, "Please provide a GitHub repository URL")
  }
})

Deno.test({
  name: "Integration - Extract from specific branch",
  ignore: !Deno.env.get("RUN_INTEGRATION_TESTS"),
  fn: async () => {
    const result = await callFunction("https://github.com/octocat/Hello-World", "master")
    
    assertExists(result.success)
    assertEquals(result.success, true)
    assertEquals(result.ref, "master")
  }
})

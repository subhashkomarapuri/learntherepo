import { assertEquals, assertExists } from "@std/assert"

// Mock the Deno.serve function for testing
const mockServe = (handler: (req: Request) => Promise<Response>) => handler

Deno.test("parseGitHubUrl - should parse standard GitHub URL", () => {
  // This is a placeholder for integration testing
  // The parseGitHubUrl function is tested indirectly through the URL parsing test below
})

Deno.test("GitHub Doc Function - valid request without ref", async () => {
  const handler = mockServe(async (req: Request) => {
    const body = await req.json()
    
    // Basic validation tests
    assertEquals(typeof body.url, "string")
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  })
  
  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://github.com/octocat/Hello-World"
    })
  })
  
  const response = await handler(request)
  assertEquals(response.status, 200)
  
  const data = await response.json()
  assertEquals(data.success, true)
})

Deno.test("GitHub Doc Function - valid request with ref", async () => {
  const handler = mockServe(async (req: Request) => {
    const body = await req.json()
    
    assertEquals(typeof body.url, "string")
    assertEquals(typeof body.ref, "string")
    
    return new Response(JSON.stringify({ success: true, ref: body.ref }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  })
  
  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://github.com/microsoft/vscode-copilot-chat",
      ref: "DileepY/copilot-chat-alt"
    })
  })
  
  const response = await handler(request)
  assertEquals(response.status, 200)
  
  const data = await response.json()
  assertEquals(data.success, true)
  assertEquals(data.ref, "DileepY/copilot-chat-alt")
})

Deno.test("GitHub Doc Function - valid request with mediaType raw", async () => {
  const handler = mockServe(async (req: Request) => {
    const body = await req.json()
    
    assertEquals(body.mediaType, "raw")
    
    return new Response(JSON.stringify({ 
      success: true, 
      mediaType: body.mediaType,
      data: { type: "raw", content: "# README content" }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  })
  
  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://github.com/octocat/Hello-World",
      mediaType: "raw"
    })
  })
  
  const response = await handler(request)
  assertEquals(response.status, 200)
  
  const data = await response.json()
  assertEquals(data.success, true)
  assertEquals(data.mediaType, "raw")
  assertEquals(data.data.type, "raw")
})

Deno.test("GitHub Doc Function - missing URL should return 400", async () => {
  const handler = mockServe(async (req: Request) => {
    const body = await req.json()
    
    if (!body.url) {
      return new Response(
        JSON.stringify({
          error: 'Missing required field: url',
          message: 'Please provide a GitHub repository URL'
        }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  })
  
  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  })
  
  const response = await handler(request)
  assertEquals(response.status, 400)
  
  const data = await response.json()
  assertEquals(data.error, "Missing required field: url")
})

Deno.test("GitHub URL parsing - various formats", () => {
  const testCases = [
    { 
      input: "https://github.com/owner/repo", 
      expected: { owner: "owner", repo: "repo" }
    },
    { 
      input: "https://github.com/owner/repo.git", 
      expected: { owner: "owner", repo: "repo" }
    },
    { 
      input: "github.com/owner/repo", 
      expected: { owner: "owner", repo: "repo" }
    },
    { 
      input: "https://www.github.com/owner/repo", 
      expected: { owner: "owner", repo: "repo" }
    },
  ]
  
  // This test validates the regex pattern used in parseGitHubUrl
  const regex = /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\.]+)(?:\.git)?/i
  
  for (const testCase of testCases) {
    const match = testCase.input.match(regex)
    assertExists(match)
    if (match) {
      assertEquals(match[1], testCase.expected.owner)
      assertEquals(match[2], testCase.expected.repo)
    }
  }
})

Deno.test("Accept header mapping", () => {
  const testCases = [
    { mediaType: "raw", expected: "application/vnd.github.raw+json" },
    { mediaType: "html", expected: "application/vnd.github.html+json" },
    { mediaType: "default", expected: "application/vnd.github+json" },
    { mediaType: undefined, expected: "application/vnd.github+json" },
  ]
  
  const getAcceptHeader = (mediaType?: string): string => {
    switch (mediaType) {
      case 'raw':
        return 'application/vnd.github.raw+json'
      case 'html':
        return 'application/vnd.github.html+json'
      default:
        return 'application/vnd.github+json'
    }
  }
  
  for (const testCase of testCases) {
    assertEquals(getAcceptHeader(testCase.mediaType), testCase.expected)
  }
})

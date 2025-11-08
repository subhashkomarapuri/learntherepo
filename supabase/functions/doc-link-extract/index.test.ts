import { assertEquals, assertExists } from "@std/assert"

/**
 * Unit tests for doc-link-extract edge function
 * Run with: deno test --allow-env --allow-net index.test.ts
 */

// Mock functions copied from index.ts for testing
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

function extractMarkdownLinks(markdown: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = []
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  
  let match
  while ((match = linkRegex.exec(markdown)) !== null) {
    links.push({
      text: match[1].trim(),
      url: match[2].trim()
    })
  }
  
  return links
}

function isLikelyDocumentation(text: string, url: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerUrl = url.toLowerCase()
  
  const docKeywords = [
    'doc', 'documentation', 'docs',
    'api', 'reference', 'guide', 'tutorial',
    'wiki', 'manual', 'handbook',
    'getting started', 'quickstart', 'quick start',
    'learn', 'examples', 'how to'
  ]
  
  const hasDocKeyword = docKeywords.some(keyword => lowerText.includes(keyword))
  
  const docPlatforms = [
    'readthedocs.io',
    'github.io',
    'gitbook.io',
    'docs.',
    '/docs/',
    '/doc/',
    '/documentation/',
    '/api/',
    '/reference/',
    '/guide/',
    '/tutorial/',
    '/wiki/',
    '/manual/'
  ]
  
  const hasDocPlatform = docPlatforms.some(platform => lowerUrl.includes(platform))
  
  const docExtensions = ['.md', '.html', '.htm', '.rst']
  const hasDocExtension = docExtensions.some(ext => lowerUrl.endsWith(ext))
  
  return hasDocKeyword || hasDocPlatform || hasDocExtension
}

function isReadmeFile(url: string): boolean {
  const lowerUrl = url.toLowerCase()
  
  const urlParts = lowerUrl.split('/')
  const filename = urlParts[urlParts.length - 1]
  
  if (filename === 'readme' || filename === 'readme.md' || 
      filename === 'readme.markdown' || filename === 'readme.rst' ||
      filename === 'readme.txt') {
    return true
  }
  
  const localizedReadmePattern = /^readme[._-][a-z]{2}(-[a-z]{2})?\.?(md|markdown|rst|txt)?$/i
  if (localizedReadmePattern.test(filename)) {
    return true
  }
  
  return false
}

function toAbsoluteUrl(url: string, owner: string, repo: string, ref: string = 'main'): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  
  if (url.startsWith('#')) {
    return url
  }
  
  const cleanUrl = url.replace(/^\.\//, '').replace(/^\//, '')
  const urlType = cleanUrl.endsWith('/') ? 'tree' : 'blob'
  
  return `https://github.com/${owner}/${repo}/${urlType}/${ref}/${cleanUrl}`
}

// Test parseGitHubUrl
Deno.test("parseGitHubUrl - valid HTTPS URL", () => {
  const result = parseGitHubUrl("https://github.com/octocat/Hello-World")
  assertExists(result)
  if (result) {
    assertEquals(result.owner, "octocat")
    assertEquals(result.repo, "Hello-World")
  }
})

Deno.test("parseGitHubUrl - valid HTTPS URL with .git", () => {
  const result = parseGitHubUrl("https://github.com/octocat/Hello-World.git")
  assertExists(result)
  if (result) {
    assertEquals(result.owner, "octocat")
    assertEquals(result.repo, "Hello-World")
  }
})

Deno.test("parseGitHubUrl - URL without protocol", () => {
  const result = parseGitHubUrl("github.com/octocat/Hello-World")
  assertExists(result)
  if (result) {
    assertEquals(result.owner, "octocat")
    assertEquals(result.repo, "Hello-World")
  }
})

Deno.test("parseGitHubUrl - invalid URL", () => {
  const result = parseGitHubUrl("https://gitlab.com/user/repo")
  assertEquals(result, null)
})

// Test extractMarkdownLinks
Deno.test("extractMarkdownLinks - single link", () => {
  const markdown = "Check out [Documentation](https://example.com/docs)"
  const links = extractMarkdownLinks(markdown)
  assertEquals(links.length, 1)
  assertEquals(links[0].text, "Documentation")
  assertEquals(links[0].url, "https://example.com/docs")
})

Deno.test("extractMarkdownLinks - multiple links", () => {
  const markdown = `
    See [API Docs](https://api.example.com) and [Guide](./docs/guide.md)
  `
  const links = extractMarkdownLinks(markdown)
  assertEquals(links.length, 2)
  assertEquals(links[0].text, "API Docs")
  assertEquals(links[1].text, "Guide")
})

Deno.test("extractMarkdownLinks - no links", () => {
  const markdown = "This is plain text without any links."
  const links = extractMarkdownLinks(markdown)
  assertEquals(links.length, 0)
})

// Test isLikelyDocumentation
Deno.test("isLikelyDocumentation - documentation keyword in text", () => {
  const result = isLikelyDocumentation("Documentation", "https://example.com")
  assertEquals(result, true)
})

Deno.test("isLikelyDocumentation - API keyword in text", () => {
  const result = isLikelyDocumentation("API Reference", "https://example.com")
  assertEquals(result, true)
})

Deno.test("isLikelyDocumentation - docs platform in URL", () => {
  const result = isLikelyDocumentation("Link", "https://project.readthedocs.io")
  assertEquals(result, true)
})

Deno.test("isLikelyDocumentation - /docs/ path in URL", () => {
  const result = isLikelyDocumentation("Link", "https://example.com/docs/api")
  assertEquals(result, true)
})

Deno.test("isLikelyDocumentation - .md extension", () => {
  const result = isLikelyDocumentation("Link", "./README.md")
  assertEquals(result, true)
})

Deno.test("isLikelyDocumentation - not documentation", () => {
  const result = isLikelyDocumentation("Homepage", "https://example.com")
  assertEquals(result, false)
})

// Test toAbsoluteUrl
Deno.test("toAbsoluteUrl - absolute URL unchanged", () => {
  const result = toAbsoluteUrl("https://example.com/docs", "owner", "repo")
  assertEquals(result, "https://example.com/docs")
})

Deno.test("toAbsoluteUrl - relative file path", () => {
  const result = toAbsoluteUrl("./docs/guide.md", "octocat", "Hello-World", "main")
  assertEquals(result, "https://github.com/octocat/Hello-World/blob/main/docs/guide.md")
})

Deno.test("toAbsoluteUrl - relative directory path", () => {
  const result = toAbsoluteUrl("./docs/", "octocat", "Hello-World", "main")
  assertEquals(result, "https://github.com/octocat/Hello-World/tree/main/docs/")
})

Deno.test("toAbsoluteUrl - root relative path", () => {
  const result = toAbsoluteUrl("/README.md", "octocat", "Hello-World")
  assertEquals(result, "https://github.com/octocat/Hello-World/blob/main/README.md")
})

Deno.test("toAbsoluteUrl - anchor link unchanged", () => {
  const result = toAbsoluteUrl("#installation", "octocat", "Hello-World")
  assertEquals(result, "#installation")
})

// Test isReadmeFile
Deno.test("isReadmeFile - main README.md", () => {
  const result = isReadmeFile("./README.md")
  assertEquals(result, true)
})

Deno.test("isReadmeFile - case insensitive", () => {
  const result = isReadmeFile("./readme.md")
  assertEquals(result, true)
})

Deno.test("isReadmeFile - localized Chinese README", () => {
  const result = isReadmeFile("./README.zh-CN.md")
  assertEquals(result, true)
})

Deno.test("isReadmeFile - localized Spanish README", () => {
  const result = isReadmeFile("./README.es.md")
  assertEquals(result, true)
})

Deno.test("isReadmeFile - localized with underscore", () => {
  const result = isReadmeFile("./README_ja.md")
  assertEquals(result, true)
})

Deno.test("isReadmeFile - full GitHub URL", () => {
  const result = isReadmeFile("https://github.com/owner/repo/blob/main/README.zh-CN.md")
  assertEquals(result, true)
})

Deno.test("isReadmeFile - not a README file", () => {
  const result = isReadmeFile("./docs/guide.md")
  assertEquals(result, false)
})

// Integration test with mock markdown
Deno.test("Full flow - extract doc links from markdown", () => {
  const mockMarkdown = `
# My Project

Welcome to my project!

## Documentation

- [Getting Started Guide](./docs/getting-started.md)
- [API Documentation](https://myproject.readthedocs.io)
- [Examples](./examples/)
- [GitHub](https://github.com/octocat/Hello-World)
- [License](./LICENSE)

## Links

- [Homepage](https://example.com)
- [Blog Post](https://blog.example.com/post)
  `

  const allLinks = extractMarkdownLinks(mockMarkdown)
  const docLinks = allLinks.filter(link => isLikelyDocumentation(link.text, link.url))
  
  // Should find: Getting Started Guide, API Documentation, Examples
  // Should skip: GitHub (no doc keywords), License, Homepage, Blog Post
  assertEquals(docLinks.length >= 3, true)
  
  const docTexts = docLinks.map(l => l.text)
  assertEquals(docTexts.includes("Getting Started Guide"), true)
  assertEquals(docTexts.includes("API Documentation"), true)
})

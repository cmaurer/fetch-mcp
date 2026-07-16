# fetch-mcp

An MCP server that fetches a URL, fully renders it in a headless Chromium browser (so JavaScript-heavy single-page apps built with Angular, React, Vue, etc. actually populate their DOM), and returns clean, scrapeable content. Plain-HTTP "fetch" MCP servers return pre-render HTML — often just an empty `<div id="root">` shell for a SPA. This server renders first, then scrapes.

## Install and build

```bash
npm install
npm run build
```

## Run a standalone sanity check

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

This opens the MCP Inspector, where you can call `fetch_page` interactively against a real URL.

## Claude Desktop configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fetch-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/fetch-mcp/dist/index.js"]
    }
  }
}
```

## Claude Code configuration

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "fetch-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/fetch-mcp/dist/index.js"]
    }
  }
}
```

## `fetch_page` tool reference

**Input:**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string (required) | — | URL to fetch and render |
| `waitForSelector` | string (optional) | — | CSS selector to wait for before extracting content |
| `timeoutMs` | number | `30000` | Total time budget in milliseconds (max `60000`) |
| `rawHtml` | boolean | `false` | Return raw rendered HTML instead of Markdown |
| `maxContentLength` | number | `50000` | Maximum characters of returned content |

**Output:**

| Field | Type | Description |
| --- | --- | --- |
| `requestedUrl` | string | The URL that was requested |
| `finalUrl` | string | The URL after any redirects |
| `httpStatus` | number | HTTP status of the final response |
| `title` | string \| null | Page title |
| `extractionMethod` | `"readability"` \| `"body-fallback"` \| `"raw-html"` | How content was derived |
| `waitCondition` | `"selector"` \| `"networkidle"` | Which wait strategy was used |
| `waitTimedOut` | boolean | Whether the wait phase timed out (content is still returned, best-effort) |
| `truncated` | boolean | Whether `content` was cut short at `maxContentLength` |
| `content` | string | Extracted Markdown, or raw HTML if `rawHtml: true` |

**Example call:**

```json
{
  "url": "https://example.com/dashboard",
  "waitForSelector": "#app-loaded",
  "timeoutMs": 20000
}
```

## Security model

Every request URL — the initial navigation, and every subresource, redirect, or XHR/fetch the page's own JavaScript issues — is checked against a DNS-based SSRF guard before it's allowed through. A hostname is resolved via `dns.lookup` for *all* its addresses, and the request is blocked unless every resolved address falls in the `unicast` (i.e. public, globally-routable) range — this rejects loopback, RFC1918 private ranges, link-local addresses (including the `169.254.169.254` cloud metadata address), carrier-grade NAT, and other non-routable ranges.

**Known limitation:** this guard has a DNS-rebinding TOCTOU gap — the DNS check and the actual TCP connection are not atomically pinned to the same resolved IP, so a hostname could theoretically re-resolve to an unsafe address between the check and the connection. Closing this fully would require pinning the connection to the checked IP, which breaks TLS/SNI for HTTPS targets, so it isn't done for v1.

## Known limitations

- If Readability can't find article-like content (common for dashboard-style SPA shells), the full page body is converted to Markdown instead — this fallback is best-effort and may include navigation chrome or other non-content markup.
- `content` is truncated at `maxContentLength` characters; a `[content truncated]` marker and `truncated: true` are included when this happens.
- At most 3 pages render concurrently; additional concurrent `fetch_page` calls queue rather than fail.

## Development

```bash
npm run dev         # run directly with tsx, no build step
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build        # tsc, then chmod +x dist/index.js
```

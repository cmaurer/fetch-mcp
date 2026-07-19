# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server exposing a single tool, `fetch_page`, that fetches a URL, fully renders it in headless Chromium (via Puppeteer) so JS-heavy SPAs (Angular/React/Vue) actually populate their DOM, then extracts clean, scrapeable Markdown (or raw HTML) from the rendered page. Plain-HTTP "fetch" MCP servers return pre-render HTML — often just an empty `<div id="root">` shell — this one renders first, then scrapes.

## Commands

```bash
npm run dev         # run directly with tsx, no build step
npm run build        # tsc, then chmod +x dist/index.js (dist/index.js needs the exec bit — it's the bin entry point)
npm run typecheck   # tsc --noEmit
npm test            # vitest run (all tests)
npx vitest run test/ssrf-guard.test.ts   # run a single test file
npx vitest run -t "test name substring"  # run tests matching a name
```

Manual/interactive sanity check against a real URL:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

There is no lint script configured.

## Architecture

Request flow through `src/`, one module per stage:

1. **`index.ts`** — entry point (has shebang, becomes the `fetch-mcp` bin). Constructs a single shared `BrowserManager`, registers the tool, connects a stdio MCP transport. Handles `SIGINT`/`SIGTERM` to close the browser cleanly.
2. **`tool.ts`** — defines the `fetch_page` tool's Zod input/output schemas and orchestrates `renderPage` → `extractContent`, wrapping thrown errors via `toToolError`.
3. **`browser.ts`** — `BrowserManager` lazily launches a single shared Puppeteer `Browser` instance (headless), and caps concurrent page rendering at `MAX_CONCURRENT_PAGES = 3` via `p-limit`; additional concurrent calls queue rather than fail. Each `withPage` call opens and always closes its own `Page`.
4. **`render.ts`** — navigates the page and waits for it to be "ready" before scraping. Two wait strategies: wait for a CSS selector (`waitForSelector` option) or wait for network idle (default). A budget calculation ensures an already-exhausted `timeoutMs` still floors at 1ms rather than waiting forever (Puppeteer treats `timeout: 0` as "disabled"). Every request the page issues (navigation, subresources, redirects, XHR/fetch from the page's own JS) is intercepted and checked via `ssrf-guard.ts` before being allowed through.
5. **`extract.ts`** — converts rendered HTML to Markdown via Turndown (with the GFM plugin). Tries Mozilla Readability first for article-like extraction; falls back to converting the full `<body>` if Readability can't find enough content (`MIN_ARTICLE_TEXT_LENGTH = 200` chars) — this fallback is best-effort and may include nav chrome. Content is truncated at `maxContentLength` with a `[content truncated]` marker.
6. **`ssrf-guard.ts`** — the security boundary. `assertUrlIsSafe` resolves a hostname via `dns.lookup` for *all* its addresses and requires every resolved address to be in the `unicast` (public, globally-routable) range, rejecting loopback, RFC1918 private ranges, link-local (including the `169.254.169.254` cloud metadata address), CGNAT, etc. `isRequestUrlSafe` wraps this as a boolean for use in Puppeteer's request interception callback. **Known limitation:** DNS-rebinding TOCTOU gap — the DNS check and the actual TCP connection aren't atomically pinned to the same IP; not closed in v1 because pinning would break TLS/SNI for HTTPS targets.
7. **`errors.ts`** — typed error classes (`InvalidUrlError`, `SsrfBlockedError`, `NavigationFailedError`) plus `toToolError`, which converts any thrown error into an MCP `isError: true` tool result.

Each module has a matching `test/*.test.ts` file exercising it in isolation (Vitest).

## Notes for changes

- `dist/` is gitignored and built from `src/` via `tsc` — never hand-edit files there.
- Every new outbound request path (new fetch/navigation logic) must go through `ssrf-guard.ts`'s checks; don't bypass it for convenience.
- The tool's input/output schemas in `tool.ts` are the MCP contract — changing field names/types there is a breaking change for any client config.

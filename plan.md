# fetch-mcp: JS-SPA-rendering MCP server

## Context

The repo (`/Users/christianmaurer/Projects/GitHub/fetch-mcp`) is currently empty — a fresh git init with no commits. The goal is a general-purpose Node.js/TypeScript MCP server that can fetch a URL, fully render it in a headless browser (so JS-heavy SPAs built with Angular/React/Vue etc. actually populate their DOM), and return clean, scrapeable content back to the calling LLM. This fills a gap that plain-HTTP "fetch" MCP servers can't: those return pre-render HTML (often just an empty `<div id="root">` shell for a SPA).

All major design decisions below were already worked through and confirmed with the user via brainstorming dialogue, then elaborated into a concrete, API-verified implementation plan (a Plan sub-agent produced the module design; package versions and Puppeteer/MCP-SDK API calls were independently spot-checked against the real npm packages — see Verification section).

## Key design decisions (confirmed)

- **Use case**: general-purpose scraping tool for Claude, not tied to a specific site.
- **Output**: cleaned Markdown by default (Readability + Turndown), with a raw-HTML escape hatch.
- **Transport**: stdio only, via `@modelcontextprotocol/sdk`.
- **Wait strategy**: optional caller-supplied CSS selector; else network-idle heuristic; always bounded by a hard timeout.
- **Tool surface**: exactly one tool, `fetch_page`.
- **Engine**: Puppeteer (bundled Chromium) — user's explicit choice over Playwright.
- **Browser lifecycle**: one persistent, lazily-launched browser instance reused across calls; bounded concurrency (3 pages at once); graceful shutdown on SIGINT/SIGTERM.
- **Security**: SSRF guard blocking loopback/private/link-local/cloud-metadata ranges, enforced via real DNS resolution — not string matching.
- **Language**: TypeScript, compiled with `tsc`.

## Dependencies (versions verified live against npm registry)

Runtime: `@modelcontextprotocol/sdk@^1.29.0`, `zod@^4.4.3`, `puppeteer@^25.3.0`, `@mozilla/readability@^0.6.0`, `jsdom@^29.1.1`, `turndown@^7.2.4`, `turndown-plugin-gfm@^1.0.2`, `ipaddr.js@^2.4.0`, `p-limit@^7.3.0`.

Dev: `typescript@^7.0.2`, `@types/node@^26.1.1`, `@types/turndown@^5.0.6`, `tsx@^4.23.1`, `vitest@^4.1.10`.

Confirmed by extracting the real npm tarballs: `McpServer.registerTool(name, { inputSchema, outputSchema }, handler)` takes plain `ZodRawShape` objects (not `z.object(...)`), and `puppeteer-core@25.3.0`'s `Page` class exports `waitForNetworkIdle(options?: WaitForNetworkIdleOptions)` with `{ idleTime?: number, timeout?: number }`, plus `TimeoutError` from `puppeteer/common/Errors`, matching the plan below.

## File layout

```
fetch-mcp/
  package.json / tsconfig.json / README.md
  src/
    index.ts        # entrypoint: build McpServer, register tool, connect stdio, wire SIGINT/SIGTERM shutdown
    tool.ts         # Zod input/output shapes + registerFetchPageTool(server)
    browser.ts      # BrowserManager: lazy singleton Puppeteer browser, p-limit(3) concurrency, close()
    render.ts       # renderPage(): navigation + wait-strategy + per-request SSRF interception
    extract.ts      # extractContent(): Readability -> Turndown, body-fallback, truncation
    ssrf-guard.ts   # DNS-based hostname/IP validation (assertUrlIsSafe / isRequestUrlSafe)
    errors.ts       # Typed errors (InvalidUrlError, SsrfBlockedError, NavigationFailedError) + toToolError()
```

## Module responsibilities

**`ssrf-guard.ts`** — `assertUrlIsSafe(url)` rejects non-http(s) protocols, then does `dns.promises.lookup(hostname, {all:true})` to get *every* resolved address (not just one), normalizes IPv4-mapped IPv6, and uses `ipaddr.js` `.range()` to block loopback/private/linkLocal/uniqueLocal/reserved/unspecified/carrierGradeNat, with `169.254.169.254` explicitly called out. A non-throwing `isRequestUrlSafe()` variant is used inside Puppeteer's per-request interception hook.

Two enforcement layers: (1) preflight check before `page.goto()` for a fast, clean reject; (2) `page.setRequestInterception(true)` + a `request` handler that re-checks *every* request (subresources, redirects, XHR/fetch issued by the SPA itself) and aborts unsafe ones — because the initial URL can be safe while the page's own script later reaches for an internal address, or a redirect lands on one. Document the residual DNS-rebinding TOCTOU limitation in the README rather than pretending it's fully closed (a full fix would require pinning the connection to the checked IP, which breaks TLS/SNI for https targets — not worth it for v1).

**`browser.ts`** — `BrowserManager` lazily launches one Puppeteer browser on first use, exposes `withPage(fn)` wrapped in `pLimit(3)` so at most 3 renders run concurrently (excess calls queue), and `close()` for shutdown.

**`render.ts`** — `renderPage({url, waitForSelector?, timeoutMs})`: SSRF preflight → `page.setRequestInterception` + per-request guard → `page.goto(url, {waitUntil:'domcontentloaded', timeout})` → then either `page.waitForSelector` or `page.waitForNetworkIdle({idleTime:500})` using only the *remaining* time budget, so total wall-clock never exceeds `timeoutMs`. A wait-phase timeout is non-fatal (`waitTimedOut: true`, best-effort content returned); a `goto()` failure/timeout is fatal and surfaces as a structured error. Non-2xx responses are passed through as data (`httpStatus`), not treated as errors, since SPA error pages are still valid content.

**`extract.ts`** — `extractContent(html, baseUrl, {rawHtml, maxContentLength})`: runs Mozilla Readability via jsdom; if it finds no article-like content (common for dashboards/non-article SPA shells), falls back to converting the full `<body>` to Markdown via Turndown so content isn't silently dropped. Output beyond `maxContentLength` is truncated with an explicit "content truncated" note. `rawHtml: true` bypasses extraction entirely (still passes through truncation).

**`tool.ts`** — registers `fetch_page` with inputs `url` (required), `waitForSelector?`, `timeoutMs` (default 30000, max 60000), `rawHtml` (default false), `maxContentLength` (default 50000); outputs `{requestedUrl, finalUrl, httpStatus, title?, extractionMethod, waitCondition, waitTimedOut, truncated, content}`. All errors (SSRF block, invalid URL, navigation failure) are caught and returned as `{content: [...], isError: true}` — never thrown.

**`index.ts`** — builds the `McpServer`, registers the tool, connects `StdioServerTransport`, and closes the browser on SIGINT/SIGTERM before exiting.

## package.json / tsconfig notes

- `"type": "module"`, `bin: {"fetch-mcp": "dist/index.js"}`, `engines.node >= 22.12.0` (Puppeteer 25's floor).
- Scripts: `build` (tsc), `postbuild` (chmod +x dist/index.js), `start`, `dev` (tsx, no build step), `typecheck`, `test` (vitest).
- tsconfig: `module`/`moduleResolution: "NodeNext"`, `target: "ES2022"`, `strict: true` — relative imports in source need explicit `.js` extensions (NodeNext requirement).

## README outline

What it is → install/build → run standalone sanity check → Claude Desktop config (`claude_desktop_config.json`) → Claude Code config (`.mcp.json`) → `fetch_page` param/output reference with example calls → security model (SSRF guard + documented DNS-rebinding limitation) → known limitations (fallback behavior, truncation, concurrency cap) → development commands.

## Verification plan

**Automated (vitest, no real browser):**
- `ssrf-guard.test.ts`: mock `dns.promises.lookup` and assert loopback/RFC1918/link-local/cloud-metadata/IPv4-mapped-IPv6-private all blocked; a public IP allowed; multi-address responses (one public + one private) blocked; non-http(s) protocols rejected pre-DNS.
- `extract.test.ts`: article-shaped HTML → `readability` method; dashboard-shaped HTML with no article content → `body-fallback`, non-empty; oversized content → `truncated: true` with note; `rawHtml: true` → passthrough.

**Manual end-to-end (after implementation):**
1. `npm run build && npm start`, drive it via `npx @modelcontextprotocol/inspector node dist/index.js`.
2. Call `fetch_page` against a known JS-rendered SPA test page, with and without `waitForSelector`, confirming non-empty rendered Markdown (not an empty shell).
3. `rawHtml: true` returns full hydrated HTML.
4. Nonexistent selector + short `timeoutMs` → call still returns within budget, `waitTimedOut: true`.
5. `http://127.0.0.1:PORT/...` and a `169.254.169.254` metadata URL → structured `isError: true`, no hang/crash.
6. A URL known to 404 → `httpStatus: 404`, content present, `isError` not set.
7. SIGINT mid-idle and mid-request → confirm no orphaned Chromium process (`ps`/Activity Monitor).
8. 5+ concurrent calls → confirm only ~3 pages open at once.

## Critical files to create

- `package.json`, `tsconfig.json`
- `src/index.ts`, `src/tool.ts`, `src/browser.ts`, `src/render.ts`, `src/extract.ts`, `src/ssrf-guard.ts`, `src/errors.ts`
- `test/ssrf-guard.test.ts`, `test/extract.test.ts`
- `README.md`

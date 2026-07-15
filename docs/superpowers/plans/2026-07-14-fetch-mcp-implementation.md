# fetch-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/TypeScript MCP server exposing one tool, `fetch_page`, that navigates a headless Chromium browser to a URL, waits for the page (including JS-heavy SPAs) to render, and returns clean Markdown (or raw HTML) content back to the calling LLM — with an SSRF guard so it can't be used to reach internal network resources.

**Architecture:** A single persistent `BrowserManager` (Puppeteer, bounded to 3 concurrent pages via `p-limit`) is shared by one MCP tool. Each call: SSRF-validate the URL → navigate → wait for a caller-supplied selector or network-idle → extract content via Readability with a raw-body Turndown fallback → return structured JSON, never throwing (all failures become `isError: true` results).

**Tech Stack:** TypeScript (strict, NodeNext ESM) on Node >=22.12.0, `@modelcontextprotocol/sdk`, Puppeteer (bundled Chromium), `@mozilla/readability` + `jsdom` + `turndown`/`turndown-plugin-gfm`, `ipaddr.js` for SSRF range checks, `p-limit` for concurrency, `zod` for schemas, `vitest` for tests.

Full context and rationale for every decision below lives in `plan.md` at the repo root — that file was produced by an earlier brainstorming session and is the approved spec this plan implements.

## Global Constraints

- Node engine floor: `>=22.12.0` (Puppeteer 25's floor).
- `"type": "module"` throughout; relative imports in `.ts` source **must** use explicit `.js` extensions (NodeNext requirement) even though the files are `.ts`.
- `tsconfig.json`: `target: "ES2022"`, `module`/`moduleResolution: "NodeNext"`, `strict: true`.
- Exactly one MCP tool is exposed: `fetch_page`. Do not add others.
- Transport is stdio only, via `@modelcontextprotocol/sdk`'s `StdioServerTransport`.
- Browser engine is Puppeteer (bundled Chromium) — not Playwright. One persistent, lazily-launched browser instance, reused across calls, capped at 3 concurrent pages.
- Every error path returns `{ content: [...], isError: true }` from the tool handler — the handler must never throw.
- Dependency versions (all live-verified against the npm registry on 2026-07-14 — use exactly these, as `^` ranges in `package.json`):
  - Runtime: `@modelcontextprotocol/sdk@^1.29.0`, `zod@^4.4.3`, `puppeteer@^25.3.0`, `@mozilla/readability@^0.6.0`, `jsdom@^29.1.1`, `turndown@^7.2.4`, `turndown-plugin-gfm@^1.0.2`, `ipaddr.js@^2.4.0`, `p-limit@^7.3.0`.
  - Dev: `typescript@^7.0.2`, `@types/node@^26.1.1`, `@types/turndown@^5.0.6`, `tsx@^4.23.1`, `vitest@^4.1.10`.
- Confirmed live against the real npm tarball for `@modelcontextprotocol/sdk@1.29.0`: `McpServer.registerTool(name, { inputSchema, outputSchema, ... }, cb)` takes plain `ZodRawShape` objects (a `Record<string, ZodType>`, **not** `z.object(...)`); the callback receives already-parsed args (defaults applied) as its first parameter; `StdioServerTransport` is exported from `@modelcontextprotocol/sdk/server/stdio.js` and `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
- `ipaddr.js@2.4.0` ships an ambient `export = Address` module — import as `import ipaddr from 'ipaddr.js'` (works via `esModuleInterop`). `ipaddr.process(address)` auto-unwraps IPv4-mapped IPv6 addresses to plain `IPv4` before you call `.range()` — use it instead of `.parse()` for SSRF checks.
- `turndown-plugin-gfm@1.0.2` ships no type declarations (no `@types` package exists) — Task 4 creates an ambient `.d.ts` for it.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: an installable, buildable, testable Node/TypeScript project skeleton that every later task's code and tests compile and run inside.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fetch-mcp",
  "version": "0.1.0",
  "description": "MCP server that renders JS-heavy SPA pages in a headless browser and returns clean, scrapeable content",
  "type": "module",
  "bin": {
    "fetch-mcp": "dist/index.js"
  },
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "build": "tsc",
    "postbuild": "chmod +x dist/index.js",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.4.3",
    "puppeteer": "^25.3.0",
    "@mozilla/readability": "^0.6.0",
    "jsdom": "^29.1.1",
    "turndown": "^7.2.4",
    "turndown-plugin-gfm": "^1.0.2",
    "ipaddr.js": "^2.4.0",
    "p-limit": "^7.3.0"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "@types/node": "^26.1.1",
    "@types/turndown": "^5.0.6",
    "tsx": "^4.23.1",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: completes with no errors (Puppeteer will download a bundled Chromium during this step — this can take a minute).

- [ ] **Step 5: Verify the toolchain works end to end**

Run: `npx tsc --version`
Expected: prints a `Version 7.0.2` (or compatible) line, confirming TypeScript installed correctly.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: scaffold fetch-mcp project"
```

---

### Task 2: `errors.ts` — typed errors and tool-error formatting

**Files:**
- Create: `src/errors.ts`
- Test: `test/errors.test.ts`

**Interfaces:**
- Produces: `InvalidUrlError`, `SsrfBlockedError`, `NavigationFailedError` (all `Error` subclasses with `.name` set), `ToolErrorResult` type, `toToolError(err: unknown): ToolErrorResult`.
- Consumes: nothing (pure module, no internal dependencies).

- [ ] **Step 1: Write the failing test**

Create `test/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  InvalidUrlError,
  SsrfBlockedError,
  NavigationFailedError,
  toToolError,
} from '../src/errors.js';

describe('toToolError', () => {
  it('formats a known error class with its name and message', () => {
    const result = toToolError(new SsrfBlockedError('blocked 10.0.0.1'));
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'SsrfBlockedError: blocked 10.0.0.1' },
    ]);
  });

  it('formats a non-Error thrown value by stringifying it', () => {
    const result = toToolError('plain string failure');
    expect(result.content).toEqual([{ type: 'text', text: 'plain string failure' }]);
    expect(result.isError).toBe(true);
  });

  it('gives InvalidUrlError and NavigationFailedError distinct .name identities', () => {
    expect(new InvalidUrlError('bad url').name).toBe('InvalidUrlError');
    expect(new NavigationFailedError('nav failed').name).toBe('NavigationFailedError');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/errors.test.ts`
Expected: FAIL — `Cannot find module '../src/errors.js'` (file doesn't exist yet).

- [ ] **Step 3: Write `src/errors.ts`**

```ts
export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export class NavigationFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NavigationFailedError';
  }
}

export interface ToolErrorResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

export function toToolError(err: unknown): ToolErrorResult {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/errors.test.ts
git commit -m "feat: add typed tool errors and toToolError formatting"
```

---

### Task 3: `ssrf-guard.ts` — DNS-based SSRF guard

**Files:**
- Create: `src/ssrf-guard.ts`
- Test: `test/ssrf-guard.test.ts`

**Interfaces:**
- Consumes: `InvalidUrlError`, `SsrfBlockedError` from `src/errors.ts` (Task 2).
- Produces: `assertUrlIsSafe(rawUrl: string): Promise<URL>` (throws `InvalidUrlError` for bad protocol/unparseable/unresolvable URLs, `SsrfBlockedError` for unsafe resolved addresses); `isRequestUrlSafe(rawUrl: string): Promise<boolean>` (never throws — used later by Task 6's per-request interception hook).

Design note: rather than enumerating a blocklist of ranges, this blocks everything **except** `ipaddr.js`'s `'unicast'` classification — a strict allow-list that necessarily covers loopback, all private RFC1918 ranges, link-local (including the `169.254.169.254` cloud metadata address), carrier-grade NAT, and every other non-globally-routable special-use range, with no risk of missing one.

- [ ] **Step 1: Write the failing test**

Create `test/ssrf-guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns', () => ({
  promises: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

import { assertUrlIsSafe, isRequestUrlSafe } from '../src/ssrf-guard.js';
import { InvalidUrlError, SsrfBlockedError } from '../src/errors.js';

beforeEach(() => {
  lookupMock.mockReset();
});

describe('assertUrlIsSafe', () => {
  it('rejects non-http(s) protocols before doing any DNS lookup', async () => {
    await expect(assertUrlIsSafe('ftp://example.com/file')).rejects.toBeInstanceOf(
      InvalidUrlError
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows a hostname that resolves to a public IPv4 address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertUrlIsSafe('https://example.com')).resolves.toBeInstanceOf(URL);
  });

  it('blocks loopback addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertUrlIsSafe('http://localhost')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('blocks RFC1918 private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertUrlIsSafe('http://internal.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('blocks link-local addresses, including the cloud metadata address', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertUrlIsSafe('http://metadata.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('blocks IPv4-mapped IPv6 addresses that map to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.5', family: 6 }]);
    await expect(assertUrlIsSafe('http://mapped.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('blocks a hostname if ANY resolved address is unsafe, even if another is public', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(assertUrlIsSafe('http://mixed.example')).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });
});

describe('isRequestUrlSafe', () => {
  it('returns false instead of throwing for a blocked address', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(isRequestUrlSafe('http://localhost')).resolves.toBe(false);
  });

  it('returns true for a safe address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(isRequestUrlSafe('https://example.com')).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ssrf-guard.test.ts`
Expected: FAIL — `Cannot find module '../src/ssrf-guard.js'`.

- [ ] **Step 3: Write `src/ssrf-guard.ts`**

```ts
import { promises as dns } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { InvalidUrlError, SsrfBlockedError } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function parseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidUrlError(`"${rawUrl}" is not a valid URL`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidUrlError(
      `Protocol "${url.protocol}" is not allowed; only http/https are supported`
    );
  }
  return url;
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

function isAddressSafe(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === 'unicast';
}

export async function assertUrlIsSafe(rawUrl: string): Promise<URL> {
  const url = parseUrl(rawUrl);

  let addresses: string[];
  try {
    addresses = await resolveAddresses(url.hostname);
  } catch {
    throw new InvalidUrlError(`Could not resolve host "${url.hostname}"`);
  }

  if (addresses.length === 0) {
    throw new InvalidUrlError(`Could not resolve host "${url.hostname}"`);
  }

  for (const address of addresses) {
    if (!isAddressSafe(address)) {
      throw new SsrfBlockedError(
        `Blocked request to unsafe address "${address}" (resolved from "${url.hostname}")`
      );
    }
  }

  return url;
}

export async function isRequestUrlSafe(rawUrl: string): Promise<boolean> {
  try {
    await assertUrlIsSafe(rawUrl);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ssrf-guard.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ssrf-guard.ts test/ssrf-guard.test.ts
git commit -m "feat: add DNS-based SSRF guard"
```

---

### Task 4: `extract.ts` — Readability → Markdown with body fallback

**Files:**
- Create: `src/extract.ts`
- Create: `src/types/turndown-plugin-gfm.d.ts` (ambient module declaration — `turndown-plugin-gfm` ships no types)
- Test: `test/extract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module).
- Produces: `ExtractOptions { rawHtml?: boolean; maxContentLength: number }`, `ExtractionMethod = 'readability' | 'body-fallback' | 'raw-html'`, `ExtractResult { content: string; extractionMethod: ExtractionMethod; truncated: boolean }`, `extractContent(html: string, baseUrl: string, options: ExtractOptions): ExtractResult`. Task 7 (`tool.ts`) calls `extractContent` directly with these exact names.

- [ ] **Step 1: Write the ambient type declaration for `turndown-plugin-gfm`**

Create `src/types/turndown-plugin-gfm.d.ts`:

```ts
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export function gfm(turndownService: TurndownService): void;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractContent } from '../src/extract.js';

const ARTICLE_HTML = `<!doctype html>
<html>
<head><title>A Long Article About Testing</title></head>
<body>
  <header><nav>Home | About | Contact</nav></header>
  <main>
    <article>
      <h1>A Long Article About Testing</h1>
      <p>Software testing is the process of evaluating and verifying that a software product does what it is supposed to do. The benefits of testing include preventing bugs, reducing development costs, and improving performance.</p>
      <p>There are many kinds of testing, from unit tests that check a single function in isolation, to integration tests that check how multiple components work together, to end-to-end tests that exercise the whole system the way a real user would.</p>
      <p>Automated tests are valuable because they can run quickly and repeatedly, catching regressions before they reach production. A well designed test suite gives engineers the confidence to refactor code without fear of silently breaking existing behavior.</p>
      <p>Good tests are specific, deterministic, and fast. They should fail for exactly one reason, and that reason should be obvious from the test's name and assertions. Flaky tests erode trust in the whole suite and should be fixed or removed.</p>
      <p>In the end, the goal of testing is not to achieve one hundred percent coverage for its own sake, but to build justified confidence that the software behaves correctly for the situations that actually matter to its users.</p>
    </article>
  </main>
  <footer>Copyright 2026</footer>
</body>
</html>`;

const DASHBOARD_HTML = `<!doctype html>
<html>
<head><title>Dashboard</title></head>
<body>
  <div id="app">
    <nav class="sidebar">
      <button>Home</button>
      <button>Reports</button>
      <button>Settings</button>
    </nav>
    <div class="widgets">
      <div class="widget"><span class="label">Revenue</span><span class="value">$12,345</span></div>
      <div class="widget"><span class="label">Users</span><span class="value">4,201</span></div>
      <div class="widget"><span class="label">Errors</span><span class="value">3</span></div>
    </div>
  </div>
</body>
</html>`;

describe('extractContent', () => {
  it('extracts article content via Readability for article-shaped HTML', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/article', {
      maxContentLength: 50000,
    });
    expect(result.extractionMethod).toBe('readability');
    expect(result.content).toContain('Software testing');
    expect(result.truncated).toBe(false);
  });

  it('falls back to the full body for dashboard-shaped HTML with no article content', () => {
    const result = extractContent(DASHBOARD_HTML, 'https://example.com/dashboard', {
      maxContentLength: 50000,
    });
    expect(result.extractionMethod).toBe('body-fallback');
    expect(result.content.trim().length).toBeGreaterThan(0);
    expect(result.content).toContain('Revenue');
  });

  it('truncates content longer than maxContentLength and notes the truncation', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/article', {
      maxContentLength: 50,
    });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('[content truncated]');
  });

  it('passes through raw HTML unchanged when rawHtml is true', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/article', {
      rawHtml: true,
      maxContentLength: 50000,
    });
    expect(result.extractionMethod).toBe('raw-html');
    expect(result.content).toBe(ARTICLE_HTML);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/extract.test.ts`
Expected: FAIL — `Cannot find module '../src/extract.js'`.

- [ ] **Step 4: Write `src/extract.ts`**

```ts
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const MIN_ARTICLE_TEXT_LENGTH = 200;

const turndownService = new TurndownService({ headingStyle: 'atx' });
turndownService.use(gfm);

export interface ExtractOptions {
  rawHtml?: boolean;
  maxContentLength: number;
}

export type ExtractionMethod = 'readability' | 'body-fallback' | 'raw-html';

export interface ExtractResult {
  content: string;
  extractionMethod: ExtractionMethod;
  truncated: boolean;
}

export function extractContent(
  html: string,
  baseUrl: string,
  options: ExtractOptions
): ExtractResult {
  if (options.rawHtml) {
    return truncate(html, options.maxContentLength, 'raw-html');
  }

  const article = tryExtractArticle(html, baseUrl);
  if (article) {
    return truncate(turndownService.turndown(article), options.maxContentLength, 'readability');
  }

  const bodyHtml = extractBodyHtml(html, baseUrl);
  return truncate(turndownService.turndown(bodyHtml), options.maxContentLength, 'body-fallback');
}

function tryExtractArticle(html: string, baseUrl: string): string | null {
  const dom = new JSDOM(html, { url: baseUrl });
  const parsed = new Readability(dom.window.document).parse();
  if (!parsed || !parsed.content || parsed.textContent.trim().length < MIN_ARTICLE_TEXT_LENGTH) {
    return null;
  }
  return parsed.content;
}

function extractBodyHtml(html: string, baseUrl: string): string {
  const dom = new JSDOM(html, { url: baseUrl });
  return dom.window.document.body?.innerHTML ?? '';
}

function truncate(content: string, maxLength: number, method: ExtractionMethod): ExtractResult {
  if (content.length <= maxLength) {
    return { content, extractionMethod: method, truncated: false };
  }
  return {
    content: `${content.slice(0, maxLength)}\n\n[content truncated]`,
    extractionMethod: method,
    truncated: true,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/extract.ts src/types/turndown-plugin-gfm.d.ts test/extract.test.ts
git commit -m "feat: add Readability-to-Markdown extraction with body fallback"
```

---

### Task 5: `browser.ts` — `BrowserManager` (lazy singleton, bounded concurrency)

**Files:**
- Create: `src/browser.ts`
- Test: `test/browser.test.ts`

**Interfaces:**
- Consumes: `puppeteer` (mocked in tests), `p-limit`.
- Produces: `class BrowserManager { withPage<T>(fn: (page: Page) => Promise<T>): Promise<T>; close(): Promise<void>; }`. Task 6 (`render.ts`) and Task 8 (`index.ts`) both depend on this exact shape.

This task is tested entirely against a mocked `puppeteer` module — no real browser is launched. Real-browser behavior is covered by the manual end-to-end pass in Task 10.

- [ ] **Step 1: Write the failing test**

Create `test/browser.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const launchMock = vi.fn();

vi.mock('puppeteer', () => ({
  default: { launch: (...args: unknown[]) => launchMock(...args) },
}));

import { BrowserManager } from '../src/browser.js';

function makeFakeBrowser() {
  const pages: Array<{ closed: boolean; close: () => Promise<void> }> = [];
  const browser = {
    newPage: vi.fn(async () => {
      const page = {
        closed: false,
        close: vi.fn(async function (this: { closed: boolean }) {
          this.closed = true;
        }),
      };
      pages.push(page as { closed: boolean; close: () => Promise<void> });
      return page;
    }),
    close: vi.fn(async () => {}),
  };
  return { browser, pages };
}

beforeEach(() => {
  launchMock.mockReset();
});

describe('BrowserManager', () => {
  it('launches the browser lazily, only once, across multiple withPage calls', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await manager.withPage(async () => 'first');
    await manager.withPage(async () => 'second');

    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('closes the page after the callback finishes, even if it throws', async () => {
    const { browser, pages } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await expect(
      manager.withPage(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(pages).toHaveLength(1);
    expect(pages[0].closed).toBe(true);
  });

  it('never runs more than 3 callbacks concurrently', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 8 }, () =>
      manager.withPage(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      })
    );

    await Promise.all(tasks);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('closes the browser on close()', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await manager.withPage(async () => 'warm up');
    await manager.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/browser.test.ts`
Expected: FAIL — `Cannot find module '../src/browser.js'`.

- [ ] **Step 3: Write `src/browser.ts`**

```ts
import puppeteer, { type Browser, type Page } from 'puppeteer';
import pLimit from 'p-limit';

const MAX_CONCURRENT_PAGES = 3;

export class BrowserManager {
  private browserPromise: Promise<Browser> | null = null;
  private readonly limit = pLimit(MAX_CONCURRENT_PAGES);

  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return this.limit(async () => {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        return await fn(page);
      } finally {
        await page.close();
      }
    });
  }

  async close(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise;
    this.browserPromise = null;
    await browser.close();
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({ headless: true });
    }
    return this.browserPromise;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/browser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/browser.ts test/browser.test.ts
git commit -m "feat: add BrowserManager with lazy launch and bounded concurrency"
```

---

### Task 6: `render.ts` — navigation, wait strategy, per-request SSRF interception

**Files:**
- Create: `src/render.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `BrowserManager` (Task 5, only the `withPage` method), `assertUrlIsSafe` / `isRequestUrlSafe` (Task 3), `NavigationFailedError` (Task 2).
- Produces: `RenderPageOptions { url: string; waitForSelector?: string; timeoutMs: number }`, `WaitCondition = 'selector' | 'networkidle'`, `RenderResult { finalUrl: string; httpStatus: number; html: string; title: string | null; waitCondition: WaitCondition; waitTimedOut: boolean }`, `renderPage(browserManager: BrowserManager, options: RenderPageOptions): Promise<RenderResult>`. Task 7 (`tool.ts`) calls `renderPage` with these exact names.

Automated tests here only exercise the SSRF preflight short-circuit (deterministic, no real browser needed — `dns.lookup` on an IP literal like `127.0.0.1` resolves instantly and offline, and the `file://` case never reaches DNS at all). Full navigation/wait-strategy behavior against a real browser is covered by the manual end-to-end pass in Task 10.

- [ ] **Step 1: Write the failing test**

Create `test/render.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderPage } from '../src/render.js';
import { InvalidUrlError, SsrfBlockedError } from '../src/errors.js';
import type { BrowserManager } from '../src/browser.js';

function makeFakeBrowserManager(): BrowserManager {
  return {
    withPage: vi.fn(),
    close: vi.fn(),
  } as unknown as BrowserManager;
}

describe('renderPage', () => {
  it('rejects an unsafe (loopback) URL without ever touching the browser', async () => {
    const browserManager = makeFakeBrowserManager();
    await expect(
      renderPage(browserManager, { url: 'http://127.0.0.1:9/admin', timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(browserManager.withPage).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) protocol without ever touching the browser', async () => {
    const browserManager = makeFakeBrowserManager();
    await expect(
      renderPage(browserManager, { url: 'file:///etc/passwd', timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(InvalidUrlError);
    expect(browserManager.withPage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — `Cannot find module '../src/render.js'`.

- [ ] **Step 3: Write `src/render.ts`**

```ts
import type { BrowserManager } from './browser.js';
import { assertUrlIsSafe, isRequestUrlSafe } from './ssrf-guard.js';
import { NavigationFailedError } from './errors.js';

export interface RenderPageOptions {
  url: string;
  waitForSelector?: string;
  timeoutMs: number;
}

export type WaitCondition = 'selector' | 'networkidle';

export interface RenderResult {
  finalUrl: string;
  httpStatus: number;
  html: string;
  title: string | null;
  waitCondition: WaitCondition;
  waitTimedOut: boolean;
}

export async function renderPage(
  browserManager: BrowserManager,
  options: RenderPageOptions
): Promise<RenderResult> {
  await assertUrlIsSafe(options.url);

  return browserManager.withPage(async (page) => {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      isRequestUrlSafe(request.url()).then((safe) => {
        if (safe) {
          request.continue().catch(() => {});
        } else {
          request.abort('blockedbyclient').catch(() => {});
        }
      });
    });

    const start = Date.now();
    let response;
    try {
      response = await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs,
      });
    } catch (err) {
      throw new NavigationFailedError(`Failed to navigate to "${options.url}"`, { cause: err });
    }

    const remaining = Math.max(options.timeoutMs - (Date.now() - start), 0);
    const waitCondition: WaitCondition = options.waitForSelector ? 'selector' : 'networkidle';
    let waitTimedOut = false;
    try {
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: remaining });
      } else {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: remaining });
      }
    } catch {
      waitTimedOut = true;
    }

    return {
      finalUrl: page.url(),
      httpStatus: response ? response.status() : 0,
      html: await page.content(),
      title: (await page.title()) || null,
      waitCondition,
      waitTimedOut,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/render.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: add renderPage navigation with wait strategy and request-level SSRF guard"
```

---

### Task 7: `tool.ts` — register the `fetch_page` MCP tool

**Files:**
- Create: `src/tool.ts`
- Test: `test/tool.test.ts`

**Interfaces:**
- Consumes: `renderPage` (Task 6), `extractContent` (Task 4), `toToolError` (Task 2), `BrowserManager` type (Task 5), `McpServer` type from `@modelcontextprotocol/sdk/server/mcp.js`.
- Produces: `registerFetchPageTool(server: McpServer, browserManager: BrowserManager): void`. Task 8 (`index.ts`) calls this exact function.

- [ ] **Step 1: Write the failing test**

Create `test/tool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/render.js', () => ({
  renderPage: vi.fn(),
}));
vi.mock('../src/extract.js', () => ({
  extractContent: vi.fn(),
}));

import { renderPage } from '../src/render.js';
import { extractContent } from '../src/extract.js';
import { registerFetchPageTool } from '../src/tool.js';
import { SsrfBlockedError } from '../src/errors.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserManager } from '../src/browser.js';

type Handler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: 'text'; text: string }>;
}>;

function captureHandler(): Handler {
  let handler: Handler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, cb: Handler) => {
      handler = cb;
    },
  } as unknown as McpServer;
  registerFetchPageTool(fakeServer, {} as BrowserManager);
  if (!handler) throw new Error('registerTool was not called');
  return handler;
}

describe('fetch_page tool handler', () => {
  it('returns structuredContent mapped from renderPage + extractContent on success', async () => {
    vi.mocked(renderPage).mockResolvedValue({
      finalUrl: 'https://example.com/',
      httpStatus: 200,
      html: '<html></html>',
      title: 'Example',
      waitCondition: 'networkidle',
      waitTimedOut: false,
    });
    vi.mocked(extractContent).mockReturnValue({
      content: 'Example content',
      extractionMethod: 'readability',
      truncated: false,
    });

    const handler = captureHandler();
    const result = await handler({
      url: 'https://example.com',
      timeoutMs: 30000,
      rawHtml: false,
      maxContentLength: 50000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com/',
      httpStatus: 200,
      content: 'Example content',
      extractionMethod: 'readability',
    });
  });

  it('returns an isError result instead of throwing when renderPage fails', async () => {
    vi.mocked(renderPage).mockRejectedValue(new SsrfBlockedError('blocked 10.0.0.1'));

    const handler = captureHandler();
    const result = await handler({
      url: 'http://10.0.0.1',
      timeoutMs: 30000,
      rawHtml: false,
      maxContentLength: 50000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('SsrfBlockedError');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tool.test.ts`
Expected: FAIL — `Cannot find module '../src/tool.js'`.

- [ ] **Step 3: Write `src/tool.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserManager } from './browser.js';
import { renderPage } from './render.js';
import { extractContent } from './extract.js';
import { toToolError } from './errors.js';

export const fetchPageInputShape = {
  url: z.string().url().describe('The URL of the page to fetch and render.'),
  waitForSelector: z
    .string()
    .optional()
    .describe('A CSS selector to wait for before extracting content.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(30000)
    .describe('Total time budget in milliseconds.'),
  rawHtml: z
    .boolean()
    .default(false)
    .describe('Return raw rendered HTML instead of extracted Markdown.'),
  maxContentLength: z
    .number()
    .int()
    .positive()
    .default(50000)
    .describe('Maximum characters of returned content.'),
};

export const fetchPageOutputShape = {
  requestedUrl: z.string(),
  finalUrl: z.string(),
  httpStatus: z.number(),
  title: z.string().nullable(),
  extractionMethod: z.enum(['readability', 'body-fallback', 'raw-html']),
  waitCondition: z.enum(['selector', 'networkidle']),
  waitTimedOut: z.boolean(),
  truncated: z.boolean(),
  content: z.string(),
};

export function registerFetchPageTool(server: McpServer, browserManager: BrowserManager): void {
  server.registerTool(
    'fetch_page',
    {
      title: 'Fetch Page',
      description:
        'Fetches a URL, fully renders it in a headless browser (so JS-heavy SPAs populate their DOM), and returns clean, scrapeable content.',
      inputSchema: fetchPageInputShape,
      outputSchema: fetchPageOutputShape,
    },
    async (input) => {
      try {
        const rendered = await renderPage(browserManager, {
          url: input.url,
          waitForSelector: input.waitForSelector,
          timeoutMs: input.timeoutMs,
        });
        const extracted = extractContent(rendered.html, rendered.finalUrl, {
          rawHtml: input.rawHtml,
          maxContentLength: input.maxContentLength,
        });
        const structuredContent = {
          requestedUrl: input.url,
          finalUrl: rendered.finalUrl,
          httpStatus: rendered.httpStatus,
          title: rendered.title,
          extractionMethod: extracted.extractionMethod,
          waitCondition: rendered.waitCondition,
          waitTimedOut: rendered.waitTimedOut,
          truncated: extracted.truncated,
          content: extracted.content,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tool.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tool.ts test/tool.test.ts
git commit -m "feat: register fetch_page MCP tool"
```

---

### Task 8: `index.ts` — entrypoint, transport wiring, graceful shutdown

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `BrowserManager` (Task 5), `registerFetchPageTool` (Task 7), `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk`.
- Produces: the runnable server entrypoint (`dist/index.js` after build). Nothing downstream depends on this module's exports — it's wired but not imported elsewhere.

No automated test for this task (it's transport/process wiring with no pure logic to unit test); it's exercised by the manual end-to-end pass in Task 10.

- [ ] **Step 1: Write `src/index.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrowserManager } from './browser.js';
import { registerFetchPageTool } from './tool.js';

const browserManager = new BrowserManager();

const server = new McpServer({
  name: 'fetch-mcp',
  version: '0.1.0',
});

registerFetchPageTool(server, browserManager);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await browserManager.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build and typecheck**

Run: `npm run build`
Expected: completes with no TypeScript errors; `dist/index.js` (and the other compiled files) are created.

- [ ] **Step 3: Run the full automated test suite**

Run: `npm test`
Expected: all tests from Tasks 2–7 PASS (errors, ssrf-guard, extract, browser, render, tool).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire MCP server entrypoint with stdio transport and graceful shutdown"
```

---

### Task 9: `README.md`

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing (documentation only).

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

### Task 10: Manual end-to-end verification

**Files:** none (verification only — no code changes unless a check below fails, in which case fix the relevant task's file and re-run the full automated suite before continuing).

**Interfaces:** none — this task exercises the fully assembled server built by Tasks 1–9.

- [ ] **Step 1: Build and launch the Inspector**

Run:
```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```
Expected: Inspector opens in the browser and lists the `fetch_page` tool.

- [ ] **Step 2: Call `fetch_page` against a known JS-rendered SPA test page, without `waitForSelector`**

In the Inspector, call `fetch_page` with `{ "url": "https://example.com" }` (or a known SPA test page you have access to).
Expected: `content` is non-empty rendered Markdown, `extractionMethod` is `"readability"` or `"body-fallback"`, `httpStatus` is `200`.

- [ ] **Step 3: Call `fetch_page` against the same page with a `waitForSelector` for an element that exists**

Call with `{ "url": "...", "waitForSelector": "body" }`.
Expected: `waitCondition: "selector"`, `waitTimedOut: false`, non-empty content.

- [ ] **Step 4: Call `fetch_page` with `rawHtml: true`**

Call with `{ "url": "...", "rawHtml": true }`.
Expected: `extractionMethod: "raw-html"`, `content` is full hydrated HTML (contains `<html`).

- [ ] **Step 5: Call `fetch_page` with a nonexistent selector and a short `timeoutMs`**

Call with `{ "url": "...", "waitForSelector": "#this-selector-does-not-exist", "timeoutMs": 5000 }`.
Expected: call still returns within ~5 seconds, `waitTimedOut: true`, content is still present (best-effort).

- [ ] **Step 6: Call `fetch_page` against a blocked address**

Call with `{ "url": "http://127.0.0.1:9999/" }`, then with `{ "url": "http://169.254.169.254/latest/meta-data/" }`.
Expected: both return `isError: true` with an `SsrfBlockedError` message, no hang, no crash.

- [ ] **Step 7: Call `fetch_page` against a URL known to 404**

Call with a URL that returns 404 on your test target.
Expected: `httpStatus: 404`, `content` present, `isError` not set (404 is data, not an error).

- [ ] **Step 8: Verify clean shutdown**

With the server running standalone (`npm start`, not through the Inspector), send `SIGINT` (Ctrl-C) both while idle and mid-request, and confirm via `ps aux | grep -i chrome` (or Activity Monitor) that no orphaned Chromium process remains after each.

- [ ] **Step 9: Verify concurrency cap**

Fire 5+ concurrent `fetch_page` calls (e.g. from a small script using the Inspector's underlying client, or multiple manual calls in quick succession) and confirm via `ps aux | grep -i chrome` that only ~3 renderer processes are active at once.

- [ ] **Step 10: Final commit (only if any fixes were needed above)**

If every check passed with no code changes, there is nothing to commit — the implementation is complete. If a fix was needed, stage it, run `npm test` to confirm nothing regressed, and commit:

```bash
git add -A
git commit -m "fix: <describe the manual-verification fix>"
```

#!/usr/bin/env node
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
  try {
    await browserManager.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

const transport = new StdioServerTransport();
await server.connect(transport);

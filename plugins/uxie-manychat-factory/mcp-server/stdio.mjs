#!/usr/bin/env node
// SERVER:stdio.mjs — local entry. The internal-rail credential is a session file on this machine
// (MANYCHAT_SESSION_FILE, default ~/.uxie-manychat-mcp/session.json); the public-rail key is
// MANYCHAT_API_KEY or the key captured into that file. Nothing is sent anywhere but ManyChat.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makeGatewayFactory, registerTools } from './core/tools.mjs';
import { INSTRUCTIONS } from './core/instructions.mjs';
import { DEFAULT_SESSION_FILE } from './core/session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Version is injected at bundle time (esbuild --define); the un-bundled dev entry reads package.json.
const pkgVersion = typeof __MCP_VERSION__ !== 'undefined'
  ? __MCP_VERSION__
  : (() => { try { return JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8')).version; } catch { return '0.0.0-dev'; } })();

const state = {
  sessionFile: process.env.MANYCHAT_SESSION_FILE ?? DEFAULT_SESSION_FILE,
  // Optional per-registration account pin (fb<pageId>). Unset = the account the session captured.
  accountId: process.env.MANYCHAT_ACCOUNT_ID || null,
  engineVersion: pkgVersion,
};
const makeGw = makeGatewayFactory({ state });
const server = new McpServer({ name: 'uxie-manychat-mcp', version: pkgVersion }, { instructions: INSTRUCTIONS });
registerTools(server, { state, makeGw });
await server.connect(new StdioServerTransport());

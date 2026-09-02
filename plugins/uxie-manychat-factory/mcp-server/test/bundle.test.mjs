import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';
import { buildOptions, OUTFILE } from '../scripts/esbuild-config.mjs';

test('committed dist/server.mjs boots over stdio with NO session file and registers every tool', async () => {
  assert.ok(existsSync(OUTFILE), 'run npm run build');
  const t = new StdioClientTransport({ command: 'node', args: [OUTFILE], env: { ...process.env, MANYCHAT_SESSION_FILE: '/nonexistent/session.json', MANYCHAT_API_KEY: '' }, stderr: 'pipe' });
  let err = ''; t.stderr?.on('data', (d) => { err += d; });
  const c = new Client({ name: 'bundle-test', version: '0' }, { capabilities: {} });
  try {
    await c.connect(t);
    const { tools } = await c.listTools();
    assert.equal(tools.length, TOOLS.length);
    const r = await c.callTool({ name: 'auth_status', arguments: { probe: false } });
    const body = JSON.parse(r.content[0].text);
    assert.equal(body.data.internal.state, 'missing');
    assert.equal(body.data.public.state, 'missing');
    const s = await c.callTool({ name: 'search_endpoints', arguments: { intent: 'publish flow' } });
    assert.ok(JSON.parse(s.content[0].text).data.results.length > 0, 'catalogue is inlined in the bundle');
  } catch (e) { assert.fail(`bundle failed: ${e.message}\n${err.slice(0, 800)}`); }
  finally { await c.close().catch(() => {}); }
});

test('committed dist/server.mjs is in sync with source (rebuild-and-diff)', async () => {
  const result = await build(buildOptions({ write: false, logLevel: 'silent' }));
  assert.equal(result.outputFiles[0].text, readFileSync(OUTFILE, 'utf8'), 'dist/server.mjs is stale — run npm run build');
});

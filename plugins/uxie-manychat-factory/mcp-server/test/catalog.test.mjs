import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describeEndpoint, endpoints, searchEndpoints } from '../core/catalog.mjs';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the catalogue is present, carries both rails and the proven-live rows from the corpus', () => {
  const rows = endpoints();
  assert.ok(rows.length > 900, `${rows.length} rows`);
  assert.ok(rows.some((r) => r.rail === 'public' && r.path === '/fb/sending/sendFlow'));
  for (const [m, p] of [['POST', '/flow/publish'], ['POST', '/growth-tools/createWidget'], ['POST', '/keywords/createDraft'], ['GET', '/flow/getFlowData']]) {
    const row = rows.find((r) => r.rail === 'internal' && r.method === m && r.path === p);
    assert.ok(row, `${m} ${p}`); assert.equal(row.proven, 'live', `${m} ${p} proven live`);
  }
});

test('search ranks the obvious rows first and describe hands back a raw_request call', () => {
  const s = searchEndpoints({ intent: 'rename a flow', limit: 5 });
  assert.equal(s.results[0].path, '/flow/setName', JSON.stringify(s.results));
  const k = searchEndpoints({ intent: 'create keyword draft', limit: 5 });
  assert.ok(k.results.some((r) => r.path === '/keywords/createDraft'));
  assert.ok(k.results.find((r) => r.path === '/keywords/createDraft').coveredBy.includes('create_dm_keyword'));
  const d = describeEndpoint({ id: s.results[0].id });
  assert.equal(d.method, 'POST');
  assert.equal(describeEndpoint({ method: 'GET', path: '/tags/list' }).proven, 'live');
  assert.equal(searchEndpoints({ intent: 'zzzz-nothing' }).results.length, 0);
});

test('every capability a tool declares is a catalogued row (both rails), and the manifest matches TOOLS', () => {
  const rows = new Set(endpoints().map((r) => `${r.rail} ${r.method} ${r.path}`));
  const manifest = JSON.parse(readFileSync(resolve(HERE, '../capability-manifest.json'), 'utf8'));
  const declared = new Set();
  for (const t of TOOLS) for (const c of t.capabilities) {
    declared.add(`${t.name} ${c.rail} ${c.method} ${c.path}`);
    if (c.path.includes('{accountId}')) continue;   // the HTML probe is not an API route
    assert.ok(rows.has(`${c.rail} ${c.method} ${c.path}`), `${t.name} declares uncatalogued ${c.rail} ${c.method} ${c.path}`);
  }
  assert.deepEqual(new Set(manifest.map((m) => `${m.tool} ${m.rail} ${m.method} ${m.path}`)), declared, 'run npm run manifest');
});

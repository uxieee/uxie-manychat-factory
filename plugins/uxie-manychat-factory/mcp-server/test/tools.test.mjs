import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';
import { CODES } from '../core/errors.mjs';

test('every tool has a name, a description with a proof label, a schema, a handler and capabilities', () => {
  assert.ok(TOOLS.length >= 30);
  for (const t of TOOLS) {
    assert.ok(t.name && typeof t.name === 'string');
    assert.match(t.description, /proof:/, `${t.name} discloses proof status`);
    assert.match(t.description, /risk:/, `${t.name} discloses risk`);
    assert.ok(t.inputSchema && typeof t.handler === 'function' && Array.isArray(t.capabilities), t.name);
  }
});

test('read tools declare only GET capabilities', () => {
  const reads = new Set(['list_flows', 'get_flow', 'list_triggers', 'list_tags', 'list_fields', 'list_bot_fields', 'get_contact', 'find_contact', 'check_flow', 'search_endpoints', 'describe_endpoint']);
  for (const t of TOOLS.filter((x) => reads.has(x.name))) for (const c of t.capabilities) assert.equal(c.method, 'GET', `${t.name} declares ${c.method} ${c.path}`);
});

test('the activation doors are exactly set_trigger_status and send_flow, and both need confirm', async () => {
  const deps = { state: {}, makeGw: () => { throw new Error('must not reach the gateway'); } };
  const send = TOOLS.find((t) => t.name === 'send_flow');
  const r = await send.handler({ subscriber_id: 1, flow_ns: 'content20000101000000_000001' }, deps);
  assert.equal(r.code, CODES.CONFIRM_REQUIRED);
  const st = TOOLS.find((t) => t.name === 'set_trigger_status');
  const bad = await st.handler({ kind: 'widget', id: 1, status: 'trash', confirm: true }, deps);
  assert.equal(bad.code, CODES.VALIDATION_FAILED);
  assert.match(bad.detail, /deletion/);
});

test('set_trigger_status returns a dry run (no write) when confirm is missing on active', async () => {
  const calls = [];
  const gw = { accountId: () => 'fb1', call: async (method, path, body, opts) => {
    calls.push(`${method} ${path}`);
    if (path === '/growth-tools/loadWidget') return { status: 200, json: { widget: { widget_id: 5, widget_type: 'feed_comment_trigger', name: 'W', status: 'draft', namespace: 'content20000101000000_000001', data: { feed_comment_settings: { post_covered_area: 'all_posts', include_keywords_array: ['wizard'] } } } } };
    if (path === '/flow/getFlowData') return { status: 200, json: { flow: { ns: 'content20000101000000_000001', name: 'F', has_published_content: true, has_unpublished_changes: false, contents: [], triggers: {}, root_content_id: 1 } } };
    throw new Error(`unexpected ${method} ${path}`);
  } };
  const st = TOOLS.find((t) => t.name === 'set_trigger_status');
  const r = await st.handler({ kind: 'widget', id: 5, status: 'active' }, { state: {}, makeGw: () => gw });
  assert.equal(r.code, CODES.CONFIRM_REQUIRED);
  assert.equal(r.data.preview.goesLive, true);
  assert.match(r.data.preview.consequence, /REAL Instagram users/);
  assert.ok(!calls.includes('POST /growth-tools/setDraftStatus'));
});

test('session errors surface as the error contract, never thrown', async () => {
  const t = TOOLS.find((x) => x.name === 'list_flows');
  const r = await t.handler({}, { state: {}, makeGw: () => { const e = new Error('no'); e.code = 'SESSION_MISSING'; e.detail = 'no session'; e.remediation = 'connect'; throw e; } });
  assert.equal(r.ok, false); assert.equal(r.code, 'SESSION_MISSING');
});

test('unknown argument keys and credential-shaped values are refused without echo', async () => {
  const server = new McpServer({ name: 't', version: '0' });
  const client = new Client({ name: 'c', version: '0' });
  const [ct, stt] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } });
  await server.connect(stt); await client.connect(ct);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((x) => x.name).sort(), TOOLS.map((x) => x.name).sort());
    const r = await client.callTool({ name: 'get_flow', arguments: { ns: 'x', bogusKey: 1 } });
    const body = JSON.parse(r.content[0].text);
    assert.equal(body.code, CODES.VALIDATION_FAILED); assert.doesNotMatch(JSON.stringify(body), /bogusKey/);
    const s = await client.callTool({ name: 'get_flow', arguments: { ns: 'cookie: mc_production-main=abc' } });
    const sb = JSON.parse(s.content[0].text);
    assert.equal(sb.code, CODES.VALIDATION_FAILED); assert.doesNotMatch(JSON.stringify(sb), /abc/);
  } finally { await client.close(); }
});

test('build_flow dryRun returns the compiled batch and ledger without touching the account beyond reads', async () => {
  const calls = [];
  const gw = { accountId: () => 'fb1', call: async (method, path) => {
    calls.push(`${method} ${path}`);
    const j = { '/tags/list': { tags: [{ tag_id: 1, tag_name: 'Lead' }, { tag_id: 2, tag_name: 'Post or Reel Comments #4' }] }, '/growth-tools/list': { widgets: [] }, '/customFields/list': { fields: [{ field_id: 10, caption: 'Offer' }] }, '/globalFields/list': { fields: [] }, '/cms/getFlows': { list: [] } }[path];
    if (!j) throw new Error(`unexpected ${method} ${path}`);
    return { status: 200, json: { ...j, state: true } };
  } };
  const b = TOOLS.find((t) => t.name === 'build_flow');
  const r = await b.handler({ name: 'T', dryRun: true, commentTrigger: true, spec: { root: 'Hi', nodes: [{ caption: 'Hi', private_reply: true, text: 'yo', buttons: [{ caption: 'go', to: 'Tag' }] }, { caption: 'Tag', type: 'actions', actions: [{ add_tag: 'Lead' }] }] } }, { state: {}, makeGw: () => gw });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.compiled.contents.length, 2);
  assert.deepEqual(r.data.ledger.blocking, []);
  assert.ok(calls.every((c) => c.startsWith('GET ')));
  // trigger auto-tag refused by the resolver
  const r2 = await b.handler({ name: 'T', dryRun: true, spec: { root: 'A', nodes: [{ caption: 'A', type: 'actions', actions: [{ add_tag: 'Post or Reel Comments #4' }] }] } }, { state: {}, makeGw: () => gw });
  assert.equal(r2.code, CODES.VALIDATION_FAILED);
  assert.match(JSON.stringify(r2.data.problems), /does not exist/);
  // a spec that compiles but breaks a server rule is refused with the server's string
  const r3 = await b.handler({ name: 'T', dryRun: true, commentTrigger: true, spec: { root: 'A', nodes: [{ caption: 'A', text: '', buttons: [{ caption: 'a', to: 'A' }, { caption: 'b', to: 'A' }, { caption: 'c', to: 'A' }, { caption: 'd', to: 'A' }] }] } }, { state: {}, makeGw: () => gw });
  assert.equal(r3.code, CODES.VALIDATION_FAILED);
  const msgs = r3.data.blocking.map((f) => f.message);
  assert.ok(msgs.includes('Text required') && msgs.includes('Too many buttons') && msgs.some((m) => m.startsWith('Mark this message as a "Private Reply"')), msgs.join(' | '));
});

test('field tools hand back the merge tag under a name the secret scrub does not eat', async () => {
  // Named `token` it came back "<redacted>" — the one value these tools exist to return.
  const { scrubSecrets } = await import('../core/errors.mjs');
  assert.equal(scrubSecrets({ mergeTag: '{{cuf_1}}' }).mergeTag, '{{cuf_1}}');
  assert.equal(scrubSecrets({ token: '{{cuf_1}}' }).token, '<redacted>');
  const gw = { accountId: () => 'fb1', call: async () => ({ status: 200, json: { state: true, fields: [{ field_id: 7, caption: 'Offer', type: 'text' }] } }) };
  const r = await TOOLS.find((t) => t.name === 'list_fields').handler({}, { state: {}, makeGw: () => gw });
  assert.equal(r.data.fields[0].mergeTag, '{{cuf_7}}');
  assert.equal(r.data.fields[0].conditionField, 'cuf_7');
});

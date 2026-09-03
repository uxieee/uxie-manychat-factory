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
    const j = { '/tags/list': { tags: [{ tag_id: 1, tag_name: 'Lead' }, { tag_id: 2, tag_name: 'Post or Reel Comments #4' }] }, '/growth-tools/list': { widgets: [] }, '/customFields/list': { fields: [{ field_id: 10, caption: 'Offer' }] }, '/globalFields/list': { fields: [] }, '/sequence/listSequences': { sequences: [{ sequence_id: 77, name: 'Welcome drip' }] }, '/cms/getFlows': { list: [] } }[path];
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

test('edit_flow and upload_attachment are registered, declare their rails, and refuse bad input without a call', async () => {
  const edit = TOOLS.find((t) => t.name === 'edit_flow');
  const up = TOOLS.find((t) => t.name === 'upload_attachment');
  assert.ok(edit && up);
  assert.ok(edit.capabilities.some((c) => c.method === 'POST' && c.path === '/flow/publish'));
  assert.deepEqual(up.capabilities, [{ rail: 'internal', method: 'POST', path: '/content/upload' }]);
  const deps = { state: {}, makeGw: () => { throw new Error('must not reach the gateway'); } };
  const bad = await up.handler({ path: '/tmp/nope.png', type: 'hologram' }, deps);
  assert.equal(bad.code, CODES.VALIDATION_FAILED);
  assert.doesNotMatch(JSON.stringify(bad), /hologram/, 'the rejected value is not echoed');
  const missing = await up.handler({ path: '/definitely/not/here.png', type: 'image' }, deps);
  assert.equal(missing.code, CODES.VALIDATION_FAILED);
  assert.match(missing.detail, /cannot read/);
});

test('edit_flow refuses a flow with nothing published, and never publishes on dryRun', async () => {
  const calls = [];
  const flow = { ns: 'content20000101000000_000001', name: 'F', has_published_content: false, has_unpublished_changes: false, root_content_id: null, contents: [], triggers: {} };
  const gw = { accountId: () => 'fb1', call: async (m, p) => { calls.push(`${m} ${p}`); return { status: 200, json: { state: true, flow } }; } };
  const edit = TOOLS.find((t) => t.name === 'edit_flow');
  const r = await edit.handler({ ns: flow.ns, ops: [] }, { state: {}, makeGw: () => gw });
  assert.equal(r.code, CODES.VALIDATION_FAILED);
  assert.match(r.detail, /no published content/);
  assert.ok(!calls.some((c) => c.includes('publish')));
});

// REGRESSION 0.3.0 — an Instagram PDF was uploaded WITHOUT the `dest` the builder sends, so the
// server never generated the preview the builder needs (proven live by differential 2026-09-03).
// These fail if the dest matrix or the policy guard is dropped again.
test('upload_attachment sends the builder\'s `dest` and enforces the account attachment policy', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'mc-upload-'));
  const pdf = join(dir, 'doc.pdf'); writeFileSync(pdf, 'x');
  const mp4 = join(dir, 'clip.mp4'); writeFileSync(mp4, 'x');

  const POLICY = { instagram: { file: { max_bytes: 26214400, extensions: ['pdf'] }, image: { max_bytes: 8388608, extensions: ['gif', 'jpg', 'jpeg', 'png'] }, video: { max_bytes: 26214400, extensions: ['mp4', 'mov'] } } };
  const seen = [];
  const gw = { accountId: () => 'fb1', call: async (method, path, body) => {
    if (path === '/dashboard/getData') return { status: 200, json: { 'app.attachment_policy': POLICY, state: true } };
    if (path === '/content/upload') {
      seen.push({ dest: body.get('dest') ?? null, hasFile: body.has('0') });
      return { status: 200, json: { attachment: { type: 'file', caid: 1, mime: 'application/pdf', title: 'doc.pdf', preview: { status: 'success' } }, state: true } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  } };
  const up = TOOLS.find((t) => t.name === 'upload_attachment');
  const deps = { state: {}, makeGw: () => gw };

  const okPdf = await up.handler({ path: pdf, type: 'pdf', node: 'instagram' }, deps);
  assert.equal(okPdf.ok, true, JSON.stringify(okPdf));
  assert.deepEqual(seen.at(-1), { dest: 'pdf', hasFile: true }, 'an Instagram PDF carries dest=pdf');
  assert.equal(okPdf.data.wireType, 'file', 'pdf reaches the wire as file');

  // Instagram's file bucket is pdf-only: an mp4 uploaded as a file is refused BEFORE any send.
  const before = seen.length;
  const badFile = await up.handler({ path: mp4, type: 'file', node: 'instagram' }, deps);
  assert.equal(badFile.code, CODES.VALIDATION_FAILED, JSON.stringify(badFile));
  assert.match(badFile.remediation, /allows: pdf/);
  assert.equal(seen.length, before, 'nothing was uploaded');

  // The dest matrix is per (node, type), not per type alone.
  await up.handler({ path: mp4, type: 'video', node: 'telegram' }, deps);
  assert.equal(seen.at(-1).dest, 'tg_file');
  await up.handler({ path: mp4, type: 'video', node: 'whatsapp' }, deps);
  assert.equal(seen.at(-1).dest, 'wa_file');
  await up.handler({ path: mp4, type: 'video', node: 'instagram' }, deps);
  assert.equal(seen.at(-1).dest, null, 'only a PDF gets a dest on Instagram');
});

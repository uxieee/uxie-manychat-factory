import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBatch, validateObjectName } from '../core/rules.mjs';

const all = (r) => [...r.blocking, ...r.warnings];
const find = (r, rule) => all(r).find((f) => f.rule === rule);
const has = (r, rule) => all(r).some((f) => f.rule === rule);

// ---------------------------------------------------------------------------
// DELAY_EXCEEDS_MESSAGING_WINDOW
// Nothing automated reaches a contact more than 24h after their last
// interaction. A delay crossing that publishes cleanly and never sends, and
// the server reports nothing — so the ledger has to be the one to say it.
// ---------------------------------------------------------------------------

const msg = (oid, caption, target) => ({
  _oid: oid, caption, type: 'instagram',
  messages: [{ type: 'text', content: { text: 'hi' } }],
  ...(target ? { target: { _content_oid: target } } : {}),
});
const delay = (oid, caption, unit, value, target) => ({
  _oid: oid, caption, type: 'smart_delay',
  shift_time: { unit, value },
  ...(target ? { target: { _content_oid: target } } : {}),
});

test('a delay whose cumulative time exceeds 24h is reported', () => {
  const contents = [msg('a', 'Deliver', 'b'), delay('b', 'Wait', 'days', 2, 'c'), msg('c', 'Nudge')];
  const r = validateBatch({ contents, rootContent: 'a' });
  const f = find(r, 'DELAY_EXCEEDS_MESSAGING_WINDOW');
  assert.ok(f, 'expected DELAY_EXCEEDS_MESSAGING_WINDOW');
  assert.equal(f.caption, 'Wait');
  assert.match(f.detail, /48/); // states the computed total in hours
});

test('a delay comfortably inside the window is not reported', () => {
  const contents = [msg('a', 'Deliver', 'b'), delay('b', 'Wait', 'hours', 3, 'c'), msg('c', 'Follow up')];
  const r = validateBatch({ contents, rootContent: 'a' });
  assert.equal(has(r, 'DELAY_EXCEEDS_MESSAGING_WINDOW'), false);
});

test('delays accumulate along a path, so two legal waits can still cross the window', () => {
  const contents = [
    msg('a', 'Deliver', 'b'),
    delay('b', 'Wait A', 'hours', 20, 'c'),
    delay('c', 'Wait B', 'hours', 10, 'd'),
    msg('d', 'Nudge'),
  ];
  const r = validateBatch({ contents, rootContent: 'a' });
  const f = find(r, 'DELAY_EXCEEDS_MESSAGING_WINDOW');
  assert.ok(f, 'expected the cumulative 30h path to be reported');
  assert.equal(f.caption, 'Wait B'); // reported at the node that crosses it
});

test('the delay finding warns rather than blocks — a contact who re-engages reopens the window', () => {
  const contents = [msg('a', 'Deliver', 'b'), delay('b', 'Wait', 'days', 2, 'c'), msg('c', 'Nudge')];
  const r = validateBatch({ contents, rootContent: 'a' });
  assert.equal(find(r, 'DELAY_EXCEEDS_MESSAGING_WINDOW').blocking, false);
  assert.equal(r.blocking.some((f) => f.rule === 'DELAY_EXCEEDS_MESSAGING_WINDOW'), false);
});

test('a cycle in the graph does not hang the delay walk', () => {
  const contents = [msg('a', 'One', 'b'), delay('b', 'Wait', 'hours', 1, 'a')];
  const r = validateBatch({ contents, rootContent: 'a' });
  assert.equal(typeof r.count, 'number');
});

// ---------------------------------------------------------------------------
// validateObjectName — house conventions, checked where objects are created
// ---------------------------------------------------------------------------

test('a tag not in namespace:value form is reported with a suggestion', () => {
  const r = validateObjectName({ kind: 'tag', caption: 'Lead: PDF Requested' });
  const f = find(r, 'TAG_NAME_NOT_NAMESPACED');
  assert.ok(f, 'expected TAG_NAME_NOT_NAMESPACED');
  assert.equal(f.blocking, false);
  assert.match(f.detail, /lead:pdf-requested/);
});

test('a conforming tag name is clean', () => {
  const r = validateObjectName({ kind: 'tag', caption: 'state:pdf-delivered' });
  assert.equal(r.count, 0);
});

test('an uppercase tag is reported — ManyChat does not normalise tag case', () => {
  const r = validateObjectName({ kind: 'tag', caption: 'Interest:Course' });
  assert.ok(has(r, 'TAG_NAME_NOT_NAMESPACED'));
});

test('a custom field colliding with a system field is refused', () => {
  const r = validateObjectName({ kind: 'field', caption: 'Email Address' });
  const f = find(r, 'FIELD_SHADOWS_SYSTEM_FIELD');
  assert.ok(f, 'expected FIELD_SHADOWS_SYSTEM_FIELD');
  assert.equal(f.blocking, true);
  assert.match(f.detail, /email/);
});

test('every system-field synonym is caught, not just the exact name', () => {
  for (const caption of ['email', 'E-Mail', 'Phone Number', 'First Name', 'Last name', 'Full Name']) {
    assert.ok(
      has(validateObjectName({ kind: 'field', caption }), 'FIELD_SHADOWS_SYSTEM_FIELD'),
      `expected ${caption} to be caught`,
    );
  }
});

test('a field that merely mentions a system word is allowed', () => {
  assert.equal(validateObjectName({ kind: 'field', caption: 'Work Email Verified At' }).count, 0);
});

test('an object created outside a folder is reported', () => {
  const r = validateObjectName({ kind: 'flow', caption: 'Entry · WIZARD', path: '/' });
  assert.ok(has(r, 'OBJECT_NOT_IN_FOLDER'));
});

test('an object created inside a folder is clean', () => {
  assert.equal(validateObjectName({ kind: 'flow', caption: 'Entry · WIZARD', path: '/1234' }).count, 0);
});

test('emoji in an object name is reported', () => {
  const r = validateObjectName({ kind: 'flow', caption: '🚀 Entry · WIZARD', path: '/1234' });
  assert.ok(has(r, 'OBJECT_NAME_EMOJI'));
});

// ---------------------------------------------------------------------------
// The lint is wired into the tools that create objects, so it fires in the
// tool result the caller reads — not only in a document they may not open.
// ---------------------------------------------------------------------------

import { TOOLS } from '../core/tools.mjs';
import { CODES } from '../core/errors.mjs';

const noGateway = { state: {}, makeGw: () => { throw new Error('must not reach the gateway'); } };
const tool = (name) => TOOLS.find((t) => t.name === name);

test('create_field refuses a caption that shadows a system field, without calling the API', async () => {
  const r = await tool('create_field').handler({ caption: 'Email Address', type: 'text' }, noGateway);
  assert.equal(r.code, CODES.VALIDATION_FAILED);
  assert.match(JSON.stringify(r), /system field/i);
});

test('create_tag reports a non-conforming name as a convention warning but still creates it', async () => {
  const calls = [];
  const gw = { accountId: () => 'fb1', call: async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path === '/tags/create') return { status: 200, json: { tag: { tag_id: 7, tag_name: 'Lead: PDF Requested' } } };
    if (path === '/tags/list') return { status: 200, json: { tags: [{ tag_id: 7, tag_name: 'Lead: PDF Requested' }] } };
    throw new Error(`unexpected ${method} ${path}`);
  } };
  const r = await tool('create_tag').handler({ tag_name: 'Lead: PDF Requested', path: '/' }, { state: {}, makeGw: () => gw });
  assert.equal(r.ok, true, 'a convention warning must not block creation');
  assert.ok(calls.includes('POST /tags/create'));
  assert.ok(r.data.conventions, 'the result carries a conventions block');
  assert.ok(r.data.conventions.warnings.some((f) => f.rule === 'TAG_NAME_NOT_NAMESPACED'));
});

test('a conforming tag name carries no conventions block', async () => {
  const gw = { accountId: () => 'fb1', call: async (method, path) => {
    if (path === '/tags/create') return { status: 200, json: { tag: { tag_id: 8, tag_name: 'state:pdf-delivered' } } };
    if (path === '/tags/list') return { status: 200, json: { tags: [{ tag_id: 8, tag_name: 'state:pdf-delivered' }] } };
    throw new Error(`unexpected ${method} ${path}`);
  } };
  const r = await tool('create_tag').handler({ tag_name: 'state:pdf-delivered', path: '/x' }, { state: {}, makeGw: () => gw });
  assert.equal(r.ok, true);
  assert.equal(r.data.conventions, undefined);
});

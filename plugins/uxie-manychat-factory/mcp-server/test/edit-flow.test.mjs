import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditError, applyOps } from '../core/edit-flow.mjs';
import { compileSpec } from '../core/build-flow.mjs';
import { publishedToBatch, targetRefs } from '../core/flow-model.mjs';
import { validateBatch } from '../core/rules.mjs';

const ns = 'content20000101000000_000001';
const resolvers = { tagId: (n) => ({ lead: 11 }[String(n).toLowerCase()] ?? null), fieldId: (n) => ({ offer: 101 }[String(n).toLowerCase()] ?? null), botFieldId: (n) => ({ url: 201 }[String(n).toLowerCase()] ?? null) };
const ctx = { userTagIds: new Set([11]), fieldIds: new Set([101]), botFieldIds: new Set([201]), knownFlowNs: new Set([ns]), channel: 'instagram' };

// A flow shaped like one the server just returned: content_ids assigned, edges carrying both keys.
function publishedFlow() {
  const c = compileSpec({ root: 'Hello', nodes: [
    { caption: 'Hello', text: 'hi', buttons: [{ caption: 'go', to: 'Tag' }] },
    { caption: 'Tag', type: 'actions', next: 'Bye', actions: [{ add_tag: 'Lead' }] },
    { caption: 'Bye', text: 'bye' },
  ] }, { ns, resolvers });
  let id = 1000;
  const contents = c.contents.map((n) => ({ ...n, content_id: ++id }));
  const byOid = new Map(contents.map((n) => [n._oid, n]));
  for (const n of contents) for (const t of targetRefs(n)) if (t._content_oid && byOid.has(t._content_oid)) t.content_id = byOid.get(t._content_oid).content_id;
  return { contents, root: contents.find((n) => n.caption === 'Hello').content_id };
}
const cap = (b, c) => b.contents.find((x) => x.caption === c);

test('text, caption, next, private reply and buttons are edited by caption', () => {
  const batch = publishedFlow();
  const r = applyOps({ batch, ns, resolvers, ops: [
    { op: 'set_text', node: 'Hello', text: 'hello {{field:Offer}}' },
    { op: 'set_private_reply', node: 'Hello', value: true },
    { op: 'set_caption', node: 'Bye', caption: 'Farewell' },
    { op: 'set_next', node: 'Tag', to: 'Farewell' },
    { op: 'add_button', node: 'Hello', button: { caption: 'docs', url: 'https://example.com' } },
    { op: 'set_button', node: 'Hello', caption: 'go', new_caption: 'go now' },
  ] });
  const hello = cap(r, 'Hello');
  assert.equal(hello.messages[0].content.text, 'hello {{cuf_101}}', 'name tokens resolve on edit too');
  assert.equal(hello.private_reply, 'private_reply');
  assert.ok(cap(r, 'Farewell'), 'renamed');
  assert.equal(hello.messages[0].keyboard.map((b) => b.caption).join(','), 'go now,docs');
  // an edge to an existing node keeps BOTH keys, which is what the server returned
  assert.equal(hello.messages[0].keyboard[0].content_id, cap(r, 'Tag').content_id);
  assert.equal(cap(r, 'Tag').target.content_id, cap(r, 'Farewell').content_id);
  assert.deepEqual(r.summary.changed.sort(), ['Farewell', 'Hello', 'Tag']);
  assert.deepEqual(validateBatch({ contents: r.contents, rootContent: r.root, context: ctx }).blocking, []);
});

test('add_node wires new nodes by caption and remove_node rewires every edge into it', () => {
  const batch = publishedFlow();
  const r = applyOps({ batch, ns, resolvers, ops: [
    { op: 'add_node', node: { caption: 'Wait', type: 'delay', value: 2, unit: 'hours', next: 'Bye' } },
    { op: 'set_next', node: 'Tag', to: 'Wait' },
    { op: 'add_node', node: { caption: 'Ask', type: 'message', blocks: [{ question: { text: 'email?', save_to: 'email', next: 'Bye' } }] } },
  ] });
  assert.equal(cap(r, 'Tag').target._content_oid, cap(r, 'Wait')._oid);
  assert.equal(cap(r, 'Wait').target.content_id, cap(r, 'Bye').content_id, 'a new node points at an existing one by content_id');
  assert.equal(cap(r, 'Ask').messages[0].answer_type, 'email');
  assert.deepEqual(r.summary.added.sort(), ['Ask', 'Wait']);

  // removing a node an edge points at REFUSES unless told where to rewire
  assert.throws(() => applyOps({ batch: publishedFlow(), ns, resolvers, ops: [{ op: 'remove_node', node: 'Tag' }] }),
    (e) => e instanceof EditError && /still points at/.test(JSON.stringify(e.problems)));
  const r2 = applyOps({ batch: publishedFlow(), ns, resolvers, ops: [{ op: 'remove_node', node: 'Tag', rewire: 'Bye' }] });
  assert.equal(cap(r2, 'Hello').messages[0].keyboard[0].content_id, cap(r2, 'Bye').content_id);
  assert.equal(r2.contents.find((c) => c.caption === 'Tag').removed, true, 'removed:true, never dropped from the batch');
  // and the root cannot be removed out from under the flow
  assert.throws(() => applyOps({ batch: publishedFlow(), ns, resolvers, ops: [{ op: 'remove_node', node: 'Hello', rewire: null }] }),
    (e) => /is the root/.test(JSON.stringify(e.problems)));
});

test('typed ops refuse the wrong node type, unknown captions and unknown ops — all at once, nothing applied', () => {
  assert.throws(() => applyOps({ batch: publishedFlow(), ns, resolvers, ops: [
    { op: 'set_actions', node: 'Hello', actions: [{ add_tag: 'Lead' }] },
    { op: 'set_text', node: 'Nope', text: 'x' },
    { op: 'set_delay', node: 'Tag', value: 5, unit: 'hours' },
    { op: 'wat', node: 'Hello' },
    { op: 'set_next', node: 'Hello', to: 'Ghost' },
  ] }), (e) => {
    const m = JSON.stringify(e.problems);
    assert.match(m, /is not an action group/);
    assert.match(m, /no node with caption/);
    assert.match(m, /is not a delay node/);
    assert.match(m, /unknown op/);
    assert.match(m, /edge to unknown caption/);
    return true;
  });
});

test('action and condition ops compile through the same code as build_flow', () => {
  const batch = publishedFlow();
  const r = applyOps({ batch, ns, resolvers, ops: [
    { op: 'add_action', action: { set_field: { field: 'Offer', value: '{{bot:URL}}' } }, node: 'Tag' },
    { op: 'add_node', node: { caption: 'Which?', type: 'condition', else: 'Bye', conditions: [{ if: { all: [{ system_field: 'email', op: 'HAS_VALUE' }, { tag: 'Lead' }] }, then: 'Bye' }] } },
  ] });
  assert.equal(cap(r, 'Tag').actions[1].value, '{{gaf_201}}');
  const f = cap(r, 'Which?').conditions[0].filter;
  assert.equal(f.groups[0].items.length, 2);
  assert.equal(f.groups[0].operator, 'AND');
  assert.deepEqual(validateBatch({ contents: r.contents, rootContent: r.root, context: ctx }).blocking, []);
});

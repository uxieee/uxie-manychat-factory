import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompileError, compileSpec } from '../core/build-flow.mjs';
import { validateBatch } from '../core/rules.mjs';
import { layoutCoordinates, publishedToBatch, captionErrors, duplicateOids, stripStats } from '../core/flow-model.mjs';

const ns = 'content20000101000000_000001';
const resolvers = { tagId: (n) => ({ 'keyword: wizard': 11, 'mc - lead': 12 }[n.toLowerCase()] ?? null), fieldId: (n) => ({ 'mc offer url': 101, 'mc interest': 102 }[n.toLowerCase()] ?? null), botFieldId: (n) => ({ 'offer url - wizard': 201 }[n.toLowerCase()] ?? null) };
const spec = {
  root: 'Comment reply',
  nodes: [
    { caption: 'Comment reply', type: 'message', private_reply: true, text: 'Hey {{first_name}} 👋 tap below', buttons: [{ caption: 'Send it to me', to: 'Stamp' }] },
    { caption: 'Stamp', type: 'actions', next: 'Email?', actions: [{ add_tag: 'Keyword: Wizard' }, { set_field: { field: 'MC Offer URL', value: '{{bot:Offer URL - Wizard}}' } }] },
    { caption: 'Email?', type: 'condition', conditions: [{ if: { system_field: 'email', op: 'HAS_VALUE' }, then: 'Deliver' }], else: 'Ask' },
    { caption: 'Ask', type: 'message', blocks: [{ question: { text: 'Best email?', save_to: 'email', retry_text: 'Try again', next: 'Deliver' } }] },
    { caption: 'Deliver', type: 'message', text: 'Here: {{field:MC Offer URL}}' },
  ],
};

test('compileSpec mints fresh _oids, wires edges by caption, resolves names and tokens', () => {
  const c = compileSpec(spec, { ns, resolvers });
  assert.equal(c.contents.length, 5);
  assert.equal(duplicateOids(c.contents).length, 0);
  const by = Object.fromEntries(c.contents.map((x) => [x.caption, x]));
  assert.equal(c.root, by['Comment reply']._oid);
  assert.equal(by['Comment reply'].private_reply, 'private_reply');
  assert.equal(by['Comment reply'].messages[0].keyboard[0]._content_oid, by.Stamp._oid);
  assert.equal(by.Stamp.actions[0].tag_id, 11);
  assert.equal(by.Stamp.actions[1].value, '{{gaf_201}}');
  assert.equal(by.Stamp.target._content_oid, by['Email?']._oid);
  assert.equal(by['Email?'].conditions[0].filter.groups[0].items[0].field, 'email');
  assert.equal(by['Email?'].default_target._content_oid, by.Ask._oid);
  assert.equal(by.Ask.messages[0].answer_type, 'email');
  assert.deepEqual(by.Ask.messages[0].adapters.map((a) => a.type), ['save_email_to_system_field', 'set_email_optin']);
  assert.equal(by.Ask.messages[0].success_target._content_oid, by.Deliver._oid);
  assert.equal(by.Deliver.messages[0].content.text, 'Here: {{cuf_101}}');
  // two compiles never share an _oid
  const c2 = compileSpec(spec, { ns, resolvers });
  assert.equal(c2.root === c.root, false);
  // the compiled batch passes the ledger with a comment trigger attached
  const r = validateBatch({ contents: c.contents, rootContent: c.root, context: { userTagIds: new Set([11, 12]), fieldIds: new Set([101, 102]), botFieldIds: new Set([201]), commentTriggerAttached: true, channel: 'instagram' } });
  assert.deepEqual(r.blocking, []);
});

test('compileSpec names every problem at once and sends nothing', () => {
  try {
    compileSpec({ root: 'X', nodes: [{ caption: 'A', text: 'hi', buttons: [{ caption: 'go', to: 'Nowhere' }] }, { caption: 'A', type: 'actions', actions: [{ add_tag: 'No Such Tag' }] }] }, { ns, resolvers });
    assert.fail('threw');
  } catch (e) {
    assert.ok(e instanceof CompileError);
    const msgs = e.problems.map((p) => p.message).join('\n');
    assert.match(msgs, /root "X" names no node/);
    assert.match(msgs, /duplicate caption "A"/);
    assert.match(msgs, /unknown caption "Nowhere"/);
    assert.match(msgs, /tag "No Such Tag" does not exist/);
  }
});

test('layoutCoordinates: BFS columns from the root, orphans to the right, root at x0', () => {
  const c = compileSpec(spec, { ns, resolvers });
  const l = layoutCoordinates(c.contents, c.root, { col: 100, row: 50, x0: 900 });
  const by = Object.fromEntries(c.contents.map((x) => [x.caption, l.coords[x._oid]]));
  assert.deepEqual(by['Comment reply'], { x: 900, y: 0 });
  assert.deepEqual(by.Stamp, { x: 1000, y: 0 });
  assert.deepEqual(by['Email?'], { x: 1100, y: 0 });
  assert.equal(by.Deliver.x, 1200); assert.equal(by.Ask.x, 1200);
  assert.equal(l.columns, 4); assert.deepEqual(l.orphans, []);
});

test('publishedToBatch strips server stat keys and re-adds the envelope; captionErrors re-keys by caption', () => {
  const flow = { ns, root_content_id: 5, contents: [{ type: 'instagram', content_id: 5, caption: 'Hello', namespace: ns, deleted: false, data: { _oid: 'o1', messages: [{ type: 'text', content: { text: 'x' }, keyboard: [{ caption: 'b', button_click_stats: { clicks: 1 } }] }], stats: { sent_total: 3 }, sent_segment_id: 'seg' } }, { type: 'goto', content_id: 6, caption: 'Gone', deleted: true, data: { _oid: 'o2' } }] };
  const b = publishedToBatch(flow);
  assert.equal(b.contents.length, 1);
  assert.equal(b.root, 5);
  const n = b.contents[0];
  assert.equal(n.type, 'instagram'); assert.equal(n.content_id, 5); assert.equal(n.caption, 'Hello'); assert.equal(n.removed, false);
  assert.equal('stats' in n, false); assert.equal('sent_segment_id' in n, false); assert.equal('button_click_stats' in n.messages[0].keyboard[0], false);
  assert.deepEqual(captionErrors({ 'o1.private_reply': 'msg' }, b.contents)[0], { key: 'o1.private_reply', caption: 'Hello', type: 'instagram', oid: 'o1', content_id: 5, prop: 'private_reply', message: 'msg' });
  assert.equal(stripStats({ a: { stats: 1, b: 2 } }).a.stats, undefined);
});

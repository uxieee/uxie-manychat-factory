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

test('0.2.0 conditions: one test, all, any, and a nested group', () => {
  const c = compileSpec({ root: 'C', nodes: [
    { caption: 'End', text: 'x' },
    { caption: 'C', type: 'condition', else: 'End', conditions: [
      { if: { system_field: 'email', op: 'HAS_VALUE' }, then: 'End' },
      { if: { all: [{ system_field: 'email', op: 'HAS_VALUE' }, { tag: 'Keyword: Wizard' }] }, then: 'End' },
      { if: { any: [{ tag: 'Keyword: Wizard' }, { field: 'MC Interest', op: 'IS', value: 'Wizard' }] }, then: 'End' },
      { if: { all: [{ any: [{ tag: 'Keyword: Wizard' }, { tag: 'MC - Lead' }] }, { system_field: 'email', op: 'HAS_VALUE' }] }, then: 'End' },
    ] },
  ] }, { ns, resolvers: { ...resolvers, tagId: (n) => ({ 'keyword: wizard': 11, 'mc - lead': 12 }[String(n).toLowerCase()] ?? null) } });
  const node = c.contents.find((x) => x.caption === 'C');
  const [one, all, any, nested] = node.conditions.map((x) => x.filter);
  assert.equal(one.groups.length, 1); assert.equal(one.groups[0].items.length, 1);
  assert.equal(all.groups[0].operator, 'AND'); assert.equal(all.groups[0].items.length, 2);
  assert.equal(any.groups[0].operator, 'OR'); assert.equal(any.groups[0].items.length, 2);
  // a nested group becomes TWO groups joined by the outer operator
  assert.equal(nested.operator, 'AND'); assert.equal(nested.groups.length, 2);
  assert.equal(nested.groups[0].operator, 'OR'); assert.equal(nested.groups[0].items.length, 2);
  assert.equal(nested.groups[1].items[0].field, 'email');
  // the custom-field item is the STRING cuf_<id>, which is the shape the server demands
  assert.equal(any.groups[0].items[1].field, 'cuf_102');
});

test('0.2.0 blocks: an uploaded attachment, cards and dynamic compile to the exporter shapes; a URL image is refused with the reason', () => {
  const upload = { caid: 543813059, type: 'image', title: 'a.png', img_big: 'https://cdn.example/big.png' };
  const c = compileSpec({ root: 'N', nodes: [
    { caption: 'Next', text: 'x' },
    { caption: 'N', type: 'message', blocks: [
      { attachment: { type: 'image', data: upload } },
      { cards: [{ title: 'One', subtitle: 'sub', image: upload, url: 'https://example.com', buttons: [{ caption: 'go', to: 'Next' }] }] },
      { dynamic: { url: 'https://example.com/api', method: 'post', payload: { a: 1 }, fallback: 'Next' } },
    ] },
  ] }, { ns, resolvers });
  const n = c.contents.find((x) => x.caption === 'N');
  const [att, cards, dyn] = n.messages;
  assert.equal(att.type, 'attachment'); assert.equal(att.content.type, 'image'); assert.equal(att.content.data.caid, 543813059);
  assert.equal(cards.type, 'cards'); assert.equal(cards.elements[0].content.image.caid, 543813059);
  assert.equal(cards.elements[0].default_action.url, 'https://example.com');
  assert.equal(cards.elements[0].keyboard[0]._content_oid, c.captionToOid.Next);
  assert.equal(dyn.type, 'dynamic'); assert.equal(dyn.method, 'post');
  // payload reaches the wire as a STRING — an object fails with "Something went wrong" (live-proven)
  assert.equal(typeof dyn.payload, 'string');
  assert.deepEqual(JSON.parse(dyn.payload), { a: 1 });
  assert.equal(dyn.fallback._content_oid, c.captionToOid.Next);

  // A URL image is refused at compile time, naming the fix — the server would answer
  // "Attachment without caid" (live-proven for every URL-only shape).
  for (const blocks of [[{ image_url: 'https://example.com/a.png' }], [{ cards: [{ title: 'T', image_url: 'https://example.com/a.png' }] }]]) {
    assert.throws(() => compileSpec({ root: 'N', nodes: [{ caption: 'N', type: 'message', blocks }] }, { ns, resolvers }),
      (e) => /upload_attachment/.test(JSON.stringify(e.problems)));
  }
});

test('0.2.0 actions: sequences, conversations, opt-ins, pause, events, menus and integrations', () => {
  const c = compileSpec({ root: 'A', nodes: [{ caption: 'A', type: 'actions', actions: [
    { add_to_sequence: 55 }, { remove_from_sequence: 56 },
    { open_conversation: true }, { close_conversation: true }, { assign_conversation: { user_id: 9 } },
    { set_optin: 'email' }, { set_optout: 'sms' },
    { pause_automations: { duration: 3600 } }, { resume_automation: true },
    { fire_custom_event: { event_id: 3, cost: 10 } }, { set_main_menu: 'content20260101010101_123456' },
    { integration: { type: 'google_sheets', action: 'add_row', data: { spreadsheet: 's' } } },
  ] }] }, { ns, resolvers });
  const types = c.contents[0].actions.map((a) => a.type);
  assert.deepEqual(types, ['add_to_sequence', 'remove_from_sequence', 'open_conversation', 'close_conversation', 'assign_conversation', 'set_email_optin', 'set_sms_optout', 'pause_automations', 'resume_automation', 'fire_custom_event', 'set_user_level_menu', 'google_sheets']);
  assert.equal(c.contents[0].actions[0].sequence_id, 55);
  assert.equal(c.contents[0].actions[7].pause_duration, 3600);
  assert.equal(c.contents[0].actions[11].action, 'add_row');
  // a bad integration name and a bad optin channel are named, not silently accepted
  assert.throws(() => compileSpec({ root: 'A', nodes: [{ caption: 'A', type: 'actions', actions: [{ integration: { type: 'salesforce', action: 'x' } }] }] }, { ns, resolvers }),
    (e) => /is not/.test(JSON.stringify(e.problems)));
});

test('0.2.0 ai node compiles with its prompt and default_target', () => {
  const c = compileSpec({ root: 'Ask', nodes: [
    { caption: 'End', text: 'x' },
    { caption: 'Ask', type: 'ai', prompt: 'Answer using {{field:MC Offer URL}}', next: 'End' },
  ] }, { ns, resolvers: { ...resolvers, fieldId: () => 101 } });
  const n = c.contents.find((x) => x.caption === 'Ask');
  assert.equal(n.type, 'ai_node');
  assert.equal(n.prompt, 'Answer using {{cuf_101}}');
  assert.equal(n.default_target._content_oid, c.captionToOid.End);
  assert.deepEqual(n.abilities, []);
});

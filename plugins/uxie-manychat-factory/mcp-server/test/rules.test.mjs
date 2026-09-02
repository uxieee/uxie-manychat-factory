import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, validateBatch, validateKeywordRules, validateWidgetData } from '../core/rules.mjs';
import { blocks, buttons, nodes, ref } from '../core/flow-model.mjs';

const ns = 'content20000101000000_000001';
const ctx = { userTagIds: new Set([1]), triggerTagIds: new Set([2]), fieldIds: new Set([10]), botFieldIds: new Set([20]), knownFlowNs: new Set([ns]), channel: 'instagram' };
const ruleIds = (r) => [...r.blocking, ...r.warnings].map((f) => f.rule);

test('every rule carries a layer and the server string when server-enforced', () => {
  for (const [id, r] of Object.entries(RULES)) {
    assert.ok(['S', 'C', 'S+C'].includes(r.layer), id);
    if (r.serverEnforced === true) assert.ok(r.serverMessage, `${id} needs the server string`);
    if (r.layer === 'C') assert.ok(r.clientMessage, `${id} needs the client string`);
  }
});

test('a clean comment-reply flow passes with a trigger attached', () => {
  const stamp = nodes.actionGroup(ns, 'Stamp', [{ type: 'add_tag', tag_id: 1 }]);
  const hello = nodes.instagram(ns, 'Hello', { private_reply: 'private_reply' });
  hello.messages.push(blocks.text('Hey', [buttons.content('Send it', stamp._oid)]));
  const r = validateBatch({ contents: [hello, stamp], rootContent: hello._oid, context: { ...ctx, commentTriggerAttached: true } });
  assert.deepEqual(r.blocking, []);
});

test('the three private-reply rules fire with the exact server strings', () => {
  const next = nodes.instagram(ns, 'Next'); next.messages.push(blocks.text('ok'));
  const root = nodes.instagram(ns, 'Root', { target: ref(next._oid) });
  root.messages.push(blocks.text('a'), blocks.text('b'));
  const r1 = validateBatch({ contents: [root, next], rootContent: root._oid, context: { ...ctx, commentTriggerAttached: true } });
  const f = r1.blocking.find((x) => x.rule === 'PRIVATE_REPLY_ROOT_REQUIRED');
  assert.ok(f); assert.equal(f.serverMessage, RULES.PRIVATE_REPLY_ROOT_REQUIRED.serverMessage); assert.equal(f.key, `${root._oid}.private_reply`);
  root.private_reply = 'private_reply';
  const r2 = validateBatch({ contents: [root, next], rootContent: root._oid, context: { ...ctx, commentTriggerAttached: true } });
  assert.ok(ruleIds(r2).includes('PRIVATE_REPLY_NO_TARGET'));
  assert.ok(ruleIds(r2).includes('PRIVATE_REPLY_ONE_BLOCK'));
  // without a trigger attached the same shapes pass (live-11)
  const r3 = validateBatch({ contents: [root, next], rootContent: root._oid, context: { ...ctx, commentTriggerAttached: false } });
  assert.deepEqual(r3.blocking.filter((x) => x.rule.startsWith('PRIVATE')), []);
});

test('server-enforced message rules block; client-only rules warn', () => {
  const n = nodes.instagram(ns, 'N');
  n.messages.push(blocks.text('', [buttons.content('a', 'zzz'), buttons.content('b', 'zzz'), buttons.content('c', 'zzz'), buttons.content('', 'zzz')]));
  n.messages.push(blocks.text('x'.repeat(1500)));
  n.messages.push(blocks.question({ text: '', answer_type: 'bogus' }));
  n.quick_replies = { buttons: [buttons.content('q', 'zzz')], settings: {} };
  const r = validateBatch({ contents: [n], rootContent: n._oid, context: ctx });
  const ids = ruleIds(r);
  for (const must of ['TEXT_REQUIRED', 'BUTTONS_MAX_3', 'BUTTON_CAPTION_REQUIRED', 'QUESTION_TEXT_REQUIRED', 'ANSWER_TYPE_UNSUPPORTED', 'QR_AFTER_QUESTION', 'TARGET_NOT_IN_BATCH']) assert.ok(r.blocking.some((f) => f.rule === must), must);
  assert.ok(r.warnings.some((f) => f.rule === 'TEXT_OVER_1000'));
  assert.equal(r.blocking.find((f) => f.rule === 'ANSWER_TYPE_UNSUPPORTED').message, 'Answer type bogus is unsupported');
  assert.ok(ids.includes('BUTTONS_MAX_3'));
});

test('action, condition, split, delay, goto and note rules', () => {
  const a = nodes.actionGroup(ns, 'A', [{ type: 'add_tag', tag_id: 2 }, { type: 'add_tag', tag_id: 99 }, { type: 'set_custom_field_value', field_id: 5, value: 'x' }, { type: 'external_request', url: '', method: 'POST', headers: {}, payload: '{', mapping: [] }, { type: 'bogus' }]);
  const c = nodes.condition(ns, 'C');
  c.conditions.push({ _oid: 'x', filter: { operator: 'AND', groups: [{ operator: 'AND', items: [{ _oid: 'i', type: 'suf', field: 'nope', operator: 'WAT' }, { _oid: 'j', type: 'cuf', field: '10', operator: 'IS', value: 1 }, { _oid: 'k', type: 'cuf', field: 10, operator: 'IS', value: 1 }] }] }, target: null });
  const s = nodes.split(ns, 'S'); s.variants.push({ _oid: 'v', type: 'variant', data: {}, percent: 60, target: null }, { _oid: 'w', type: 'variant', data: {}, percent: 30, target: null });
  const d = nodes.smartDelay(ns, 'D', 5, 'weeks');
  const g = nodes.goto(ns, 'G', 'content20000101000000_000009');
  const n = nodes.note(ns, 'hi', { color: 'purple', font_size: 'huge', note_size: 'xl' });
  const r = validateBatch({ contents: [a, c, s, d, g, n], rootContent: a._oid, context: ctx });
  const msgs = r.blocking.map((f) => f.message);
  for (const m of ['Wrong tag', 'Wrong field', 'url cannot be empty', 'Unsupported action type', 'Field item not found: nope', 'Unsupported operator WAT', 'Wrong field format: 10', 'Field must be a string', 'Percents sum must be equal to 100', 'Invalid unit', 'Wrong content provided.', 'Wrong font size', 'Wrong note size', 'Wrong note color']) assert.ok(msgs.includes(m), m);
  assert.ok(r.warnings.some((f) => f.rule === 'EXTERNAL_PAYLOAD_JSON'));
  assert.ok(r.warnings.some((f) => f.rule === 'CONDITION_NO_TARGET'));
});

test('duplicate _oids and a missing root are blocking', () => {
  const a = nodes.instagram(ns, 'A'); a.messages.push(blocks.text('x'));
  const b = { ...a, caption: 'B' };
  const r = validateBatch({ contents: [a, b], rootContent: 'nope', context: ctx });
  assert.ok(r.blocking.some((f) => f.rule === 'DUPLICATE_OID'));
  assert.ok(r.blocking.some((f) => f.rule === 'BATCH_ROOT_MISSING'));
});

test('widget data: area required, specific_post needs a post, replies and keywords are client-only', () => {
  const r = validateWidgetData({ feed_comment_settings: { post_covered_area: 'specific_post', post_id: 0, comment_contains: 'specific_words', include_keywords_array: [] }, feed_comment_welcome: { public_reply_messages: ['a', 'a'] } });
  assert.ok(r.blocking.some((f) => f.message === 'Please select a post to track comments'));
  assert.ok(r.warnings.some((f) => f.rule === 'WIDGET_KEYWORDS_REQUIRED'));
  assert.ok(r.warnings.some((f) => f.rule === 'WIDGET_REPLIES_MIN_3'));
  assert.ok(r.warnings.some((f) => f.rule === 'WIDGET_REPLIES_UNIQUE'));
  assert.ok(validateWidgetData({ feed_comment_settings: {}, feed_comment_welcome: {} }).blocking.some((f) => f.rule === 'WIDGET_AREA_MISSING'));
  assert.ok(validateWidgetData({ feed_comment_settings: { post_covered_area: 'bogus' }, feed_comment_welcome: {} }).blocking.some((f) => f.rule === 'WIDGET_AREA_INVALID'));
  assert.deepEqual(validateWidgetData({ feed_comment_settings: { post_covered_area: 'all_posts', include_keywords_array: ['x'] }, feed_comment_welcome: { public_reply_messages: ['a', 'b', 'c'] } }).blocking, []);
});

test('keyword rules: system keywords and unknown conditions block; 13 keywords blocked by tool policy', () => {
  const r = validateKeywordRules({ keyword_rules: [{ condition: 'contains', keywords: ['hello', 'STOP'] }, { condition: 'regex', keywords: ['x'] }, { condition: 'equals', keywords: Array.from({ length: 13 }, (_, i) => `k${i}`) }], channel: 'instagram' });
  assert.ok(r.blocking.some((f) => f.message === 'Trying to rewrite system keyword rule'));
  assert.ok(r.blocking.some((f) => f.rule === 'KEYWORD_CONDITION_UNKNOWN'));
  assert.ok(r.blocking.some((f) => f.rule === 'KEYWORDS_MAX_12'));
  assert.deepEqual(validateKeywordRules({ keyword_rules: [{ condition: 'contains', keywords: ['wizard'] }], channel: 'instagram' }).blocking, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODES, containsSecrets, fail, failureOf, ok, scrubSecrets } from '../core/errors.mjs';

test('scrubSecrets redacts cookie, csrf and public-key shaped values and whole secret subtrees', () => {
  const r = scrubSecrets({ cookies: { 'mc_production-main': 'abcdef' }, csrf: 'tok', note: 'x-csrf-token: ABCDEF1234', key: '5505817:' + 'a'.repeat(64), stripe: 'pk_live_ABCDEFGHIJKLMNOP', fine: 'hello' });
  assert.equal(r.cookies, '<redacted>');
  assert.equal(r.csrf, '<redacted>');
  assert.match(r.note, /<redacted>/);
  assert.doesNotMatch(JSON.stringify(r), /aaaaaaaa|pk_live_ABC|ABCDEF1234/);
  assert.equal(r.fine, 'hello');
});

test('containsSecrets flags secret-named keys and token-shaped strings', () => {
  assert.equal(containsSecrets({ cookie: 'x' }), true);
  assert.equal(containsSecrets({ path: '/flow/getFlowData' }), false);
  assert.equal(containsSecrets('Bearer 12345678:abcdefghijklmnop'), true);
});

test('failureOf classifies the ManyChat envelopes', () => {
  assert.equal(failureOf({ status: 401, json: null, html: true }).code, CODES.SESSION_EXPIRED);
  assert.equal(failureOf({ status: 405, json: null, html: false, waf: true }).code, CODES.SESSION_EXPIRED);
  assert.equal(failureOf({ status: 200, json: null, html: true }).code, CODES.SESSION_EXPIRED);
  assert.equal(failureOf({ status: 404, json: null, html: true }).code, CODES.NOT_FOUND);
  assert.equal(failureOf({ status: 500, json: null, html: true }).code, CODES.UPSTREAM_500);
  const biz = failureOf({ status: 200, json: { state: false, $errors: [{ message: 'Tag with the specified name already exists', original_message: 'x', field: 'tag_name' }], errors: ['x'] } });
  assert.equal(biz.code, CODES.BUSINESS_ERROR);
  assert.match(biz.detail, /already exists/);
  const pub = failureOf({ status: 200, json: { state: false, $errors: [], content_node_errors: { 'abc.private_reply': 'Mark this message as a "Private Reply"' } } });
  assert.equal(pub.code, CODES.PUBLISH_REJECTED);
  assert.ok(pub.data.content_node_errors['abc.private_reply']);
  assert.equal(failureOf({ status: 200, json: { state: true, flow: {} } }), null);
  assert.equal(failureOf({ status: 401, json: null }, 'public').code, CODES.API_KEY_REJECTED);
  assert.equal(failureOf({ status: 200, json: { status: 'error', message: 'nope' } }, 'public').code, CODES.BUSINESS_ERROR);
  assert.equal(failureOf({ status: 200, json: { status: 'success', data: {} } }, 'public'), null);
});

test('ok/fail scrub at the contract boundary', () => {
  assert.equal(ok({ cookie: 'v' }).data.cookie, '<redacted>');
  assert.match(fail('X', 'authorization: Bearer abcdefghijkl', 'r').detail, /<redacted>/);
});

test('a URL path is not read as a labelled secret (our own remediation text was being redacted)', () => {
  // ManyChat's mint route is /api/token/generate; `token/generate` matched label+separator+value.
  for (const text of ['POST /api/token/generate', 'GET /fb/page/getInfo', 'path /settings/getPublicAPIToken']) {
    assert.equal(scrubSecrets({ note: text }).note, text);
    assert.equal(containsSecrets(text), false, text);
  }
  // and the real shapes still go
  assert.match(scrubSecrets({ note: 'token: abc123' }).note, /<redacted>/);
  assert.match(scrubSecrets({ note: 'x-csrf-token=abc123' }).note, /<redacted>/);
  assert.match(scrubSecrets({ note: 'cookie: mc_production-main=zzz' }).note, /<redacted>/);
});

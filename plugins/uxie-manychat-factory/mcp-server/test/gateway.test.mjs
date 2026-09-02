import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeInternalGateway, makePublicGateway } from '../core/gateway.mjs';
import { CODES } from '../core/errors.mjs';

const sessionFile = () => {
  const f = join(mkdtempSync(join(tmpdir(), 'mc-gw-')), 'session.json');
  writeFileSync(f, JSON.stringify({ version: 1, accountId: 'fb1', pageId: '1', cookies: { 'mc_production-main': 'COOKIE', 'aws-waf-token': 'WAF' }, csrf: 'CSRF', bundle: '490', publicApiToken: '1:' + 'k'.repeat(60) }));
  return f;
};
const resp = (status, body, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const noSleep = { sleepImpl: async () => {}, randomImpl: () => 0 };

test('internal gateway sends cookie, csrf, bundle, requested-with and error-format headers and prefixes the account', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return resp(200, { state: true, flow: {} }, { 'content-type': 'application/json' }); };
  const gw = makeInternalGateway({ sessionFile: sessionFile(), fetchImpl, ...noSleep });
  const r = await gw.call('GET', '/flow/getFlowData', undefined, { query: { ns: 'content1' } });
  assert.equal(r.status, 200);
  assert.equal(calls[0].url, 'https://app.manychat.com/fb1/flow/getFlowData?ns=content1');
  const h = calls[0].init.headers;
  assert.equal(h.cookie, 'mc_production-main=COOKIE; aws-waf-token=WAF');
  assert.equal(h['x-csrf-token'], 'CSRF');
  assert.equal(h['x-frontend-bundle'], '490');
  assert.equal(h['x-requested-with'], 'XMLHttpRequest');
  assert.equal(h['use-new-error-format'], 'True');
  assert.equal(calls[0].init.body, undefined);
});

test('accountId override and accountless routes', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return resp(200, { state: true }, { 'content-type': 'application/json' }); };
  const gw = makeInternalGateway({ sessionFile: sessionFile(), accountId: 'fb9', fetchImpl, ...noSleep });
  await gw.call('POST', '/tags/create', { tag_name: 'x' });
  await gw.call('GET', '/agency/get', undefined, { accountless: true });
  assert.equal(calls[0], 'https://app.manychat.com/fb9/tags/create');
  assert.equal(calls[1], 'https://app.manychat.com/agency/get');
});

test('a 401 triggers ONE csrf re-scrape with the same cookie, then one retry; a dead session stays SESSION_EXPIRED', async () => {
  const f = sessionFile();
  let n = 0;
  const fetchImpl = async (url) => {
    n++;
    if (url.endsWith('/fb1/cms')) return resp(200, '<script>\n        window.STATIC_VERSION = 491;\n        window.__INIT__ = {"app.csrf_token":"NEWCSRF","app.currentAccount":{"id":"fb1","page_id":1}};\n</script>', { 'content-type': 'text/html' });
    if (n === 1) return resp(401, '<html>nope</html>', { 'content-type': 'text/html' });
    return resp(200, { state: true, ok: n }, { 'content-type': 'application/json' });
  };
  const gw = makeInternalGateway({ sessionFile: f, fetchImpl, ...noSleep });
  const r = await gw.call('GET', '/tags/list');
  assert.equal(r.status, 200);
  assert.equal(n, 3, 'call, re-scrape, retry');
  const saved = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(saved.csrf, 'NEWCSRF');
  assert.equal(saved.bundle, '491');
  // second refusal on the same gateway: no second refresh, the 401 is returned as-is
  let m = 0;
  const dead = makeInternalGateway({ sessionFile: f, fetchImpl: async (url) => { m++; return url.endsWith('/cms') ? resp(302, '', { location: 'https://app.manychat.com/login' }) : resp(401, '<html>', { 'content-type': 'text/html' }); }, ...noSleep });
  const r2 = await dead.call('GET', '/tags/list');
  assert.equal(r2.status, 401);
  assert.equal(m, 2, 'one call + one failed re-scrape, no loop');
});

test('keySource values survive the secret scrub (a colon after "session" made it "<redacted>")', async () => {
  const { scrubSecrets } = await import('../core/errors.mjs');
  for (const v of ['env-MANYCHAT_API_KEY', 'captured-at-connect']) assert.equal(scrubSecrets({ keySource: v }).keySource, v);
  assert.equal(scrubSecrets({ keySource: 'session:captured' }).keySource, 'session: <redacted>');
});

test('public gateway uses MANYCHAT_API_KEY first, then the captured key, else API_KEY_MISSING', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init.headers.authorization); return resp(200, { status: 'success', data: {} }, { 'content-type': 'application/json' }); };
  const env = makePublicGateway({ sessionFile: sessionFile(), apiKey: '1:ENVKEY', fetchImpl, ...noSleep });
  await env.call('GET', '/fb/page/getInfo');
  assert.equal(env.keySource, 'env-MANYCHAT_API_KEY');
  assert.equal(calls[0], 'Bearer 1:ENVKEY');
  const cap = makePublicGateway({ sessionFile: sessionFile(), apiKey: null, fetchImpl, ...noSleep });
  assert.equal(cap.keySource, 'captured-at-connect');
  const f = join(mkdtempSync(join(tmpdir(), 'mc-gw-')), 'session.json');
  writeFileSync(f, JSON.stringify({ accountId: 'fb1', cookies: { 'mc_production-main': 'c' } }));
  assert.throws(() => makePublicGateway({ sessionFile: f, apiKey: null, fetchImpl }), (e) => e.code === CODES.API_KEY_MISSING);
});

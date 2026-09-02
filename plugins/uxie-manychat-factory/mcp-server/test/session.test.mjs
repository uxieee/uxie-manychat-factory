import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, scrapeInit, sessionStatus, writeSession } from '../core/session.mjs';
import { CODES } from '../core/errors.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'mc-session-'));
const good = () => ({ version: 1, accountId: 'fb1', pageId: '1', cookies: { 'mc_production-main': 'secretcookie' }, cookieExpiresAt: new Date(Date.now() + 86400000).toISOString(), csrf: 'c', bundle: '490', capturedAt: new Date().toISOString() });

test('readSession refuses a missing file with SESSION_MISSING and a remediation aimed at the agent', () => {
  try { readSession({ sessionFile: join(dir(), 'nope.json') }); assert.fail('threw'); }
  catch (e) { assert.equal(e.code, CODES.SESSION_MISSING); assert.match(e.remediation, /manychat-connect/); }
});

test('readSession refuses an expired cookie with SESSION_EXPIRED', () => {
  const f = join(dir(), 'session.json');
  writeFileSync(f, JSON.stringify({ ...good(), cookieExpiresAt: new Date(Date.now() - 1000).toISOString() }));
  try { readSession({ sessionFile: f }); assert.fail('threw'); } catch (e) { assert.equal(e.code, CODES.SESSION_EXPIRED); }
});

test('writeSession writes 0600 and sessionStatus reports claims only', () => {
  const f = join(dir(), 'session.json');
  writeSession(good(), { sessionFile: f });
  assert.equal(statSync(f).mode & 0o777, 0o600);
  const s = sessionStatus({ sessionFile: f });
  assert.equal(s.state, 'ok');
  assert.equal(s.csrfPresent, true);
  assert.ok(s.cookieDaysRemaining > 0);
  assert.doesNotMatch(JSON.stringify(s), /secretcookie/);
  assert.equal(readSession({ sessionFile: f }).accountId, 'fb1');
});

test('scrapeInit pulls csrf, bundle and account facts out of the page and nothing else', () => {
  const html = `<script nonce="x">\n        window.STATIC_VERSION = 490;\n        window.__INIT__ = ${JSON.stringify({ 'app.STRIPE_KEY': 'pk_live_zzz', 'app.csrf_token': 'CSRF123', 'app.currentAccount': { id: 'fb42', page_id: 42, title: 'Acme', pro_status: 'pro', timezone: 'UTC', public_api_access_token: null, instagram_channel: { status: 'active' }, fb_channel: { status: 'none' } }, 'app.currentAccountUser': { user_id: 7, user_role: 'admin' } })};\n</script>`;
  const i = scrapeInit(html);
  assert.equal(i.found, true);
  assert.equal(i.csrf, 'CSRF123');
  assert.equal(i.bundle, '490');
  assert.equal(i.accountId, 'fb42');
  assert.equal(i.pageId, '42');
  assert.equal(i.channels.instagram, 'active');
  assert.equal('app.STRIPE_KEY' in i, false);
  assert.equal(scrapeInit('<html>no init</html>').found, false);
});

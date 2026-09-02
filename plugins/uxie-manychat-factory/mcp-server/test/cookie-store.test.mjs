import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createHash } from 'node:crypto';
import { decryptValue, deriveKey, readCookies, chromeTimeToIso, MOCK_KEYCHAIN_PASSWORD } from '../scripts/cookie-store.mjs';

const encrypt = (key, value, host, withHash) => {
  const c = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  const plain = withHash ? Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)]) : Buffer.from(value);
  return Buffer.concat([Buffer.from('v10'), c.update(plain), c.final()]);
};

test('decrypts a mock-keychain Chrome cookie store, with and without the Chrome ≥130 host hash prefix', () => {
  const key = deriveKey(MOCK_KEYCHAIN_PASSWORD);
  assert.equal(decryptValue(key, encrypt(key, 'hello', '.manychat.com', false), '.manychat.com'), 'hello');
  assert.equal(decryptValue(key, encrypt(key, 'hello', '.manychat.com', true), '.manychat.com'), 'hello');
  const dir = mkdtempSync(join(tmpdir(), 'mc-cookie-'));
  const db = new DatabaseSync(join(dir, 'Cookies'));
  db.exec('create table cookies (host_key text, name text, encrypted_value blob, expires_utc integer, path text, is_httponly integer)');
  const ins = db.prepare('insert into cookies values (?,?,?,?,?,?)');
  const farFuture = 13467401564831857n;   // > 2^53: the real store carries these
  ins.run('.manychat.com', 'mc_production-main', encrypt(key, 'SESSIONVALUE', '.manychat.com', true), 13390000000000000n, '/', 1);
  ins.run('.app.manychat.com', 'aws-waf-token', encrypt(key, 'WAFVALUE', '.app.manychat.com', true), farFuture, '/', 0);
  ins.run('.example.com', 'other', encrypt(key, 'x', '.example.com', true), 0n, '/', 0);
  db.close();
  const r = readCookies({ dbPath: join(dir, 'Cookies'), hostLike: '%manychat.com%' });
  assert.equal(r.keySource, 'mock-keychain');
  assert.equal(r.cookies['mc_production-main'].value, 'SESSIONVALUE');
  assert.equal(r.cookies['aws-waf-token'].value, 'WAFVALUE');
  assert.equal('other' in r.cookies, false);
  assert.match(r.cookies['mc_production-main'].expiresAt, /^20\d\d-/);
  assert.equal(chromeTimeToIso(0), null);
});

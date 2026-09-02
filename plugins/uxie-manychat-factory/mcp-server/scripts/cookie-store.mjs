// Read + decrypt cookies for one host family out of a Chromium `Cookies` SQLite store.
//
// The chrome-devtools-mcp browser (~/.cache/chrome-devtools-mcp/chrome-profile) and the Playwright
// MCP browsers are launched with `--use-mock-keychain --password-store=basic`, so on macOS their
// cookie values are AES-128-CBC under a key derived from the literal password "mock_password"
// (PBKDF2-HMAC-SHA1, salt "saltysalt", 1003 rounds, 16 bytes, IV = 16 spaces). No Keychain prompt.
// A regular Chrome profile would need `security find-generic-password -w -s "Chrome Safe Storage"`;
// that path is offered as a fallback and the prompt it raises is the user's to accept.
//
// Chrome ≥ 130 prefixes the decrypted value with SHA-256(host_key) (32 bytes); stripped when present.
//
// Values NEVER go to stdout. Callers get a { name → value } map to write into a 0600 file.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync, createDecipheriv, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DEVTOOLS_COOKIES = join(homedir(), '.cache', 'chrome-devtools-mcp', 'chrome-profile', 'Default', 'Cookies');
export const MOCK_KEYCHAIN_PASSWORD = 'mock_password';

export const deriveKey = (password) => pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');

export function decryptValue(key, encrypted, hostKey) {
  const b = Buffer.from(encrypted);
  if (b.length === 0) return '';
  if (b.subarray(0, 3).toString() !== 'v10') throw new Error('unsupported cookie encryption version');
  const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  let out = Buffer.concat([d.update(b.subarray(3)), d.final()]);
  const h = createHash('sha256').update(hostKey).digest();
  if (out.length >= 32 && out.subarray(0, 32).equals(h)) out = out.subarray(32);
  return out.toString('utf8');
}

// Chrome stores expires_utc as microseconds since 1601-01-01; 0 = session cookie.
export const chromeTimeToIso = (micros) => {
  const n = typeof micros === 'bigint' ? Number(micros) : Number(micros);
  if (!n) return null;
  return new Date(n / 1000 - 11644473600000).toISOString();
};

const keychainPassword = () => {
  try {
    return execFileSync('security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};

// Returns { cookies: {name:{value, host, expiresAt}}, keySource } for hosts matching `hostLike`.
// The store is COPIED first: Chrome holds it locked while running.
export function readCookies({ dbPath = DEVTOOLS_COOKIES, hostLike = '%manychat.com%', passwords = null } = {}) {
  if (!existsSync(dbPath)) throw new Error(`no Cookies store at ${dbPath}`);
  const dir = mkdtempSync(join(tmpdir(), 'mc-cookies-'));
  const copy = join(dir, 'Cookies');
  copyFileSync(dbPath, copy);
  try {
    const db = new DatabaseSync(copy, { readOnly: true });
    // expires_utc exceeds 2^53 for far-future cookies; cast to text so node:sqlite does not throw.
    const rows = db.prepare('select host_key, name, encrypted_value, cast(expires_utc as text) as expires_utc from cookies where host_key like ?').all(hostLike);
    db.close();
    const candidates = passwords ?? [MOCK_KEYCHAIN_PASSWORD];
    let lastErr = null;
    for (const pw of candidates) {
      const key = deriveKey(pw);
      const out = {}; let bad = 0;
      for (const r of rows) {
        try {
          const v = decryptValue(key, r.encrypted_value, r.host_key);
          if (!/^[\x20-\x7e]*$/.test(v)) { bad++; continue; }
          out[r.name] = { value: v, host: r.host_key, expiresAt: chromeTimeToIso(r.expires_utc) };
        } catch (e) { bad++; lastErr = e; }
      }
      if (rows.length && bad === 0) return { cookies: out, keySource: pw === MOCK_KEYCHAIN_PASSWORD ? 'mock-keychain' : 'password', rows: rows.length };
    }
    if (!passwords) {
      // Not a mock-keychain profile: try the real Keychain once (this raises the macOS prompt).
      const pw = keychainPassword();
      if (pw) return readCookies({ dbPath, hostLike, passwords: [pw] });
    }
    throw new Error(`could not decrypt ${rows.length} cookie rows${lastErr ? ` (${lastErr.message})` : ''}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

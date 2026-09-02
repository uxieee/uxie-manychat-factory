// The internal-rail credential is a FILE on the user's machine, written by the connect flow
// (scripts/connect.mjs behind /uxie-manychat-factory:manychat-connect). It is re-read on every call so a
// reconnect mid-session needs no restart. Nothing in here ever returns a cookie or the CSRF token
// to a caller — status reports are claims ABOUT the session (expiry, account, bundle), never values.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CODES, RECONNECT } from './errors.mjs';

export const DEFAULT_SESSION_DIR = join(homedir(), '.uxie-manychat-mcp');
export const DEFAULT_SESSION_FILE = join(DEFAULT_SESSION_DIR, 'session.json');
export const SESSION_COOKIE = 'mc_production-main';
export const WAF_COOKIE = 'aws-waf-token';

export class SessionError extends Error {
  constructor(code, detail, remediation) { super(detail); this.code = code; this.detail = detail; this.remediation = remediation; }
}

// session.json v1:
// { version:1, accountId:"fb<pageId>", pageId:"<digits>", accountTitle, cookies:{name:value},
//   cookieExpiresAt: iso|null, wafExpiresAt: iso|null, csrf, bundle:"490", capturedAt: iso,
//   source:"chrome-devtools-profile", publicApiToken: "<pageId>:<token>"|null, userId, userRole }
export function readSession({ sessionFile = DEFAULT_SESSION_FILE } = {}) {
  if (!sessionFile || !existsSync(sessionFile)) {
    throw new SessionError(CODES.SESSION_MISSING, `no session file at ${sessionFile ?? '(unset)'}`,
      'NO SESSION YET — set one up yourself rather than asking. Run the `uxie-manychat-factory:manychat-connect` '
      + 'flow (scripts/connect.mjs): it reads the app.manychat.com cookies from the chrome-devtools browser '
      + 'profile and writes the session file. If that profile holds no ManyChat login, the user logs in once '
      + 'there (the sign-in CAPTCHA is theirs to pass). Then retry the call that failed.');
  }
  let s;
  try { s = JSON.parse(readFileSync(sessionFile, 'utf8')); }
  catch { throw new SessionError(CODES.SESSION_MISSING, `session file at ${sessionFile} is not JSON`, RECONNECT); }
  if (!s?.cookies?.[SESSION_COOKIE]) throw new SessionError(CODES.SESSION_MISSING, `session file has no ${SESSION_COOKIE} cookie`, RECONNECT);
  if (!s.accountId) throw new SessionError(CODES.SESSION_MISSING, 'session file has no accountId', RECONNECT);
  if (s.cookieExpiresAt && Date.parse(s.cookieExpiresAt) < Date.now()) {
    throw new SessionError(CODES.SESSION_EXPIRED, `the session cookie expired at ${s.cookieExpiresAt}`, RECONNECT);
  }
  return s;
}

export function writeSession(session, { sessionFile = DEFAULT_SESSION_FILE } = {}) {
  mkdirSync(dirname(sessionFile), { recursive: true, mode: 0o700 });
  const tmp = `${sessionFile}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, sessionFile);
  return sessionFile;
}

export const cookieHeader = (cookies) => Object.entries(cookies ?? {}).map(([k, v]) => `${k}=${v}`).join('; ');

const daysUntil = (iso) => (iso ? Math.round(((Date.parse(iso) - Date.now()) / 86400000) * 10) / 10 : null);

// Claims about the session — NEVER values. Field names deliberately avoid the secret-key denylist
// in errors.mjs (`cookie`, `csrf`, `session`…), which scrubs whole subtrees under such names.
export function sessionStatus({ sessionFile = DEFAULT_SESSION_FILE, accountIdOverride = null } = {}) {
  try {
    const s = JSON.parse(readFileSync(sessionFile, 'utf8'));
    const present = Boolean(s?.cookies?.[SESSION_COOKIE]);
    const expired = s.cookieExpiresAt ? Date.parse(s.cookieExpiresAt) < Date.now() : false;
    return {
      sessionFile,
      present,
      accountId: accountIdOverride ?? s.accountId ?? null,
      accountTitle: s.accountTitle ?? null,
      capturedAt: s.capturedAt ?? null,
      bundle: s.bundle ?? null,
      cookieExpiresAt: s.cookieExpiresAt ?? null,
      cookieDaysRemaining: daysUntil(s.cookieExpiresAt),
      wafExpiresAt: s.wafExpiresAt ?? null,
      wafDaysRemaining: daysUntil(s.wafExpiresAt),
      csrfPresent: Boolean(s.csrf),
      publicKeyCaptured: Boolean(s.publicApiToken),
      state: !present ? 'missing' : expired ? 'expired' : 'ok',
      ...(expired ? { error: { code: CODES.SESSION_EXPIRED, detail: `cookie expired at ${s.cookieExpiresAt}`, remediation: RECONNECT } } : {}),
    };
  } catch (e) {
    return { sessionFile, present: false, state: 'missing', error: { code: CODES.SESSION_MISSING, detail: e.code === 'ENOENT' ? `no session file at ${sessionFile}` : e.message, remediation: RECONNECT } };
  }
}

// Parse `window.__INIT__ = {...};` and `window.STATIC_VERSION = N;` out of an app.manychat.com
// account page. Returns ONLY the fields the session needs; the rest of __INIT__ (Stripe keys,
// the Braze JWT, the public API token) is never kept whole.
export function scrapeInit(html) {
  const sv = html.match(/window\.STATIC_VERSION\s*=\s*["']?(\d+)/);
  const m = html.match(/window\.__INIT__\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!m) return { found: false, bundle: sv?.[1] ?? null };
  let init;
  try { init = JSON.parse(m[1]); } catch { return { found: false, bundle: sv?.[1] ?? null }; }
  const acc = init['app.currentAccount'] ?? {};
  const user = init['app.currentAccountUser'] ?? {};
  return {
    found: true,
    bundle: sv?.[1] ?? null,
    csrf: init['app.csrf_token'] ?? acc.csrf_token ?? null,
    accountId: acc.id ?? null,
    pageId: acc.page_id != null ? String(acc.page_id) : null,
    accountTitle: acc.title ?? null,
    proStatus: acc.pro_status ?? null,
    timezone: acc.timezone ?? null,
    publicApiToken: acc.public_api_access_token || null,
    userId: user.user_id ?? null,
    userRole: user.user_role ?? null,
    channels: {
      instagram: acc.instagram_channel?.status ?? null,
      facebook: acc.fb_channel?.status ?? null,
      whatsapp: acc.whatsapp_channel?.status ?? null,
    },
  };
}

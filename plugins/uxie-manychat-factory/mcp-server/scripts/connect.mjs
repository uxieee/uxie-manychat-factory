#!/usr/bin/env node
// The /uxie-manychat-factory:manychat-connect executor. Reads the app.manychat.com cookies out of the
// chrome-devtools browser profile (mock keychain, no prompt), scrapes the CSRF token + bundle from
// ONE account page fetch, captures the public API key from settings/data when the account has one,
// and writes the session file (0600). Prints CLAIMS about the session — never a cookie, token or key.
//
//   node scripts/connect.mjs [--account fb<pageId>] [--cookies <Cookies db>] [--session-file <path>] [--status]
//
// Exit codes: 0 ok · 2 no ManyChat login in that profile (user must sign in there once) · 1 other.
import { readCookies, DEVTOOLS_COOKIES } from './cookie-store.mjs';
import { DEFAULT_SESSION_FILE, SESSION_COOKIE, WAF_COOKIE, scrapeInit, sessionStatus, writeSession, cookieHeader } from '../core/session.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const sessionFile = opt('--session-file', process.env.MANYCHAT_SESSION_FILE ?? DEFAULT_SESSION_FILE);
const APP = 'https://app.manychat.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

if (args.includes('--status')) {
  console.log(JSON.stringify(sessionStatus({ sessionFile }), null, 2));
  process.exit(0);
}

const dbPath = opt('--cookies', DEVTOOLS_COOKIES);
let jar;
try { jar = readCookies({ dbPath, hostLike: '%manychat.com%' }); }
catch (e) { console.error(`connect: cannot read the cookie store: ${e.message}`); process.exit(1); }
const session = jar.cookies[SESSION_COOKIE];
if (!session) {
  console.error(`connect: no ${SESSION_COOKIE} cookie in ${dbPath} (${jar.rows} manychat rows). Log in at ${APP} in THAT browser profile once (the sign-in CAPTCHA is yours to pass), then re-run.`);
  process.exit(2);
}
if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
  console.error(`connect: the ${SESSION_COOKIE} cookie expired at ${session.expiresAt}. Log in again at ${APP} in that browser profile, then re-run.`);
  process.exit(2);
}
// Only the two cookies the app needs travel to the session file. Analytics cookies stay behind.
const cookies = { [SESSION_COOKIE]: session.value };
if (jar.cookies[WAF_COOKIE]) cookies[WAF_COOKIE] = jar.cookies[WAF_COOKIE].value;
const cookie = cookieHeader(cookies);

// 1. Which account? --account wins; else follow /dashboard's redirect to /fb<id>/dashboard.
//
// NOT the app root: `GET /` intermittently answers 202 with an AWS WAF challenge page for a
// scripted client (measured 2026-09-03) — no redirect, no __INIT__, and it is NOT a dead session,
// so reading it as one would send the user to log in again for nothing. `/dashboard` 302s straight
// to the account with the same cookie, every time.
let accountId = opt('--account');
if (!accountId) {
  const r = await fetch(`${APP}/dashboard`, { headers: { cookie, 'user-agent': UA, accept: 'text/html' }, redirect: 'manual' });
  const loc = r.headers.get('location') ?? '';
  const m = loc.match(/\/(fb\d+)\b/);
  if (m) accountId = m[1];
  else if (r.status === 200) accountId = scrapeInit(await r.text()).accountId ?? null;
  if (!accountId) {
    const login = /\/login|\/signin/i.test(loc);
    console.error(`connect: could not determine the account (/dashboard answered ${r.status}${loc ? ` \u2192 ${loc.replace(/\?.*$/, '')}` : ''}). `
      + (login
        ? `That is the login page: the browser session has lapsed \u2014 sign in again at ${APP} in that browser profile, then re-run.`
        : 'Pass --account fb<pageId> (the prefix in the app URL).'));
    process.exit(2);
  }
}

// 2. One account page fetch → CSRF + bundle + non-secret account facts.
const page = await fetch(`${APP}/${accountId}/cms`, { headers: { cookie, 'user-agent': UA, accept: 'text/html' }, redirect: 'manual' });
if (page.status !== 200) {
  console.error(`connect: ${APP}/${accountId}/cms answered ${page.status}${page.headers.get('location') ? ` → ${page.headers.get('location').replace(/\?.*$/, '')}` : ''}. The session is not valid for that account — log in again in the browser profile, or check --account.`);
  process.exit(2);
}
const info = scrapeInit(await page.text());
if (!info.found || !info.csrf) { console.error('connect: the account page carried no __INIT__ csrf token — the page shape may have changed; keep the HTML for the corpus.'); process.exit(1); }

// 3. Public API key — ONLY the account's real public token, and only if it AUTHENTICATES.
//
// PROVEN WRONG 2026-09-03 and corrected here: `settings/data`'s `settings.api_key` is NOT the
// public API key. It is shape-valid (`<pageId>:<40 chars>`) so it looks right, and it was captured
// here at first — the public rail answered 401 `{"status":"error","message":"Wrong token"}` for it,
// while a deliberately malformed value answers `Wrong format token`. So the shape passes and the
// VALUE is a different credential. The real one is `__INIT__.app.currentAccount.public_api_access_token`
// (null until someone mints it: Settings -> API, or the confirm-gated `create_public_api_key` tool,
// which POSTs /api/token/generate). Never capture a key that has not authenticated: a stored key
// that 401s is worse than no key, because auth_status then reports a credential problem the user
// cannot place.
let publicApiToken = null;
let publicKeyNote = 'the account has no public API token (Settings -> API is empty). Mint one with the create_public_api_key tool (confirm:true) or paste a key into MANYCHAT_API_KEY.';
const raw = info.publicApiToken;
if (raw) {
  const key = raw.includes(':') ? raw : `${info.pageId}:${raw}`;
  const probe = await fetch('https://api.manychat.com/fb/page/getInfo', { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } }).catch(() => null);
  if (probe && probe.status === 200) { publicApiToken = key; publicKeyNote = 'captured from the account page and verified against /fb/page/getInfo'; }
  else publicKeyNote = `the account page carried a public token but api.manychat.com refused it (HTTP ${probe ? probe.status : 'no response'}) — not stored. Paste a current key into MANYCHAT_API_KEY, or mint one with create_public_api_key.`;
}

const out = {
  version: 1,
  accountId: info.accountId ?? accountId,
  pageId: info.pageId ?? accountId.replace(/^fb/, ''),
  accountTitle: info.accountTitle ?? null,
  proStatus: info.proStatus ?? null,
  timezone: info.timezone ?? null,
  channels: info.channels ?? null,
  userId: info.userId ?? null,
  userRole: info.userRole ?? null,
  cookies,
  cookieExpiresAt: session.expiresAt ?? null,
  wafExpiresAt: jar.cookies[WAF_COOKIE]?.expiresAt ?? null,
  csrf: info.csrf,
  bundle: info.bundle ?? null,
  capturedAt: new Date().toISOString(),
  source: `cookie-store:${jar.keySource}:${dbPath}`,
  publicApiToken,
  publicKeyNote,
};
const written = writeSession(out, { sessionFile });
console.log(JSON.stringify({ ok: true, sessionFile: written, ...sessionStatus({ sessionFile: written }), publicKeyNote, note: 'values are never printed; auth_status reports the same claims from inside the server' }, null, 2));

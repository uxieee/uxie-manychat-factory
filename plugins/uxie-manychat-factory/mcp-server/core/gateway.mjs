// The ONE place a ManyChat call happens: cookie + CSRF injection (internal rail), Bearer injection
// (public rail), header discipline, throttling and response normalisation. Every call returns
// { status, json, text, html, waf, headers } and NEVER throws on an HTTP outcome; credential
// problems throw a coded SessionError that tools map to the error contract.
import { cookieHeader, readSession, scrapeInit, writeSession, SessionError, WAF_COOKIE, SESSION_COOKIE } from './session.mjs';
import { CODES, RECONNECT } from './errors.mjs';

export const APP = 'https://app.manychat.com';
export const PUBLIC = 'https://api.manychat.com';
const THROTTLE_MS = 300;
const JITTER_MS = 150;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseBody = (text, contentType) => {
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const html = !json && (/text\/html/i.test(contentType ?? '') || /^\s*<!DOCTYPE html|^\s*<html/i.test(text));
  return { json, html };
};

const encodeQuery = (query) => {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) p.append(k, String(x)); else p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

// INTERNAL RAIL. `accountId` overrides the session's (one login may reach several accounts).
export function makeInternalGateway({ sessionFile, accountId = null, fetchImpl = fetch, sleepImpl = defaultSleep, randomImpl = Math.random, throttleMs = THROTTLE_MS, jitterMs = JITTER_MS, allowCsrfRefresh = true } = {}) {
  let session = readSession({ sessionFile });   // throws SessionError; tools map it
  const acc = () => accountId ?? session.accountId;

  const headers = (isWrite) => {
    const h = {
      cookie: cookieHeader(session.cookies),
      'user-agent': UA,
      accept: 'application/json',
      'x-csrf-token': session.csrf ?? '',
      'x-frontend-bundle': String(session.bundle ?? 'Empty'),
      'x-requested-with': 'XMLHttpRequest',
      'use-new-error-format': 'True',
      referer: `${APP}/${acc()}/cms`,
    };
    if (isWrite) h['content-type'] = 'application/json';
    return h;
  };

  // Re-scrape the CSRF token + bundle with the SAME cookie. Bounded to one attempt per gateway.
  let refreshed = false;
  async function refreshCsrf() {
    if (refreshed || !allowCsrfRefresh) return false;
    refreshed = true;
    const r = await fetchImpl(`${APP}/${acc()}/cms`, { headers: { cookie: cookieHeader(session.cookies), 'user-agent': UA, accept: 'text/html' }, redirect: 'manual' });
    if (r.status !== 200) return false;
    const info = scrapeInit(await r.text());
    if (!info.found || !info.csrf) return false;
    session = { ...session, csrf: info.csrf, bundle: info.bundle ?? session.bundle, csrfRefreshedAt: new Date().toISOString() };
    try { writeSession(session, { sessionFile }); } catch { /* keep in memory */ }
    return true;
  }

  async function once(method, path, body, { query, accountless = false, form = false } = {}) {
    const base = accountless ? APP : `${APP}/${acc()}`;
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}${encodeQuery(query)}`;
    const h = headers(body !== undefined);
    let payload;
    if (body !== undefined) {
      // multipart: hand the FormData straight to fetch and let IT set the boundary — setting
      // content-type ourselves produces a body the server cannot parse.
      if (body instanceof FormData) { delete h['content-type']; payload = body; }
      else if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
      else payload = JSON.stringify(body);
    }
    await sleepImpl(throttleMs + Math.floor(randomImpl() * jitterMs));
    const res = await fetchImpl(url, { method, headers: h, body: payload, redirect: 'manual' });
    const text = await res.text();
    const ct = res.headers.get('content-type');
    const { json, html } = parseBody(text, ct);
    return { status: res.status, json, text: json ? undefined : text.slice(0, 2000), html, waf: Boolean(res.headers.get('x-amzn-waf-action')), headers: { 'content-type': ct, location: res.headers.get('location') } };
  }

  return {
    accountId: acc,
    // The session's captured public key, for the public rail when MANYCHAT_API_KEY is unset.
    capturedPublicKey: () => session.publicApiToken ?? null,
    async call(method, path, body, opts = {}) {
      const r = await once(method, path, body, opts);
      // A CSRF-shaped refusal with a cookie that still opens the app: refresh the token ONCE.
      const csrfShaped = r.status === 401 || (r.status === 405 && r.waf) || (r.html && r.status === 200) || r.status === 302
        || (r.json?.state === false && /csrf/i.test(JSON.stringify(r.json.$errors ?? r.json.errors ?? '')));
      if (csrfShaped && await refreshCsrf()) return once(method, path, body, opts);
      return r;
    },
    // GET the account HTML and return scraped, non-secret facts (used by auth_status).
    async probe() {
      const r = await fetchImpl(`${APP}/${acc()}/cms`, { headers: { cookie: cookieHeader(session.cookies), 'user-agent': UA, accept: 'text/html' }, redirect: 'manual' });
      const text = r.status === 200 ? await r.text() : '';
      const info = r.status === 200 ? scrapeInit(text) : { found: false };
      return { status: r.status, loggedIn: Boolean(info.found && info.csrf), bundle: info.bundle ?? null, accountTitle: info.accountTitle ?? null, proStatus: info.proStatus ?? null, channels: info.channels ?? null, redirect: r.headers.get('location') };
    },
  };
}

// PUBLIC RAIL. Key = MANYCHAT_API_KEY env (`<pageId>:<token>`), else the key captured at connect.
export function makePublicGateway({ sessionFile, apiKey = process.env.MANYCHAT_API_KEY ?? null, fetchImpl = fetch, sleepImpl = defaultSleep, randomImpl = Math.random, throttleMs = THROTTLE_MS, jitterMs = JITTER_MS } = {}) {
  let key = apiKey && apiKey.trim() ? apiKey.trim() : null;
  let source = key ? 'env-MANYCHAT_API_KEY' : null;
  if (!key) {
    try { const s = readSession({ sessionFile }); if (s.publicApiToken) { key = s.publicApiToken; source = 'captured-at-connect'; } } catch { /* no session */ }
  }
  if (!key) {
    throw new SessionError(CODES.API_KEY_MISSING, 'MANYCHAT_API_KEY is unset and the session holds no verified public key',
      'Set MANYCHAT_API_KEY (Settings → API in the ManyChat account; format <pageId>:<token>) on this MCP registration, or re-run manychat-connect on an account that has generated a key.');
  }
  return {
    keySource: source,
    async call(method, path, { query, body } = {}) {
      const url = `${PUBLIC}${path.startsWith('/') ? path : `/${path}`}${encodeQuery(query)}`;
      const h = { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': UA };
      if (body !== undefined) h['content-type'] = 'application/json';
      await sleepImpl(throttleMs + Math.floor(randomImpl() * jitterMs));
      const res = await fetchImpl(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      const { json, html } = parseBody(text, res.headers.get('content-type'));
      return { status: res.status, json, text: json ? undefined : text.slice(0, 2000), html, waf: false };
    },
  };
}

export { SESSION_COOKIE, WAF_COOKIE, RECONNECT };

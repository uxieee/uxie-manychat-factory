// The stable contract every tool returns: { ok, data } or { ok:false, code, detail, remediation }.
// Codes are machine-branchable — agents key on `code`, humans read `detail`, `remediation` names
// the next action. Never put a cookie, a CSRF token or an API key in any field.
//
// Same shape as the uxie-ghl-factory plugin's mcp-internal/core/errors.mjs (a separate repo) so an agent that knows one server
// knows the other. The secret scrub is a superset: it also knows ManyChat's cookie names.

export const CODES = Object.freeze({
  // Internal rail (cookie + CSRF session).
  SESSION_MISSING: 'SESSION_MISSING',     // no session.json — run /uxie-manychat-factory:manychat-connect
  SESSION_EXPIRED: 'SESSION_EXPIRED',     // 401, a WAF challenge, or an HTML body where JSON was expected
  // Public rail (Bearer <pageId>:<token>).
  API_KEY_MISSING: 'API_KEY_MISSING',
  API_KEY_REJECTED: 'API_KEY_REJECTED',
  // Typed refusals.
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  // HTTP 200 with state:false and $errors[] — ManyChat's business-rule envelope. Not a credential
  // problem; the detail carries the server's own message and the offending field.
  BUSINESS_ERROR: 'BUSINESS_ERROR',
  // flow/publish answered {state:false, content_node_errors:{oid: msg}} — one node per call.
  PUBLISH_REJECTED: 'PUBLISH_REJECTED',
  // HTTP 404 HTML: the route does not exist on this account (unknown endpoint or object).
  NOT_FOUND: 'NOT_FOUND',
  // HTTP 500 HTML: ManyChat crashed on the input (e.g. an unknown keyword condition).
  UPSTREAM_500: 'UPSTREAM_500',
  RATE_LIMITED: 'RATE_LIMITED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  ENGINE_ABORT: 'ENGINE_ABORT',
});

const TOKENISH = /\bey[A-Za-z0-9._-]{20,}/g;
const TOKENISH_SCAN = /\bey[A-Za-z0-9._-]{20,}/;
const SECRET_LABEL = '(?:token(?:[-_ ]?id)?|(?:access|refresh|auth|id|oauth|csrf|xsrf|waf)[-_ ]?token|x[-_ ]csrf[-_ ]token|authorization|proxy[-_ ]?authorization|jwt|api[-_ ]?(?:key|secret)|public[-_ ]?api[-_ ]?(?:access[-_ ]?)?token|client[-_ ]?secret|secret[-_ ]?access[-_ ]?key|access[-_ ]?key|private[-_ ]?key|signing[-_ ]?key|password|credentials?|cookies?|set[-_ ]?cookie|session(?:[-_ ]?(?:id|token|key|secret|cookie|credentials?))?|mc_production-main|aws-waf-token|_mc_zd_dashboard_session|publishable[-_ ]?key|stripe[-_ ]?key)';
// The `(?<![/\\w-])` lookbehind keeps a URL PATH from reading as a labelled secret. ManyChat's own
// mint route is `/api/token/generate`, which the label+separator rule scored as `token/<value>` —
// so this server's own remediation text came back as "POST /api/token/ <redacted>", an instruction
// the reader could not follow. A real credential is written `token: X` or `token=X`, never as a
// path segment, so refusing to match after a slash costs nothing and keeps the guidance readable.
const LABELED_SECRET = new RegExp(`(?<![/\\w-])(${SECRET_LABEL})\\s*([:=/])\\s*(?:Bearer\\s+)?([^\\s,;&#/]+)`, 'gi');
const LABELED_SECRET_SCAN = new RegExp(`(?<![/\\w-])${SECRET_LABEL}\\s*[:=/]\\s*(?:Bearer\\s+)?[^\\s,;&#/]+`, 'i');
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._:-]{8,}/gi;
const BEARER_SECRET_SCAN = /\bBearer\s+[A-Za-z0-9._:-]{8,}/i;
// A ManyChat public API key is `<digits>:<64 hex-ish chars>`; a Stripe publishable key `pk_live_…`.
const MC_API_KEY = /\b\d{5,}:[A-Za-z0-9]{40,}\b/g;
const MC_API_KEY_SCAN = /\b\d{5,}:[A-Za-z0-9]{40,}\b/;
const PK_KEY = /\bpk_(?:live|test)_[A-Za-z0-9]{10,}\b/g;
const PK_KEY_SCAN = /\bpk_(?:live|test)_[A-Za-z0-9]{10,}\b/;
const SECRET_KEYS = new Set([
  'token', 'tokenid', 'accesstoken', 'refreshtoken', 'authtoken', 'idtoken', 'oauthtoken',
  'csrftoken', 'xsrftoken', 'xcsrftoken', 'csrf', 'authorization', 'proxyauthorization', 'jwt', 'bearer',
  'apikey', 'apisecret', 'publicapitoken', 'publicapiaccesstoken', 'clientsecret', 'secretaccesskey', 'accesskey', 'privatekey',
  'signingkey', 'password', 'credential', 'credentials', 'cookie', 'cookies', 'setcookie',
  'session', 'sessionid', 'sessiontoken', 'sessionkey', 'sessionsecret', 'sessioncookie',
  'sessioncredential', 'sessioncredentials', 'mcproductionmain', 'awswaftoken', 'wafToken'.toLowerCase(),
  'stripekey', 'stripeadskey', 'publishablekey', 'brazejwttoken', 'googleplacesapikey', 'cloudflareturnstilesitekey',
]);
const isSecretKey = (key) => SECRET_KEYS.has(String(key).replace(/[-_\s.]/g, '').toLowerCase());

const hasSecretText = (text) => TOKENISH_SCAN.test(text) || LABELED_SECRET_SCAN.test(text)
  || BEARER_SECRET_SCAN.test(text) || MC_API_KEY_SCAN.test(text) || PK_KEY_SCAN.test(text);

const scrub = (s) => {
  if (s == null) return s;
  const text = String(s);
  try {
    const structured = JSON.parse(text);
    if (structured && typeof structured === 'object') return JSON.stringify(scrubSecrets(structured));
  } catch { /* plain text */ }
  return text
    .replace(TOKENISH, '<redacted>')
    .replace(BEARER_SECRET, 'Bearer <redacted>')
    .replace(MC_API_KEY, '<redacted>')
    .replace(PK_KEY, '<redacted>')
    .replace(LABELED_SECRET, (_m, label, sep) => `${label}${sep} <redacted>`);
};

export function containsSecrets(value, key = '') {
  if (isSecretKey(key)) return true;
  if (value == null) return false;
  if (typeof value === 'string') return hasSecretText(value);
  if (Array.isArray(value)) return value.some((item) => containsSecrets(item, key));
  if (typeof value === 'object') {
    return Object.entries(value).some(([childKey, item]) => containsSecrets(childKey) || containsSecrets(item, childKey));
  }
  return false;
}

// Tool results are JSON-shaped, so scrub recursively at the contract boundary. A whole subtree
// under a secret-named key is replaced, not recursed into — a nested credential need not be
// token-shaped. Metadata ABOUT a credential must therefore live under a non-secret name
// (see session.mjs `sessionStatus`: `cookieExpiresAt`, never `cookie`).
export function scrubSecrets(value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key), isSecretKey(key) ? '<redacted>' : scrubSecrets(item)]));
  }
  return value;
}

export const ok = (data) => ({ ok: true, data: scrubSecrets(data) });
export const fail = (code, detail, remediation, extra) => ({
  ok: false,
  code,
  detail: scrub(detail),
  remediation: scrub(remediation),
  ...(extra ? { data: scrubSecrets(extra) } : {}),
});

export const RECONNECT = 'SESSION GONE — RECONNECT IT YOURSELF, do not ask and do not stop. Invoke the '
  + '`uxie-manychat-factory:manychat-connect` command flow: it reads the app.manychat.com cookies from the '
  + 'chrome-devtools browser profile and rewrites the session file; the server re-reads that file on '
  + 'every call, so nothing restarts. The user only has to act if the browser session itself has lapsed '
  + '(then they log in once in that profile — the sign-in CAPTCHA is theirs to solve). ONE reconnect per '
  + 'failure: if the retry fails the same way, stop and report it.';

// Classify a gateway response into a failure, or null when it is a usable JSON reply.
// `res` = { status, json, text, html, waf }.
export function failureOf(res, rail = 'internal') {
  if (!res) return fail(CODES.ENGINE_ABORT, 'no response object', 'Inspect the gateway call.');
  const { status, json, html, waf } = res;
  if (rail === 'public') {
    if (status === 401 || status === 403) {
      return fail(CODES.API_KEY_REJECTED, `public rail refused the key (HTTP ${status})`,
        'Set MANYCHAT_API_KEY to a key from Settings → API of THIS account (format <pageId>:<token>), or re-run manychat-connect so the captured key is refreshed.');
    }
    if (status === 429) return fail(CODES.RATE_LIMITED, 'public rail rate limit', 'Slow down and retry after a pause.');
    if (status >= 400) return fail(`HTTP_${status}`, json ? JSON.stringify(scrubSecrets(json)) : String(res.text ?? '').slice(0, 300), 'Inspect detail.');
    if (json && json.status === 'error') return fail(CODES.BUSINESS_ERROR, JSON.stringify(scrubSecrets(json)), 'The public API refused the call — read detail.message.');
    if (!json) return fail(CODES.ENGINE_ABORT, 'public rail returned a non-JSON body', 'Inspect the path; every public endpoint answers JSON.');
    return null;
  }
  if (status === 401 || (status === 405 && waf) || (status === 302) || (html && status === 200)) {
    return fail(CODES.SESSION_EXPIRED,
      status === 401 ? 'app.manychat.com answered 401 (session cookie rejected)'
        : waf ? 'AWS WAF challenge (405 + x-amzn-waf-action) — a human must pass the CAPTCHA in the browser profile'
          : status === 302 ? 'app.manychat.com redirected (to the login page): the session is gone'
            : 'app.manychat.com answered HTML where JSON was expected: the session is gone',
      RECONNECT);
  }
  if (status === 403) return fail(CODES.ACCESS_DENIED, 'HTTP 403', 'Authenticated but refused — a permission or plan rule, not a session problem.');
  if (status === 404) return fail(CODES.NOT_FOUND, 'HTTP 404 (HTML): no such route or object on this account', 'Check the path against search_endpoints / describe_endpoint, and the ids you passed.');
  if (status === 429) return fail(CODES.RATE_LIMITED, json ? JSON.stringify(scrubSecrets(json)) : 'HTTP 429', 'Slow down and retry after a pause.');
  if (status >= 500) return fail(CODES.UPSTREAM_500, `HTTP ${status} (ManyChat crashed on the input — e.g. an unknown enum value)`, 'Do not retry unchanged; check enum values against describe_endpoint / the validation ledger.');
  if (!json) return fail(`HTTP_${status}`, String(res.text ?? '').slice(0, 300), 'Unexpected non-JSON body — inspect detail.');
  if (json.state === false) {
    if (json.content_node_errors && Object.keys(json.content_node_errors).length) {
      return fail(CODES.PUBLISH_REJECTED, 'flow/publish rejected ONE node (the server reports one error per call)',
        'Fix the node named in data.content_node_errors (keyed by caption when known) and publish again; the next error, if any, appears on the next call.',
        { content_node_errors: json.content_node_errors, original_content_node_errors: json.original_content_node_errors ?? null });
    }
    const errs = Array.isArray(json.$errors) && json.$errors.length ? json.$errors : (json.errors ?? []);
    const msgs = errs.map((e) => (typeof e === 'string' ? e : `${e.message}${e.field ? ` (field: ${e.field})` : ''}`));
    return fail(CODES.BUSINESS_ERROR, msgs.join(' | ') || 'state:false with no message', 'ManyChat refused the call by a business rule — read detail; a session re-capture will not help.',
      { errors: errs });
  }
  return null;
}

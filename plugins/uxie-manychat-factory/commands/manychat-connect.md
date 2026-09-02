---
description: Connect the uxie-manychat-mcp server — read the app.manychat.com session out of the chrome-devtools browser profile (the user logs in there once, behind ManyChat's CAPTCHA), write ~/.uxie-manychat-mcp/session.json, install the stable launcher, and register the server for this project. Also the re-connect path on SESSION_EXPIRED / SESSION_MISSING.
---

# /uxie-manychat-factory:manychat-connect

ManyChat's internal rail has **no API token**. The credential is a browser session: the
`mc_production-main` cookie plus a CSRF token the app embeds in every page. Sign-in sits behind an
AWS WAF image CAPTCHA that only a human can pass — so the user logs in **once** in the
chrome-devtools browser profile, and this command harvests the session from that profile's cookie
store. Nothing here asks the user to paste anything. **You never see the cookie or the token**:
`scripts/connect.mjs` writes them straight into a `0600` file and prints claims only.

Why that profile: chrome-devtools-mcp launches Chrome with `--use-mock-keychain`, so its
`Default/Cookies` store decrypts without a macOS Keychain prompt. The Playwright MCP profiles hold
no ManyChat login. A regular Chrome profile would raise a Keychain dialog — supported, but the user
has to click it.

## Steps

1. **Install the stable launcher** (idempotent — refreshes it each run):
   ```bash
   mkdir -p "$HOME/.uxie-manychat-mcp"
   cp "${CLAUDE_PLUGIN_ROOT}/mcp-server/launch.mjs" "$HOME/.uxie-manychat-mcp/launch.mjs"
   ```
   The launcher resolves the newest **installed** plugin build that ships `mcp-server/dist/server.mjs`
   (first shipped in 0.50.0) — a plugin update never breaks the registration path.

2. **Harvest the session** (no browser interaction if the profile is already logged in):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/mcp-server/scripts/connect.mjs"
   ```
   - Exit `0`: prints `{ accountId, accountTitle, bundle, cookieDaysRemaining, csrfPresent, publicKeyCaptured … }`. Done.
   - Exit `2` = **no ManyChat login in that profile.** Open `https://app.manychat.com` with the
     chrome-devtools MCP (`new_page` / `navigate_page`), tell the user to sign in there and pass the
     CAPTCHA, wait for them, then re-run the command. Do not try to solve the CAPTCHA.
   - The account is the one the browser lands on. For another account the same login can reach,
     pass `--account fb<pageId>` (the prefix in the app URL). One session file holds one account;
     a registration can pin a different one with `MANYCHAT_ACCOUNT_ID`.
   - `--session-file <path>` writes elsewhere (per-project sessions); set `MANYCHAT_SESSION_FILE`
     on the registration to match.

3. **Register the server for THIS project** (skip if `claude mcp list` already shows it):
   ```bash
   claude mcp add --transport stdio --scope local \
     -e MANYCHAT_SESSION_FILE="$HOME/.uxie-manychat-mcp/session.json" \
     uxie-manychat-mcp \
     -- node "$HOME/.uxie-manychat-mcp/launch.mjs"
   ```
   Add `-e MANYCHAT_API_KEY="<pageId>:<token>"` only if the user hands you a public API key from
   Settings → API and the account has none captured (`publicKeyCaptured:false`). Never print it.
   `claude mcp add` rewrites the whole entry — on an existing registration edit `~/.claude.json`
   additively instead. First connection in a folder shows a one-time workspace-trust prompt.

   **Codex** has no slash commands: add the same server to `~/.codex/config.toml`:
   ```toml
   [mcp_servers.uxie-manychat-mcp]
   command = "node"
   args = ["/Users/<you>/.uxie-manychat-mcp/launch.mjs"]
   env = { MANYCHAT_SESSION_FILE = "/Users/<you>/.uxie-manychat-mcp/session.json" }
   ```

4. **Verify.** Call `auth_status`. Expect `internal.state:"ok"` with `live.loggedIn:true`, and
   `public.state` `ok` (key present and accepted) or `missing` (no key — the public-rail tools
   return `API_KEY_MISSING`; everything on the internal rail still works). A brand-new registration
   may need a reload before the tools appear.

## Re-connect (SESSION_EXPIRED / SESSION_MISSING)

Run step 2 again. If the browser profile's cookie is still alive it is silent; the session cookie
lasts **30 days** from login and the CSRF token is re-scraped by the server itself when it can. Only
when the browser session has lapsed does the user need to sign in again (step 2's exit `2` path).
**ONE re-connect per failure** — if the retried call fails the same way, stop and report.

## Session lifetime (measured 2026-09-03)

| Cookie | Expiry | Needed for API calls from Node? |
|---|---|---|
| `mc_production-main` | login + 30 days | yes |
| `aws-waf-token` | ~4 days | **no** (differential: identical results with and without) — only the sign-in page's WAF wants it |

The CSRF token comes from `window.__INIT__['app.csrf_token']` on any account page and is tied to
the session; the server refreshes it with the same cookie on the first CSRF-shaped refusal.

## Fallback: in-page execution

If Node-side calls are refused but a logged-in `app.manychat.com` tab is open in chrome-devtools,
the same requests run in-page via `evaluate_script` with `fetch(path, {credentials:'include'})` and
the headers from `manychat-internal-api-research/scripts/build-cj-wizard.js`. That is the manual
path the research used; it is not the default and the tools do not do it for you.

## Credential rule

Never print, log or paste a cookie value, the CSRF token, or an API key (`<pageId>:<64 chars>`).
The session file is `0600`; `auth_status` and `connect.mjs --status` report claims only.

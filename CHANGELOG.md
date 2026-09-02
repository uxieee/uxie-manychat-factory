# Changelog

All notable changes to the `uxie-manychat-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code) and
`.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`.

## [0.1.0] — 2026-09-03

First release. A ManyChat MCP server, a session-capture command, and an automation skill.

### Added

- **`uxie-manychat-mcp` — 32 stdio tools over two rails.** Internal
  (`app.manychat.com`, the builder's own endpoints): `list_flows`, `get_flow`, `create_flow`,
  `set_flow_draft`, `patch_flow_draft`, `check_flow`, `publish_flow`, `discard_flow_changes`,
  `rename_flow`, `layout_flow`, `build_flow`, `list_triggers`, `create_comment_trigger`,
  `create_dm_keyword`, `set_trigger_status`, tags/fields/bot-fields CRUD-minus-delete,
  `create_public_api_key`. Public (`api.manychat.com`): `get_contact`, `find_contact`,
  `tag_contact`, `set_contact_field`, `send_flow`. Plus `auth_status`, `search_endpoints`,
  `describe_endpoint`, `raw_request`.
- **Session credential model.** ManyChat has no internal-API token and its sign-in sits behind an
  AWS WAF CAPTCHA, so `scripts/connect.mjs` decrypts the chrome-devtools browser profile's cookie
  store (mock keychain, no macOS prompt), scrapes the CSRF token and bundle from one account page,
  and writes `~/.uxie-manychat-mcp/session.json` at `0600`. Values are never printed. The gateway
  re-scrapes the CSRF token once on a CSRF-shaped refusal and otherwise returns a typed
  `SESSION_EXPIRED`; it never loops.
- **The validation ledger** (`core/rules.mjs`, 65 rules) ported once from the research corpus and
  shared by every write tool. Each rule records whether the **server** enforces it (with its exact
  string) or only the **builder UI** does (which the API accepts). `publish_flow` runs it first, so
  every server-enforced problem is reported at once, keyed by node caption — ManyChat itself returns
  only one per call.
- **`build_flow`**, a compiler from a caption-addressed spec: fresh `_oid`s per node, edges by
  caption, tag/field/bot-field **names** resolved to ids, `{{field:Name}}` / `{{bot:Name}}` tokens
  rewritten, and the comment-reply root rules enforced before anything is sent.
- **`layout_flow`**, a BFS canvas layout that republishes the same nodes with new coordinates,
  stripping the server-added stat keys that otherwise make a republish fail, and refusing flows
  carrying duplicate `_oid`s rather than corrupting them further.
- **A 922-row endpoint catalogue** behind `search_endpoints` / `describe_endpoint`: 888 internal
  requests mined from ManyChat's public source maps plus the 34 documented public operations, with
  proven-live marks, covering tools and per-row traps from a hand-maintained overlay.
- **`manychat-automation-specialist` skill** — the comment-reply rules, tool routing, the spec
  format with a worked lead-capture example, and the generated validation-ledger reference.
- **Repo gates**: `scripts/check-privacy.mjs` (ManyChat identifier shapes — flow namespaces, account
  prefixes, API keys — plus hashed client names) and `scripts/check-manifest-parity.mjs`.

### Corrections to the research corpus, proven live on 2026-09-03

- `settings/data`'s `settings.api_key` is **not** the public API key. It is shape-valid and the
  public rail answers `401 Wrong token` for it, while a malformed value answers `Wrong format
  token`. The real key is `__INIT__.app.currentAccount.public_api_access_token`, `null` until minted
  via `POST /api/token/generate`. The connect flow now stores a key only after it authenticates.
- The internal rail works from **Node with the session cookie alone** — the `aws-waf-token` cookie
  is not needed off the sign-in page (differential: identical results with and without). In-page
  execution through a logged-in tab is now a documented fallback, not the only path.
- The session cookie lasts **30 days** from login (the WAF cookie ~4 days).
- `GET /` on the app intermittently answers **202 with a WAF challenge page** to a scripted client.
  That is not a dead session; `/dashboard` redirects to the account cleanly and is what connect uses.

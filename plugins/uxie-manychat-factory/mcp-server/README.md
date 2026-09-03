# uxie-manychat-mcp

Local stdio MCP server for **ManyChat**, shipped inside the `uxie-manychat-factory` plugin. Two
rails in one server: the **internal rail** (`app.manychat.com`, the builder's own endpoints — flows,
nodes, publish, canvas layout, comment triggers, DM keywords, tags, fields, bot fields) and the
**public rail** (`api.manychat.com`, the 34 documented operations — contacts, tags, fields,
sending). No official ManyChat MCP exists and the public API cannot build flows; this server can.

Shapes come from ManyChat's own front-end: 12,197 TypeScript sources recovered from its public
source maps (bundle 490, 2026-09-02) and 20 live probe sessions, held in the
`manychat-internal-api-research` corpus (the source of truth for every wire shape; when a tool
proves the corpus wrong, the corpus page is corrected in the same change).

**Status: 0.3.0 — 35 tools, both rails LIVE-PROVEN 2026-09-03 through a real stdio session on the
committed bundle against a client account.** Ledger at the bottom.

## Credential model

### Internal rail — a browser session, harvested, never typed

ManyChat has no token for its internal API. The credential is the `mc_production-main` session
cookie plus a CSRF token every account page embeds in `window.__INIT__`. Sign-in sits behind an AWS
WAF image CAPTCHA that only a human passes, so:

- The user signs in **once** in the chrome-devtools MCP browser profile
  (`~/.cache/chrome-devtools-mcp/chrome-profile`).
- `scripts/connect.mjs` (behind `/uxie-manychat-factory:manychat-connect`) decrypts that profile's
  `Default/Cookies` store — Chrome runs there with `--use-mock-keychain`, so the key derives from
  the literal `mock_password` and **no macOS Keychain prompt appears** — fetches one account page
  for the CSRF token and bundle version, and writes `~/.uxie-manychat-mcp/session.json` (`0600`).
  Values are never printed; the script and `auth_status` report claims only.
- Every call sends `cookie`, `X-Csrf-Token`, `X-Frontend-Bundle`, `X-Requested-With: XMLHttpRequest`,
  `Use-New-Error-Format: True`. The file is re-read on every call, so a reconnect needs no restart.
- **Measured 2026-09-03:** the session cookie expires **30 days** after login; the `aws-waf-token`
  cookie expires in ~4 days but is **not needed** for API calls from Node (differential: identical
  results with and without). The app root `GET /` intermittently answers **202 with a WAF challenge
  page** to a scripted client — that is not a dead session; `/dashboard` redirects cleanly.
- On a CSRF-shaped refusal the gateway re-scrapes the token with the same cookie **once** and retries
  once. A 401, a 405 carrying `x-amzn-waf-action`, a redirect, or an HTML body where JSON was
  expected returns `SESSION_EXPIRED` with a remediation aimed at the agent; it never loops.
- Fallback: the same requests run in-page through chrome-devtools `evaluate_script` from a logged-in
  tab (the path the research used). Documented in the connect command; not what the tools do.

### Public rail — `<pageId>:<token>`

`MANYCHAT_API_KEY` on the registration wins; otherwise the key stored in the session file. The
connect flow stores a key **only after it authenticates** against `/fb/page/getInfo`:

- `__INIT__.app.currentAccount.public_api_access_token` is the real key and is `null` until one is
  minted (Settings → API).
- `settings/data`'s `settings.api_key` is **not** the public key: it is shape-valid
  (`<pageId>:<40 chars>`) and the public rail answers `401 Wrong token` for it (proven by
  differential 2026-09-03; a malformed value answers `Wrong format token`).
- `create_public_api_key` (confirm-gated) mints one through the builder's own
  `POST /api/token/generate`, verifies it, and stores it. It refuses when a key already exists unless
  `replaceExisting:true`, because ManyChat replaces the old key and anything using it stops working.

## Registration

The server is a **self-contained bundle** (`dist/server.mjs`, deps included): it boots with just
`node`. Register it per project (Claude Code) or once (Codex) pointing at the stable launcher
`~/.uxie-manychat-mcp/launch.mjs`, which resolves the newest installed plugin build under
`~/.claude/plugins/cache/<marketplace>/uxie-manychat-factory/<version>/mcp-server/dist/server.mjs`:

```bash
claude mcp add --transport stdio --scope local \
  -e MANYCHAT_SESSION_FILE="$HOME/.uxie-manychat-mcp/session.json" \
  uxie-manychat-mcp -- node "$HOME/.uxie-manychat-mcp/launch.mjs"
```

```toml
# ~/.codex/config.toml
[mcp_servers.uxie-manychat-mcp]
command = "node"
args = ["/Users/<you>/.uxie-manychat-mcp/launch.mjs"]
env = { MANYCHAT_SESSION_FILE = "/Users/<you>/.uxie-manychat-mcp/session.json" }
```

Env: `MANYCHAT_SESSION_FILE` (default `~/.uxie-manychat-mcp/session.json`), `MANYCHAT_API_KEY`
(optional), `MANYCHAT_ACCOUNT_ID` (optional `fb<pageId>` pin when one login reaches several
accounts; every tool also takes `accountId`).

## Error contract

Every tool returns `{ ok:true, data }` or `{ ok:false, code, detail, remediation, data? }`. Codes:
`SESSION_MISSING` `SESSION_EXPIRED` `API_KEY_MISSING` `API_KEY_REJECTED` `CONFIRM_REQUIRED`
`VALIDATION_FAILED` `BUSINESS_ERROR` (HTTP 200 `state:false` with ManyChat's own message and field)
`PUBLISH_REJECTED` (`content_node_errors`, one node per call, re-keyed by caption) `NOT_FOUND` (404
HTML) `UPSTREAM_500` (ManyChat crashed on the input) `RATE_LIMITED` `ACCESS_DENIED` `ENGINE_ABORT`.
Results and errors are scrubbed for cookies, CSRF tokens, Bearer/API keys and Stripe keys at the
contract boundary; a tool argument carrying a credential-shaped value is refused without echo.

## Tools (34)

| Tool | Does | Risk |
|---|---|---|
| `auth_status` | both rails, claims only, one live probe each | read |
| `list_flows` `get_flow` `list_triggers` `list_tags` `list_fields` `list_bot_fields` | reads; `get_flow` returns nodes with edges by caption, draft, triggers, and `batchForResend` | read |
| `check_flow` | the validation ledger over a batch or a flow, nothing sent; `rules:true` returns the table | read |
| `search_endpoints` `describe_endpoint` | 922-row catalogue (888 internal from the source maps, 34 public), proven-live marks, covering tool, trap | read |
| `create_flow` `rename_flow` `discard_flow_changes` | one call + read-back | write |
| `set_flow_draft` (replace) `patch_flow_draft` (merge) | ledger first, read back `has_unpublished_changes` | write |
| `publish_flow` | ledger first (every server rule at once, by caption), upsert publish, read-back `verify` | write |
| `build_flow` | caption-addressed spec → compile → ledger → create → publish/draft → read back. Message, actions, condition (with `all`/`any` groups), delay, split, goto, AI and note nodes; text, question, delay, attachment, cards and dynamic blocks; every ManyChat action type | write |
| `edit_flow` | caption-addressed OPS on a published flow (set_text, add/set/remove_button, set_next, add_node, remove_node with rewire, set_conditions, …) → same ledger → upsert publish → read back | write |
| `upload_attachment` | store an image/video/file/gif and return the object a block or card image needs | write |
| `layout_flow` | BFS canvas layout, republish with coordinates only; refuses duplicate-`_oid` flows | write |
| `create_comment_trigger` | createWidget → setFlow → setWidget → draft → loadWidget; `post_covered_area` required; returns the stray "Opt-In Message" flow it mints | write (draft) |
| `create_dm_keyword` | createDraft → get; refuses system keywords, >12 keywords, unknown conditions | write (draft) |
| `create_tag` `create_field` `create_bot_field` `set_bot_field_value` | create + read-back | write |
| `create_public_api_key` | mint the public key (refuses if one exists) | write, confirm |
| `get_contact` `find_contact` `tag_contact` `set_contact_field` | public rail, read-back on writes | read / write |
| `set_trigger_status` | widget draft/active/archived, keyword draft/live; dry run without `confirm` | **activate**, confirm |
| `send_flow` | public rail, messages a real contact | **activate**, confirm |
| `raw_request` | either rail, auth injected, non-GET needs `confirm` | escape hatch |

Nothing deletes. `set_trigger_status` refuses `trash`/`deleted`.

## The validation ledger

`core/rules.mjs` is the one port of ManyChat's own publish rules (91 rules). Each finding carries
`layer` (S server / C builder / S+C), `serverEnforced`, the server's exact string and the builder's.

**Since 0.2.0 any rule with a known string BLOCKS.** A server rule would fail the publish anyway; a
builder-only rule produces a node ManyChat marks broken and a channel may refuse at send time — its
Instagram text cap of 1000 is Meta's own DM limit, which the API stores happily. `allowUiWarnings:
true` demotes the builder-only rows to warnings, never the server ones. Rules never probed on the
server warn unless the tool refuses them by policy (an action with no subject, a trigger the UI could
not activate). Full table:
`skills/manychat-automation-specialist/references/validation-ledger.md`.

## Live-proof ledger — 2026-09-03, client account, real stdio session on `dist/server.mjs`

EXECUTED → OBSERVED, in order:

1. `connect.mjs` → session written from the mock-keychain cookie store; account title and bundle
   scraped; cookie expiry 30 days out. `auth_status` → internal `ok`, live probe `loggedIn:true`.
2. `list_flows` 17 rows · `get_flow` on the account's published core flow → 10 nodes, root, triggers,
   draft null · `list_triggers` 10 widgets + 9 keywords · tags 11 · fields 5 · bot fields 6.
3. `check_flow` on that live flow → 0 blocking, 1 client-only warning (a 23-char quick-reply
   caption) — a real finding on real data.
4. `build_flow` with a deliberately broken spec → `VALIDATION_FAILED` listing **8** server rules at
   once with the server's strings; nothing sent.
5. `build_flow` with a 10-node spec (private-reply root, actions, condition, email question,
   delay, split, quick replies, note, `{{field:…}}` token) → flow created, published,
   `verify.matches:true`, every edge resolved by caption.
6. `layout_flow` → 7 columns, note orphaned as expected, republished, verify true.
7. `create_comment_trigger` → widget in **draft**, `verify` all true, stray Opt-In flow named in
   `leftovers` · `create_dm_keyword` → rule in **draft**, bound, rules match.
8. **Differential proof of the ledger:** twelve violations sent raw to `flow/publish` through
   `raw_request` (no validation) → twelve `content_node_errors` strings, **12/12 identical** to the
   ledger's; the flow unchanged afterwards (10 nodes, no draft) — a refused publish writes nothing.
9. Public rail: the captured `settings.api_key` → `401 Wrong token` (corpus corrected);
   `create_public_api_key` without `confirm` → `CONFIRM_REQUIRED`; with `confirm` → minted, verified,
   stored; again → refused (key exists). `find_contact` by name → 1 · `get_contact` ·
   `tag_contact` → read-back `present:true` · `set_contact_field` → read-back `applied:true` ·
   `send_flow` without `confirm` → refused, nothing sent.
10. `set_trigger_status` widget→`active` without `confirm` → `CONFIRM_REQUIRED` with the dry run
    naming the keyword and area; with `confirm` → `active`, verified; back to `draft` on the next
    call, verified. Same for the keyword (`live` → `draft`). Final state: nothing active.

**0.2.0 additions, live-proven the same day on the same account:** a second probe flow carrying
cards, an uploaded image, a dynamic block, nested `all`/`any` condition groups and an AI node —
published, `verify.matches:true`, 15 nodes; `edit_flow` applied five ops (text, a new node, a
rewired next step, a new button, a rename), verified, and refused a bad edit naming all three
problems at once with nothing sent; `upload_attachment` stored a PNG and it published both as a
block and as a card image. Two rules were **discovered by publishing** and are now in the ledger:
`Attachment without caid` (ManyChat will not send an image it did not store — every URL shape is
refused, including the `external_image` form its own exporter emits) and a dynamic block's `payload`
having to be a JSON string rather than an object. One more trap, found the same way:
`/content/upload` wants the file under the field name `0`, not `file` — sending `file` returns
`Uploaded file is not an image`, which reads like a bad file and is a field-name mismatch.

Left in place on the account, named, never deleted: the probe flows `TEST-CAP-MCP-01` and
`TEST-CAP-MCP-02` (the second carries orphan `N` nodes from the shape differentials), the draft
comment widget and DM keyword, the stray Opt-In Message flow, an uploaded probe image, one tag and
one field value on the operator's own test contact, and the minted public API key.

## Development

```bash
npm install          # once
npm test             # privacy + manifest parity gates, then the suite (bundle sync included)
npm run manifest     # capability-manifest.json from TOOLS
npm run catalog      # catalog/manychat-endpoints.json from the source catalogue + overlay + manifest
npm run build        # dist/server.mjs (commit it)
```

`catalog/endpoint-overlay.json` is hand-maintained (proven-live marks, summaries, traps); the build
never writes it and names any key that no longer matches a source row.

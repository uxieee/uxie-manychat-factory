# Changelog

All notable changes to the `uxie-manychat-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code) and
`.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`.

## [0.3.0] — 2026-09-03

Closes the three gaps 0.2.0 shipped with — video, file and gif uploads were never sent, and
`add_to_sequence` had no sequence to point at — and fixes what proving them exposed.

### Verified live (2026-09-03, on a real Instagram account)

- **Video, gif and file uploads all work**, uploaded and published in an Instagram node and read
  back. A video and a PDF both come back `type: "file"`; that is correct, not a failure — the
  builder's `Batch/Parser.js` re-derives Video from `data.mime` starting `video/` and PDF from
  `application/pdf`. `file` + the right mime **is** the video block.
- **`add_to_sequence` / `remove_from_sequence`**, against a real sequence created for the purpose.
  The `sequence_id` survives the round-trip exactly. A bogus id is refused by the SERVER:
  `flow/publish` answers **`Wrong sequence`**.

### Fixed

- **An Instagram PDF was uploaded broken.** The builder puts a `dest` field on the multipart,
  decided by (node type, attachment type) — `getAttachmentDestination` in `AttachmentBlock.tsx`,
  sent by `attachmentActions.js`. The tool never sent it. Proven by differential (same bytes, same
  field name, only `dest` varies): `POST /content/upload` returns the `preview` object **only** with
  `dest=pdf`, and without it the builder logs `PdfPreviewNotReceivedError` for a PDF on an Instagram
  node. `upload_attachment` now takes `node` and derives the whole `dest` matrix (`mms`, `tg`,
  `tg_file`, `tg_video_note`, `wa`, `wa_file`, `wa_document`, `pdf`).
- **`upload_attachment`'s description contradicted the engine.** It told callers to skip the upload
  and use `{image_url}` for an image reachable by URL — which the compiler refuses and ManyChat
  answers `Attachment without caid`. The sentence is gone.
- **Two of the seven attachment types were unreachable.** The builder's enum is file, audio, video,
  image, gif, remote_image, pdf; the tool accepted four. `pdf` and `audio` are now accepted and
  mapped to their wire form (pdf → `file`), which is also how the exporter does it.

### Added

- **`list_sequences`** — the account's sequences with ids, message and subscriber counts. There was
  no way to find a `sequence_id` without `raw_request`.
- **A sequence may be addressed by NAME** in a spec: `{add_to_sequence: "Welcome drip"}` resolves
  through `list_sequences` at compile time, the way tags and fields already do.
- **`upload_attachment` enforces the account's own `app.attachment_policy`** (from
  `GET /dashboard/getData`) before sending: extension and `max_bytes` per channel per file type.
  Instagram's `file` bucket is **pdf only** — an mp4 uploaded as a file is now refused with the
  account's own allowed list, rather than stored as an unsendable attachment.
- **2 ledger rules (93 total)**: `ACTION_SEQUENCE_WRONG` (server: `Wrong sequence`) and
  `IG_PDF_NEEDS_PREVIEW` (refuses a preview-less PDF on an Instagram node).

## [0.2.0] — 2026-09-03

Reliability pass. The ledger now refuses anything it knows is wrong, the compiler covers the rest of
ManyChat's surface, and editing a published flow no longer means hand-writing node JSON.

### Changed

- **The ledger blocks on every rule whose string is known**, not only the server-enforced ones. A
  builder-only rule still breaks the flow for a human, and sometimes at send time: ManyChat's
  Instagram text cap of 1000 characters is Meta's own DM limit, and the API stores 1500 without
  complaint. `allowUiWarnings: true` demotes those rows to warnings — never the server ones — as an
  explicit per-call choice. Proven live: a 23-character quick-reply caption on an existing flow,
  previously an advisory note, is now a refusal.

### Added

- **`edit_flow`** — caption-addressed operations on a published flow: `set_text`, `set_caption`,
  `set_next`, `set_private_reply`, `add`/`set`/`remove_button`, `set_quick_replies`,
  `add`/`replace`/`remove_block`, `set`/`add`/`remove_action`, `set_conditions`, `set_delay`,
  `set_split`, `set_goto`, `set_prompt`, `add_node`, `remove_node`, `set_root`. Every op names its
  node by caption and fails if it does not exist or is the wrong type; all problems are reported at
  once and nothing is sent; `remove_node` refuses to orphan an edge unless told where to rewire it,
  never removes the root, and marks `removed:true` rather than dropping the node. The result runs
  the same ledger, publishes as an upsert and reads back. `relayout:true` re-runs the canvas layout.
- **`upload_attachment`** — store an image, video, file or gif and get back the object a block or a
  card image needs.
- **Condition groups.** `if: {all:[…]}`, `if: {any:[…]}` and one level of nesting
  (`all:[{any:[a,b]}, c]` → `(a OR b) AND c`), which is exactly what ManyChat's two-level filter can
  express. A third level is refused by name rather than flattened into a different meaning.
- **Blocks**: attachment (image/video/file/gif), cards with per-card image, subtitle, tap action and
  buttons, and dynamic (external content) blocks.
- **The AI node** (`type: "ai"`), published and read back live.
- **Every remaining action type** as a typed shorthand — sequences, conversation open/close/assign,
  opt-in and opt-out per channel, pause and resume, custom events, main menu, and the nine
  integrations — each carrying the required key ManyChat's own validator demands, with `raw` still
  available for anything unlisted.
- **26 new ledger rules** (91 total) covering those shapes: the Instagram block allowlist, card and
  dynamic requirements, and every action's required subject.

### Discovered by publishing, and now enforced

- **ManyChat will not send an image it did not store.** A URL image is refused with
  `Attachment without caid` in every shape tried — including the `external_image` form ManyChat's
  own exporter emits, a `{type,url}` object, and a bare URL. The fix is `upload_attachment` first;
  the compiler now refuses a URL image at compile time and names the tool.
- **A dynamic block's `payload` must be a JSON string**, not an object; an object returns
  `Something went wrong`. Same rule `external_request` already followed.
- **`/content/upload` wants the file under the field name `0`**, not `file`. Sending `file` returns
  `Uploaded file is not an image`, which reads like a bad file and is a field-name mismatch.

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

# Changelog

All notable changes to the `uxie-manychat-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code) and
`.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`.

## [0.6.0] — 2026-09-04

Enforcement. 0.4.0 and 0.5.0 wrote the rules down; testing showed documentation has a ceiling —
agents that skim a skill follow the mechanics ManyChat refuses and ignore everything else. So the
five rules that matter most now run in the compiler, where a caller reads them whether or not they
opened a reference.

### Added

- **`DELAY_EXCEEDS_MESSAGING_WINDOW`** — `validateBatch` walks every path from the flow root
  summing `smart_delay` durations and reports at the node that first crosses 24 hours, with the
  computed total (`48h from the contact's last interaction`). The graph walk is a deep scan for
  `_content_oid`, so it covers buttons, quick replies, condition targets, split variants and
  question success/timeout edges without enumerating node types, and it terminates on cycles.
  **Warns, does not block** — a contact who re-engages before the delay fires reopens the window,
  so the branch is dead for most contacts, not all.
- **`FIELD_SHADOWS_SYSTEM_FIELD`** — `create_field` refuses **before calling the API** when the
  caption names something ManyChat already holds as a system field. Matched on the whole
  normalised caption against a synonym table, so `Work Email Verified At` is a legitimate custom
  field and `Email Address` is not. The only new rule that blocks: it has no legitimate use and
  exactly one right fix.
- **`TAG_NAME_NOT_NAMESPACED`**, **`OBJECT_NOT_IN_FOLDER`**, **`OBJECT_NAME_EMOJI`** — warnings
  carried on the result of `create_tag`, `create_field` and `create_bot_field` under a
  `conventions` key. The tag finding carries a suggested name (`Lead: PDF Requested` →
  `lead:pdf-requested`).
- **`validateObjectName({ kind, caption, path })`** — exported from `core/rules.mjs`, same result
  shape as `validateBatch`.

### Verified

17 new tests in `test/conventions.test.mjs`, written before the implementation and watched fail;
76/76 green overall. Then live: `create_field` with `Email Address` returned `VALIDATION_FAILED`
and made no API call, and `build_flow` with `dryRun:true` on a two-day delay returned the warning
keyed to the right caption with the right computed total.

### Why this exists

Four agents were given an approved design and asked to name the objects they would create. Every
one produced the `private_reply` root, held URLs in bot fields, uploaded attachments and left
triggers in draft — rules framed as *ManyChat will refuse this*. **None followed the naming
conventions**, and two created a custom `Email Address` field beside the system one. Hoisting the
conventions from the reference into SKILL.md changed nothing. The rules that bind are the ones with
a consequence attached, so these now have one.

## [0.5.0] — 2026-09-04

House conventions. 0.4.0 said what ManyChat refuses; this says what a build should *look like* —
the shape, the names, where data lives, and the gates a design passes through. Modelled on the
operator's GHL conventions so the two platforms read the same way.

### Added

- **`references/system-conventions.md`** — recon before you answer anything (`list_triggers` is
  the one people skip and the one that bites); the one-layer-at-a-time planning loop with a gate
  between each; hard rules for structure and copy; the five-folder account layout; naming for
  flows, tags, fields, bot fields and triggers; the tags/fields/bot-fields decision rule;
  Modular Flow Design; ManyChat-only vs handoff builds; trigger discipline.
- **`references/prebuild-doc-spec.md`** — the single self-contained HTML approval document.
  File mechanics are deliberately identical to the operator's GHL pre-build doc (sidebar,
  three-place theme tokens, mermaid re-render on theme change, click-to-enlarge). The sections
  differ: an account audit first, then what the platform refuses, entry map, flow map, per-flow
  cards, data, copy appendix.

### Decisions locked

- **Flows: folders plus descriptive names**, no numbering. `Entry · WIZARD`,
  `Core · Lead Capture & Deliver`. ManyChat is entry points plus shared cores, not one journey,
  so numbering order is arbitrary and every new keyword would force a renumber.
- **Tags: `namespace:value`, lowercase.** ManyChat does **not** normalise tag case on write —
  unlike GHL, which does — so `Interest - Marriage` and `interest - marriage` coexist happily
  and both will exist within a month. Lowercase namespacing removes the ambiguity.
- **Five folders on every account**: `Entry`, `Core`, `Utility`, `Archive`, `TEST`. Verified
  implementable — `create_flow`, `create_field`, `create_bot_field` and `build_flow` all take a
  `path`, and folders exist for tags and fields too, not just flows.
- **ManyChat-only builds are first-class.** A build declares its shape: everything finishes in
  the first conversation, or a handoff posts the lead to a CRM. Neither is the degraded case.

### Research note

The conventions are derived, not copied. A search of the practitioner layer — agency partners,
Chatimize, ManyChat Educator Partners, the community forum, ManyChat's own courses — found no
published standard for account-scale naming, tag namespacing, or field taxonomy. What it did
confirm: ManyChat officially endorses modular flows via the Start Automation step and Go-To
("break down larger, more complex ones into smaller, reusable automations"), folders are the
intended organisational primitive, and ManyChat itself acknowledges dashboards get messy past a
few flows without a convention. Everything else here comes from the proven mechanics in
`delivery-rules.md` / `validation-ledger.md` and from the operator's existing GHL conventions.

### Verified — and a known limit

Tested with four fresh agents given an approved design and asked to name the objects they would
create. **The hard mechanics land reliably**: every agent produced the `private_reply` single-block
root, held URLs in bot fields, uploaded attachments rather than linking them, left triggers in
draft, and reported the `leftovers` flow. One correctly refused to add a boolean field beside a tag
that already carried the state — the data decision rule working as intended.

**The naming conventions did not land: 0 of 4.** Tags came back as `IG-START-Requested`,
`Lead: PDF Requested`, `IG Comment - COURSE`; folders were invented per-campaign; flows were named
descriptively but not `Entry · <KEYWORD>`; two agents created a custom `Email Address` field beside
ManyChat's system `email`; two duplicated capture logic across entry flows instead of routing to a
shared core. Hoisting the naming table from the reference into SKILL.md did not change the result.

The split is informative. Every rule that landed is framed as *ManyChat will refuse this* — an
external consequence. Every rule that did not is a convention with no enforcement behind it, and a
generically-trained agent falls back on generic naming. **The durable fix is the same one the delay
rule needs: enforcement in the compiler.** Hook points identified — `create_tag` can lint a caption
against `namespace:value`, `create_field` can refuse a caption that collides with a system field
(the `fieldsByName` map is already built in `core/tools.mjs`), and `create_flow` / `build_flow` can
warn on a missing or non-standard `path`. Tracked, not yet built.

Until then: these conventions bind an agent that reads them, and they are the specification the
enforcement will be written from.

### Superseded

- `references/account-architecture.md` — folded into `system-conventions.md`. Kept with a
  banner so no link breaks; not extended.

## [0.4.0] — 2026-09-04

Adds the layer the plugin was missing: the rules that decide whether a flow is **delivered**, not
just whether it publishes. The validation ledger answers *"will this publish?"*. Everything in this
release answers *"will a human ever receive it?"* — and those failures are silent, because ManyChat
returns 200 and then declines to send.

### Added

- **`references/delivery-rules.md`** — Meta's messaging windows (24h automated / 7d manual), the
  Human Agent tag and why it is not an escape hatch, Instagram DM Lists and the check that proves
  whether an account has any (`GET /notificationReason/list`), the 2026 cap of **1 automated DM per
  contact per 24h across all comment/story triggers**, rate ceilings, trigger precedence, keyword
  selection, the compliance floor, and a four-call pre-build audit. Claims are marked **[MC]**
  (ManyChat's own docs), **[PROVEN]** (verified live by this plugin), or **[3P]** (third-party 2026
  reporting, corroborated across two independent sources).
- **`references/account-architecture.md`** — the conventions that keep an account legible when
  ManyChat gives you no version control: hub-and-spoke entry/core flows, bot fields as the
  configuration layer, the tags-vs-custom-fields dividing line, a naming table, why follow-up lives
  in the CRM and not here, the never-delete rule, and what a handover must state.
- **SKILL.md — "Before you design: say what the platform will not do"**, a table of six requests
  that cannot be built as asked, what actually happens, and what to design instead. Placed ahead of
  everything else because a design containing one of them is wrong regardless of the rest.

### Fixed

- **SKILL.md said the API stores "a 1500-character Instagram message".** Instagram's DM limit is
  **1000**; the server's own cap is 2000. A test agent read the old wording and reported a
  "1500-character IG cap" back to the user as fact. Now states both numbers explicitly.
- `list_triggers` promoted into the mandatory recon step. It is how you find the live legacy
  trigger that will outrank what you are about to build — on Instagram the **oldest** all-posts
  trigger wins, and nothing anywhere reports the conflict.
- The rule list was headed "The five things" while listing six.

### Verified

Written against a baseline. Two agents were given a design task containing a deliberately
impossible requirement (a 2-day follow-up DM) with the 0.3.0 skill; both designed a delay node that
publishes cleanly and never sends, both flagged the messaging window as an unresolved risk rather
than a known rule, and neither knew about the 1-DM/24h cap or trigger precedence.

**Re-tested with 0.4.0: 1 of 5 agents produced a correct design.** The one that passed opened the
references (4 tool calls) and led with what the platform refuses. The four that failed invoked the
skill and wrote from impression (1–3 tool calls) — one invented a non-existent "Meta 24+1
allowance" and recommended shipping on it. **Documentation alone does not close this gap.** The
content is correct and load-bearing for an agent that reads it; the durable fix is a compiler rule
(a cumulative-delay walk in `core/rules.mjs`) so `build_flow` refuses the shape outright. Tracked,
not yet built.

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

# ManyChat's validation ledger

Every rule the tools enforce, ported once into `mcp-server/core/rules.mjs` and shared by
`check_flow`, `build_flow`, `edit_flow`, `publish_flow`, `set_flow_draft`,
`create_comment_trigger` and `create_dm_keyword`. `check_flow` with `rules:true` returns this
table live.

**Layer** — where the rule lives: **S** the server enforces it on `flow/publish` and the quoted
string is what it returns; **C** ManyChat's builder enforces it and the API *accepts* the violation;
**S+C** both.

**Blocks** — whether a finding stops the tool. Since 0.2.0 the answer is **yes for every rule whose
string is known**, for two reasons: a server rule would fail the publish anyway, and a client-only
rule produces a node the builder marks broken and a channel may refuse at send time (Instagram's own
DM limit is 1000 characters, which the API happily stores). Pass `allowUiWarnings: true` to demote
the client-only rows to warnings — an explicit choice, never the default. Rules the corpus has never
probed on the server (`serverEnforced: null`) warn unless the tool refuses them by policy.

A 200 from `flow/publish` proves only that the **S** rules passed.

## Whole flow / batch

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `BATCH_ROOT_MISSING` | C | yes (policy) | Please choose next step. | root_content must name a node in the batch (its _oid) or an already-published content_id. The server accepted root_content:null when a prior root existed; the tool refuses it. |
| `DUPLICATE_OID` | S | yes (server) | **`Something went wrong`** | Two contents sharing an _oid corrupt the flow (duplicate _oid per content_id); a later full republish fails with this string. Mint fresh _oids per node. |
| `TARGET_NOT_IN_BATCH` | S | yes (server) | **`Content is linked to the wrong target node`** | A target {_content_oid} must name a node in the SAME batch (live-15/19). |
| `CONTENT_TYPE_UNKNOWN` | S | warn | — | setDraft stores an unknown type verbatim; the publish-side string was not captured. |

## Message node and blocks

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `NODE_NO_MESSAGE` | C | yes (UI rule) | Please create at least one message |  |
| `TEXT_REQUIRED` | S+C | yes (server) | **`Text required`** |  |
| `TEXT_OVER_2000` | S | yes (server) | **`Provided text is longer than 2000 symbols`** |  |
| `TEXT_OVER_1000` | C | yes (UI rule) | Text must be less than 1000 characters long | Instagram cap in the UI; the server accepted 1001 (live-08). |
| `BLOCKS_MAX_101` | C | yes (UI rule) | No more than 101 blocks in a message |  |
| `MESSAGE_TYPE_UNKNOWN` | S | warn | — |  |
| `IG_BLOCK_NOT_ALLOWED` | C | yes (policy) | This block is not available on the Instagram channel | InstagramNodeConfig allows text, attachment, quick_reply, question, delay, card, cards, dynamic, otn_request |
| `DELAY_LAST` | C | yes (UI rule) | The Typing Delay cannot be the final element in the message |  |
| `DELAYS_IN_A_ROW` | C | yes (UI rule) | No more than 5 delays in a row |  |
| `QUESTION_TEXT_REQUIRED` | S+C | yes (server) | **`You should set not empty value`** |  |
| `ANSWER_TYPE_UNSUPPORTED` | S | yes (server) | **`Answer type {type} is unsupported`** |  |

## Images, cards and dynamic blocks

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `ATTACHMENT_NEEDS_CAID` | S | yes (server) | **`Attachment without caid`** | PROVEN 2026-09-03: an image ManyChat did not store is refused — the external_image shape its own exporter emits, a {type,url} object and a bare URL all fail. Upload it first (upload_attachment -> POST /content/upload) and pass the returned object, which carries caid. |
| `ATTACHMENT_TYPE_INVALID` | C | yes (policy) | attachment content.type must be image, video, file, gif or external_image | The WIRE union. `pdf` and `audio` are builder display types you pass to `upload_attachment`; the exporter downgrades pdf → file and the Parser re-derives Video/PDF from `data.mime`. |
| `IG_PDF_NEEDS_PREVIEW` | C | yes (policy) | This PDF was uploaded without a preview | PROVEN 2026-09-03 by differential (same bytes, same field name, only `dest` varies): POST /content/upload returns a `preview` object ONLY when the multipart carries `dest=pdf`. Without it the builder logs PdfPreviewNotReceivedError for a PDF on an Instagram node (Batch/Parser.js). Upload with `upload_attachment` `type:"pdf"` `node:"instagram"`. |
| `ATTACHMENT_URL_REQUIRED` | C | yes (policy) | Please specify image URL | external_image needs content.data.url; uploaded types need the object /content/upload returned |
| `CARDS_EMPTY` | C | yes (policy) | Please create at least one card |  |
| `CARDS_MAX_10` | C | yes (policy) | You can add only 10 cards |  |
| `CARD_TITLE_REQUIRED` | C | yes (policy) | Please enter a title |  |
| `CARD_TITLE_OVER_80` | C | warn | Title must be less than 80 characters long |  |
| `CARD_SUBTITLE_OVER_80` | C | warn | Subtitle must be less than 80 characters long |  |
| `DYNAMIC_URL_REQUIRED` | C | yes (policy) | Please enter a request URL |  |
| `DYNAMIC_METHOD_INVALID` | C | yes (policy) | method must be get, post, put or delete | RequestMethodSchema in shared/api/requests/content/schemas.ts |
| `DYNAMIC_PAYLOAD_NOT_STRING` | S | yes (server) | **`Something went wrong`** | PROVEN 2026-09-03: a dynamic block whose payload is an OBJECT fails; a JSON STRING or null is accepted. Same rule as external_request. |

## Buttons and quick replies

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `BUTTONS_MAX_3` | S+C | yes (server) | **`Too many buttons`** |  |
| `BUTTON_CAPTION_REQUIRED` | S+C | yes (server) | **`Button without caption`** |  |
| `BUTTON_CAPTION_OVER_20` | C | yes (UI rule) | Button title must be less than 20 characters long | server accepted 21 (live-08 publish_qrCaption21) |
| `BUTTON_URL_INVALID` | C | yes (UI rule) | Please enter a valid URL | server accepted "not a url" (live-08) |
| `BUTTON_TARGET_REQUIRED` | C | yes (UI rule) | Please select a next step for the button |  |
| `BUTTON_TYPE_UNKNOWN` | S | warn | — |  |
| `QR_MAX_13` | S | yes (server) | **`You can add only 13 quick replies in total`** | the UI caps at 11 |
| `QR_OVER_11` | C | yes (UI rule) | You can add only 11 quick replies |  |
| `QR_AFTER_QUESTION` | S+C | yes (server) | **`Quick reply can not be after question message`** |  |
| `QR_AFTER_TEXT_WITH_BUTTONS` | C | yes (UI rule) | Quick Replies can be added only after Text block without Buttons for the Instagram channel | server accepted (live-11) |

## Comment reply (private reply)

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `PRIVATE_REPLY_ROOT_REQUIRED` | S | yes (server) | **`Mark this message as a "Private Reply" if you want to send it as a reply to a post, reel comment, a follow action or share to story reply.`** | key is <oid>.private_reply; applies when a comment/story trigger is attached |
| `PRIVATE_REPLY_NO_TARGET` | S | yes (server) | **`Message reply to comment can’t be linked to Next step. Please use buttons or quick replies for that.`** |  |
| `PRIVATE_REPLY_ONE_BLOCK` | S | yes (server) | **`Message reply to comment can contain only one block with buttons or quick replies.`** |  |

## Actions

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `ACTION_TYPE_UNSUPPORTED` | S | yes (server) | **`Unsupported action type`** |  |
| `ACTION_NULL` | C | yes (UI rule) | Actions list contains null |  |
| `TAG_WRONG` | S+C | yes (server) | **`Wrong tag`** | the tag must exist AND be a user tag; trigger auto-tags ("Post or Reel Comments #N") are refused |
| `FIELD_WRONG` | S+C | yes (server) | **`Wrong field`** |  |
| `BOT_FIELD_UNKNOWN` | S | warn | — | change_global_field_value with an unknown field_id was not probed |
| `ACTION_TAG_REQUIRED` | C | yes (policy) | Please select or create a tag |  |
| `ACTION_SEQUENCE_REQUIRED` | C | yes (policy) | Please select a sequence |  |
| `ACTION_SEQUENCE_WRONG` | S | yes (server) | **`Wrong sequence`** | PROVEN 2026-09-03: flow/publish rejects an add_to_sequence whose sequence_id does not exist on the account (probed with id 1). The server validates the id, so the ledger does not have to — but `list_sequences` is how you find a real one, and `build_flow` resolves a sequence NAME through it. |
| `ACTION_FIELD_REQUIRED` | C | yes (policy) | Please select a custom user field to set |  |
| `ACTION_FIELD_VALUE_REQUIRED` | C | yes (policy) | Please enter a value for the custom user field | the UI string is a translation key; the server accepts an empty value (it stores it) |
| `ACTION_UNSET_FIELD_REQUIRED` | C | yes (policy) | Please select a custom user field to unset |  |
| `ACTION_START_FLOW_REQUIRED` | C | yes (policy) | Please select Automation |  |
| `ACTION_ASSIGN_REQUIRED` | C | yes (policy) | Please choose a team member |  |
| `ACTION_MAIN_MENU_REQUIRED` | C | yes (policy) | Please select a Main Menu |  |
| `ACTION_PAUSE_DURATION_REQUIRED` | C | yes (policy) | Please enter a pause duration |  |
| `ACTION_EVENT_REQUIRED` | C | yes (policy) | Please enter a Conversion Event name |  |
| `ACTION_INTEGRATION_ACTION_REQUIRED` | C | yes (policy) | Please select an integration action | every integration action (hubspot, convertkit, chatgpt, claude, deepseek, google_sheets, active_campaign, klaviyo, mailchimp) carries `action` + `data` |
| `ACTION_CUSTOM_AUDIENCE_REQUIRED` | C | yes (policy) | Please set up the custom audience action (ad account, audience, action) |  |
| `ACTION_NOTIFY_TEXT_REQUIRED` | C | yes (policy) | Notify admin needs a message text |  |
| `EXTERNAL_URL_REQUIRED` | S+C | yes (server) | **`url cannot be empty`** |  |
| `EXTERNAL_URL_NOT_HTTPS` | C | yes (UI rule) | incorrect url | server accepted http:// (live-05 publish2_httpHook) |
| `EXTERNAL_PAYLOAD_JSON` | C | yes (UI rule) | Payload must be valid JSON |  |
| `EXTERNAL_MAPPING_INCOMPLETE` | C | yes (UI rule) | Mapping entries need a path and a field |  |

## Condition, split, delay, goto, AI, note

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `CONDITION_FIELD_NOT_FOUND` | S | yes (server) | **`Field item not found: {field}`** |  |
| `CONDITION_OPERATOR_UNSUPPORTED` | S | yes (server) | **`Unsupported operator {op}`** |  |
| `CONDITION_CUF_FORMAT` | S | yes (server) | **`Wrong field format: {field}`** | a custom field is the STRING cuf_<id> |
| `CONDITION_FIELD_MUST_BE_STRING` | S | yes (server) | **`Field must be a string`** |  |
| `CONDITION_NO_TARGET` | C | yes (UI rule) | Please select at least one next step for condition | server accepted a condition with no targets (live-12) |
| `SPLIT_PERCENTS` | S+C | yes (server) | **`Percents sum must be equal to 100`** |  |
| `SPLIT_VARIANTS_MIN` | C | yes (UI rule) | Please add at least 2 variations |  |
| `SPLIT_VARIANTS_MAX` | C | yes (UI rule) | Please keep maximum 6 variations |  |
| `DELAY_UNIT_INVALID` | S | yes (server) | **`Invalid unit`** |  |
| `DELAY_VALUE_REQUIRED` | C | yes (UI rule) | Please enter a delay duration |  |
| `GOTO_FLOW_WRONG` | S | yes (server) | **`Wrong content provided.`** |  |
| `GOTO_FLOW_REQUIRED` | C | yes (UI rule) | Please select Automation |  |
| `AI_NODE_PROMPT_REQUIRED` | C | yes (policy) | Please enter a prompt for the AI step |  |
| `NOTE_FONT_SIZE` | S | yes (server) | **`Wrong font size`** |  |
| `NOTE_SIZE` | S | yes (server) | **`Wrong note size`** |  |
| `NOTE_COLOR` | S | yes (server) | **`Wrong note color`** |  |
| `NOTE_TEXT_OVER_640` | C | yes (UI rule) | Note text must be less than 640 characters long | server accepted 641 (live-10) |

## Triggers

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `WIDGET_AREA_MISSING` | C | yes (policy) | Choose Specific Post or Reel to continue. | without post_covered_area the UI shows "specific Post" and refuses activation |
| `WIDGET_AREA_INVALID` | C | yes (policy) | post_covered_area must be all_posts, specific_post or next_post | server accepted "bogus" (live-06) but the UI then refuses to activate; the tool blocks it |
| `WIDGET_POST_REQUIRED` | S+C | yes (server) | **`Please select a post to track comments`** |  |
| `WIDGET_KEYWORDS_REQUIRED` | C | yes (UI rule) | Create Keyword to continue. | server accepted empty keywords (live-06) |
| `WIDGET_REPLIES_MIN_3` | C | yes (UI rule) | Create at least 3 replies for sending randomly. | server accepted 1 (live-06) |
| `WIDGET_REPLIES_UNIQUE` | C | yes (UI rule) | Create 3 unique replies so they feel natural |  |
| `WIDGET_COMMENT_CONTAINS_INVALID` | C | yes (policy) | comment_contains must be specific_words or any_words |  |
| `KEYWORD_SYSTEM` | S | yes (server) | **`Trying to rewrite system keyword rule`** |  |
| `KEYWORD_CONDITION_UNKNOWN` | S | yes (server) | **`(HTTP 500 HTML — ManyChat crashes on an unknown condition)`** | live-04: condition:"regex" → 500 |
| `KEYWORD_REQUIRED` | C | yes (UI rule) | Please provide a keyword. | server accepted an empty list (live-04) |
| `KEYWORDS_MAX_12` | C | yes (policy) | No more than 12 keywords per rule | server accepted 13 (live-04) |
| `KEYWORD_RULES_MAX_5` | C | yes (UI rule) | No more than 5 rules per keyword trigger |  |
| `KEYWORD_CHANNEL_UNKNOWN` | C | yes (policy) | channel must be instagram, facebook, whatsapp, telegram, tiktok or sms |  |


## House rules (0.6.0) — ours, not ManyChat's

Five rules the ledger enforces that ManyChat itself does not. The API accepts every one of them;
they exist because the resulting flow is either undeliverable or unmaintainable. They are checked
where the object is created, so they land in the tool result rather than in a document.

| Rule | Layer | Blocks | Message | Note |
|---|---|---|---|---|
| `DELAY_EXCEEDS_MESSAGING_WINDOW` | C | **no** — warns | This delay puts the next send outside Meta's 24-hour messaging window, so it will publish and never deliver. | `validateBatch` walks every path from the root summing `smart_delay` durations and reports at the node that first crosses 24h, with the computed total. Warns rather than blocks because a contact who re-engages before the delay fires reopens the window — the branch is dead for most contacts, not all. |
| `FIELD_SHADOWS_SYSTEM_FIELD` | C | **yes** (policy) | A ManyChat system field already holds this. Capture it with `save_to` and read it with the system merge tag instead of creating a custom field. | `create_field` refuses **before** calling the API. Matches the whole normalised caption against a synonym table, so `Work Email Verified At` is fine and `Email Address` is not. |
| `TAG_NAME_NOT_NAMESPACED` | C | no — warns | Tag names use `namespace:value`, lowercase, hyphens inside multi-word values. | ManyChat does not normalise tag case on write, so mixed schemes silently produce duplicates. The finding carries a suggested name. |
| `OBJECT_NOT_IN_FOLDER` | C | no — warns | Created at the account root. Pass `path` so it lands in a folder. | Folders are the only organisational primitive ManyChat has, and moving objects later is manual work in the UI. |
| `OBJECT_NAME_EMOJI` | C | no — warns | No emoji in object names. Emoji in message copy is fine. | Breaks sorting and search. |

`validateObjectName({ kind, caption, path })` returns the same shape as `validateBatch` and is
wired into `create_tag`, `create_field` and `create_bot_field`. The delay walk runs inside
`validateBatch`, so it fires on `check_flow`, `build_flow` (including `dryRun`), `edit_flow` and
`publish_flow`.

**Verified live 2026-09-04.** `create_field` with caption `Email Address` returned
`VALIDATION_FAILED` and made no API call. `build_flow` with `dryRun:true` on a spec containing a
two-day delay returned the warning keyed to caption `Wait 2 days` with detail
`48h from the contact's last interaction`.

## Proven against the live server

**2026-09-03, twelve rules by differential.** Each violation was sent straight to `flow/publish`
through `raw_request` (no validation) on a probe flow with a comment trigger attached, and the
returned `content_node_errors` string compared with the one quoted above. **12/12 matched exactly**,
and the flow was unchanged afterwards — a refused publish writes nothing:

`PRIVATE_REPLY_ROOT_REQUIRED` · `PRIVATE_REPLY_NO_TARGET` · `PRIVATE_REPLY_ONE_BLOCK` ·
`TEXT_REQUIRED` · `BUTTONS_MAX_3` · `BUTTON_CAPTION_REQUIRED` · `SPLIT_PERCENTS` ·
`DELAY_UNIT_INVALID` · `ANSWER_TYPE_UNSUPPORTED` · `TAG_WRONG` · `FIELD_WRONG` · `NOTE_COLOR`.

**2026-09-03, two rules found by publishing.** Building the first flow with images and a dynamic
block produced two refusals the corpus did not know, both now in the table above:

- `ATTACHMENT_NEEDS_CAID` — **ManyChat will not send an image it did not store.** A URL image fails
  with `Attachment without caid` in every shape tried: the `external_image` form ManyChat's own
  exporter emits, a `{type,url}` object, and a bare URL string. Upload it first
  (`upload_attachment`) and pass the returned object, which carries `caid`. Proven both for a
  standalone attachment block and for a card image.
- `DYNAMIC_PAYLOAD_NOT_STRING` — a dynamic block whose `payload` is an object fails with
  `Something went wrong`; a JSON **string** or `null` is accepted. Same rule `external_request`
  already followed.

The server reports **one** `content_node_errors` entry per call, which is why the ledger runs
first: it names every server-enforced problem at once, keyed by caption.

**2026-09-05, two findings from the quick-reply-question probe** (account `a live account`, flow
`TEST-CAP-QR-QUESTION 2026-09-05`, no trigger, sends nothing, left in place).

- **A question block CAN carry tappable reply buttons, and `build_flow` cannot author them.**
  Set `answer_method` to `"any"` (or `"reply"`) and `answer_replies` to an array of
  `{_oid, type: "answer", caption}`. It publishes and survives read-back, and the server confirms
  it recognised them as buttons by adding `value: null` and a per-button `button_click_stats`
  segment id to each, and regenerating the flow preview. **The buttons need no `target`:** tapping
  one sets the answer and the block's own `success_target` fires. **[Superseded 2026-09-05: on a live
  Instagram contact the tap wrote the field and `success_target` did NOT fire. Answer buttons render
  but do not route. See the entry below.]** `build_flow`'s spec exposes
  neither key and silently drops unknown keys inside `question`, so a spec carrying
  `answer_replies` compiles clean and publishes a plain typed-input question. Until the spec
  exposes them, the path is `build_flow` → `get_flow` → patch the block → `publish_flow`.
- **`publish_flow` is not a safe partial upsert when the node you send has cross-node targets.**
  Publishing a single node, byte-identical to what was already stored, was rejected with
  `Content is linked to the wrong target node`, because its `success_target` and `timeout_target`
  named nodes absent from the batch. Publishing the full node set succeeded immediately. Verified
  both ways in sequence. **So: a node that points at another node is published with the whole
  flow's node set, never alone.** "Unmentioned nodes survive" holds only for nodes with no
  outgoing targets.

**2026-09-05, the rule the probe could not find.** The probe above proved a question block accepts
`answer_replies`, but its question saved nothing. Building six real qualifiers found the rest of
it: **when a question saves to a custom field (`adapters: [{type:"save_answer_to_custom_field"}]`),
every answer button must carry a `value` as well as a `caption`.** Without it the publish is
refused with **`Wrong AnswerReply type for custom field.`** Proven by differential on one flow:
`{type:"answer", caption}` refused; `{type:"answer", caption, value}` accepted; dropping the
adapter instead also accepted, which confirms the field is what triggers the requirement.
`{type:"content", ...}` is refused with the same string, and `answer_type:"array"` 500s the server.
The `value` is what lands in the field and the `caption` is what the contact sees, so they may
differ. Set both.

Two smaller notes from the same build. `publish_flow` needs the node's own `data` object passed
through **verbatim** plus `content_id`/`caption`/`type`/`namespace`: rebuilding a node from a
whitelist of keys drops `default_target_oid` on a `multi_condition` and the publish is refused with
`default_target_oid is missing`. And `build_flow`'s `name` is stored literally, so an HTML entity
like `&amp;` in a flow name stays `&amp;` on the canvas; pass the real character.

**2026-09-05, live on a real contact: answer buttons render but do not route.** Six qualifiers built
in the shape above (question block, `answer_method:"any"`, `answer_replies` with `caption` and
`value`, adapter saving to a custom field) published clean and the chips rendered on Instagram.
The contact tapped one: the value landed in the field and the flow stopped at the question.
`success_target` never fired. Two repairs failed the same way. A `target` on each answer button
is refused before send; `content_id` + `_content_oid` on each answer button publish with a 200
and are **stripped on read-back**: the stored button is `{_oid, type:"answer", caption, value}` and
nothing else. So a `type:"answer"` button cannot carry routing, and on Instagram the tap does not
continue the block either. **The shape that routes, proven live the same day on the same account:
a text block with `quick_replies.buttons` of `type:"content"`** (each with `_content_oid`), one
per answer, each pointing at an `actions` node that runs `set_custom_field_value`, then the
payoff text, then the goto. Same chips on screen, no question block. `build_flow` authors this
directly (`quick_replies: [{caption, to}]` on a message node). The cost is the question block's
`timeout_target`: with no question there is no built-in nudge, so a contact who never taps simply
stops. A nudge on this shape needs a delay after the text block inside the 24h window and is
unproven.

**2026-09-05, `GOTO_FLOW_WRONG` was a false positive, now fixed in `tools.mjs`.** `/cms/getFlows`
answers at most **24 rows** (newest modified first) and ignores `limit`, `page` and `offset`. The
ledger built its set of known flows from that one call, so every goto to a flow older than the 24
most recently modified was refused as "not on this account" (server string `Wrong content
provided.`), and `build_flow` was blocked for an entire rebuild whose target flows all existed and
were published. `confirmGotoTargets` now confirms each unlisted goto target with
`/flow/getFlowData` before the rule runs. The same ceiling applies to `list_flows`: a flow missing
from that list is not proof it is absent; `get_flow` by ns is.

**2026-09-05, `publish_flow` ships authoring tokens literally.** `build_flow` resolves the plugin's
name-based tokens (`{{bot:Offer Price - Marriage}}` → `{{gaf_5095350}}`, and the same for
`{{cuf:…}}`) through the ledger's resolvers. `publish_flow` does not: it stores message text
verbatim. So text lifted from a `build_flow` spec and republished through `publish_flow` reaches a
real contact as the raw string `{{bot:Offer Price - Marriage}}`. It publishes clean, it reads back
clean, and the ledger says nothing, because a literal token is valid text. Caught live on a
customer-facing price line. **Two fixes worth making: resolve `{{bot:…}}` / `{{cuf:…}}` in
`publish_flow` the way `build_flow` does, or fail the batch when a message body still contains one.
A stored `{{bot:` is never correct.**

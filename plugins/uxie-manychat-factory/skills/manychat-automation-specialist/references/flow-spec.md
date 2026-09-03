# `build_flow` spec format

A spec is nodes addressed by **caption**; edges name captions. The compiler mints fresh `_oid`s,
resolves tag/field/bot-field **names** to ids, rewrites `{{field:Name}}` → `{{cuf_<id>}}` and
`{{bot:Name}}` → `{{gaf_<id>}}`, then runs the validation ledger. Captions must be unique — they are
the addresses. System merge tags (`{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{ig_username}}`,
`{{user_id}}`) pass through untouched.

```jsonc
{
  "root": "Comment reply",          // caption of the first node
  "channel": "instagram",           // default channel for message nodes
  "nodes": [ /* … */ ]
}
```

## Node types

### `message` (default) — a channel node
```jsonc
{ "caption": "Comment reply", "type": "message",
  "private_reply": true,            // REQUIRED on the root of a comment/story-triggered flow
  "next": "Other caption",          // "Next step" — FORBIDDEN on a private_reply node
  "text": "Hey {{first_name}} 👋",  // shorthand for a single text block
  "buttons": [ { "caption": "Send it to me", "to": "Stamp" },
               { "caption": "Read more", "url": "https://example.com" } ],   // ≤ 3, caption ≤ 20
  "quick_replies": [ { "caption": "Option A", "to": "Menu A" } ],            // ≤ 13 (UI caps at 11)
  "blocks": [                       // use INSTEAD of text/buttons for multi-block nodes
    { "text": "First", "buttons": [] },
    { "delay": 3, "typing": true },                                          // seconds
    { "attachment": { "type": "image", "data": "<the object upload_attachment returned>" } },
                   // type: image | video | gif | pdf | audio | file — pdf reaches the wire as "file"
    { "cards": [ { "title": "Card one", "subtitle": "sub",
                   "image": "<the object upload_attachment returned>",       // NOT a URL
                   "url": "https://example.com",                             // tap-the-card action
                   "buttons": [ { "caption": "Open", "url": "https://example.com" },
                                { "caption": "Next", "to": "Other caption" } ] } ],
      "aspect": "horizontal" },                                              // or "square"; max 10 cards
    { "dynamic": { "url": "https://example.com/api", "method": "post",
                   "payload": { "user": "{{user_id}}" },                     // serialized to a STRING for you
                   "headers": {}, "fallback": "Other caption" } },
    { "question": { "text": "What is the best email for you?",
                    "save_to": "email",          // email|phone|first_name|last_name|{"field":"Name"}
                    "answer_type": "email",      // inferred from save_to; see the ledger for the enum
                    "retry_text": "That does not look like an email.",
                    "retries": 3,
                    "timeout": { "unit": "hours", "value": 23 },
                    "next": "Deliver",           // on a valid answer
                    "on_timeout": "Menu" } }
  ] }
```
Text ≤ 2000 characters (server); over 1000 on Instagram is blocked — that is Meta's own DM limit, so
the API stores it and the send fails.

**Every attachment must be uploaded first.** `upload_attachment` returns an object carrying `caid`;
pass that object, not a URL. ManyChat refuses a URL image with `Attachment without caid` in every
shape, including the `external_image` form its own exporter emits. Live-proven 2026-09-03 for a
standalone attachment block and a card image, and for image, video, gif and pdf uploads.

**Pass `node` to `upload_attachment`.** The builder puts a `dest` field on the upload decided by
(node type, attachment type), and it is not cosmetic: only `dest=pdf` makes the server generate the
`preview` an Instagram PDF block needs. Proven 2026-09-03 by differential — same bytes, same field
name, `preview` present only with `dest=pdf`. The ledger refuses a preview-less Instagram PDF
(`IG_PDF_NEEDS_PREVIEW`).

**A video and a PDF both come back `type: "file"`.** That is correct, not a failure: the builder's
Parser re-derives Video from `data.mime` starting `video/`, and PDF from `application/pdf`. The
account's own `app.attachment_policy` (GET `/dashboard/getData`) is the authority on what each
channel accepts — `upload_attachment` reads it and refuses a wrong extension or an oversized file
before sending. On Instagram: image `gif/jpg/jpeg/png` ≤ 8 MB, video `mp4/ogg/webm/mov/avi` ≤ 25 MB,
audio `m4a/wav/aac` ≤ 25 MB, file **pdf only** ≤ 25 MB.

### `actions` — an action group
```jsonc
{ "caption": "Stamp", "type": "actions", "next": "Known email?",
  "actions": [
    { "add_tag": "MC - Wizard Lead" }, { "remove_tag": "Cold" },
    { "set_field": { "field": "MC Interest", "value": "Wizard" } },
    { "unset_field": "MC Interest" },
    { "set_bot_field": { "field": "Offer URL - Wizard", "value": "https://…" } },
    { "external_request": { "url": "{{bot:GHL Inbound Webhook URL}}", "method": "POST",
                            "headers": { "Content-Type": "application/json" },
                            "payload": { "email": "{{email}}", "interest": "{{field:MC Interest}}" },
                            "mapping": [] } },
    { "notify_admin": { "text": "New lead", "via": ["email"] } },
    { "start_flow": "content20260101010101_123456" },
    { "raw": { "type": "pause_automations", "…": "any of the 50 action types verbatim" } }
  ] }
```

### `condition` — multi_condition

A ManyChat filter is two levels: **groups** joined by an operator, and **items** inside each group
joined by that group's operator. `all` and `any` map onto that, nesting one level:

```jsonc
{ "caption": "Known email?", "type": "condition", "else": "Ask email",
  "conditions": [
    { "if": { "system_field": "email", "op": "HAS_VALUE" }, "then": "Deliver" },
    { "if": { "field": "MC Interest", "op": "IS", "value": "Wizard" }, "then": "Wizard path" },
    { "if": { "tag": "MC - Wizard Lead", "op": "IS" }, "then": "Returning" },

    { "if": { "all": [ { "system_field": "email", "op": "HAS_VALUE" },
                       { "tag": "MC - Wizard Lead" } ] }, "then": "Both" },          // A AND B
    { "if": { "any": [ { "tag": "A" }, { "tag": "B" } ] }, "then": "Either" },       // A OR B
    { "if": { "all": [ { "any": [ { "tag": "A" }, { "tag": "B" } ] },
                       { "system_field": "email", "op": "HAS_VALUE" } ] },
      "then": "Nested" }                                                             // (A OR B) AND C
  ] }
```

A third level has nowhere to go in the wire shape and is refused by name rather than flattened into
something that means something else.
Operators: `IS` `IS_NOT` `IN` `NOT IN` `CONTAINS` `DOES_NOT_CONTAINS` `BEGIN_WITH`
`GREATER_THAN(_OR_EQUAL)` `LESS_THAN(_OR_EQUAL)` `AFTER` `BEFORE` `ON` `TRUE` `FALSE` `HAS_VALUE`
`IS_UNKNOWN` `DATETIME_INTERVAL_AFTER/BEFORE` `BETWEEN` `CASE`.

### the rest
```jsonc
{ "caption": "Wait", "type": "delay", "value": 1, "unit": "minutes", "next": "Follow up" }   // minutes|hours|days
{ "caption": "Coin flip", "type": "split",
  "variants": [ { "title": "A", "percent": 50, "to": "Deliver" },
                { "title": "B", "percent": 50, "to": "Follow up" } ] }                        // must total 100
{ "caption": "To core", "type": "goto", "flow": "content20260101010101_123456" }
{ "caption": "Sticky", "type": "note", "text": "why this exists", "color": "info" }           // default|white|danger|success|info
{ "caption": "Ask AI", "type": "ai", "prompt": "Answer using {{field:MC Offer URL}}", "next": "Deliver" }
```

### Actions in full

Beyond the shorthands above (`add_tag`, `remove_tag`, `set_field`, `unset_field`, `set_bot_field`,
`external_request`, `notify_admin`, `start_flow`):

```jsonc
{ "add_to_sequence": 55 }, { "remove_from_sequence": "Welcome drip" },   // id, or a NAME resolved via list_sequences
{ "open_conversation": true }, { "close_conversation": true },
{ "assign_conversation": { "user_id": 9 } },        // or { "group_id": 3 }
{ "set_optin": "email" },                            // email|sms|instagram|telegram|tiktok
{ "set_optout": "sms" },                             // …plus whatsapp for optout only
{ "pause_automations": { "duration": 3600 } }, { "resume_automation": true },
{ "pause_automation_forever": true },
{ "fire_custom_event": { "event_id": 3, "cost": 10 } },
{ "set_main_menu": "content20260101010101_123456" },
{ "integration": { "type": "google_sheets", "action": "add_row", "data": { } } },
                 // hubspot|convertkit|chatgpt|claude|deepseek|google_sheets|active_campaign|klaviyo|mailchimp
{ "raw": { "type": "<any of the 50 action types>", "…": "verbatim" } }
```

Every one carries the required key ManyChat's own validator demands (a tag action needs `tag_id`, a
sequence action `sequence_id`, an integration `action`), and the ledger refuses it without.

## Worked example — comment-to-lead capture

The shape the comment-reply rules force, with the delivery link held in a bot field so it can be
changed without touching the flow:

```jsonc
{ "root": "Comment reply", "channel": "instagram", "nodes": [
  { "caption": "Comment reply", "type": "message", "private_reply": true,
    "text": "Hey {{first_name}} 👋 glad you reached out — tap below and I'll send it over.",
    "buttons": [ { "caption": "Send it to me", "to": "Stamp" } ] },

  { "caption": "Stamp", "type": "actions", "next": "Known email?",
    "actions": [ { "add_tag": "Keyword: Wizard" },
                 { "set_field": { "field": "MC Interest", "value": "Wizard" } },
                 { "set_field": { "field": "MC Offer URL", "value": "{{bot:Offer URL - Wizard}}" } } ] },

  { "caption": "Known email?", "type": "condition", "else": "Ask email",
    "conditions": [ { "if": { "system_field": "email", "op": "HAS_VALUE" }, "then": "Sync" } ] },

  { "caption": "Ask email", "type": "message",
    "blocks": [ { "question": { "text": "Before I send it — what's the best email for you?",
                                "save_to": "email", "retry_text": "That doesn't look right, try again.",
                                "retries": 4, "timeout": { "unit": "hours", "value": 23 },
                                "next": "Sync" } } ] },

  { "caption": "Sync", "type": "actions", "next": "Deliver",
    "actions": [ { "set_field": { "field": "MC Lead Source", "value": "Instagram / ManyChat" } },
                 { "external_request": { "url": "{{bot:GHL Inbound Webhook URL}}", "method": "POST",
                     "headers": { "Content-Type": "application/json" },
                     "payload": { "first_name": "{{first_name}}", "email": "{{email}}",
                                  "instagram_username": "{{ig_username}}",
                                  "interest": "{{field:MC Interest}}",
                                  "offer_url": "{{field:MC Offer URL}}" } } } ] },

  { "caption": "Deliver", "type": "message",
    "text": "You're in 🪄 Here's the link:\n\n👉 {{field:MC Offer URL}}" }
] }
```

Then: `create_comment_trigger` (keywords, `post_covered_area`, three unique public replies) and
`create_dm_keyword` — both land in draft — and `layout_flow`. Nothing is live until
`set_trigger_status`.

## Editing what already exists

`edit_flow` takes operations addressed by caption, so an edit never means rewriting node JSON:

```jsonc
{ "ns": "content…", "relayout": true, "ops": [
  { "op": "set_text", "node": "Deliver", "text": "New copy", "block": 0 },
  { "op": "add_button", "node": "Comment reply", "button": { "caption": "Docs", "url": "https://…" } },
  { "op": "set_button", "node": "Comment reply", "caption": "Docs", "new_caption": "Read the docs" },
  { "op": "remove_button", "node": "Comment reply", "caption": "Old" },
  { "op": "set_quick_replies", "node": "Menu", "quick_replies": [ { "caption": "A", "to": "Path A" } ] },
  { "op": "add_block", "node": "Deliver", "block": { "text": "PS…" }, "at": 1 },
  { "op": "replace_block", "node": "Deliver", "at": 0, "block": { "text": "…" } },
  { "op": "remove_block", "node": "Deliver", "at": 1 },
  { "op": "set_actions", "node": "Stamp", "actions": [ { "add_tag": "Lead" } ] },
  { "op": "add_action", "node": "Stamp", "action": { "set_field": { "field": "F", "value": "v" } } },
  { "op": "remove_action", "node": "Stamp", "at": 2 },
  { "op": "set_conditions", "node": "Which?", "else": "Ask", "conditions": [ { "if": { "tag": "Lead" }, "then": "Deliver" } ] },
  { "op": "set_next", "node": "Stamp", "to": "Which?" },
  { "op": "set_delay", "node": "Wait", "value": 2, "unit": "hours" },
  { "op": "set_split", "node": "Test", "variants": [ { "percent": 50, "to": "A" }, { "percent": 50, "to": "B" } ] },
  { "op": "set_goto", "node": "To core", "flow": "content…" },
  { "op": "set_prompt", "node": "Ask AI", "prompt": "…" },
  { "op": "set_private_reply", "node": "Comment reply", "value": true },
  { "op": "set_caption", "node": "Old name", "caption": "New name" },
  { "op": "add_node", "node": { "caption": "Thanks", "type": "message", "text": "Thanks!" } },
  { "op": "remove_node", "node": "Dead end", "rewire": "Deliver" },
  { "op": "set_root", "node": "Comment reply" }
] }
```

Rules that make it safe: every op names its node by caption and fails loudly if it does not exist or
is the wrong type; **all** problems are reported at once and nothing is sent; `remove_node` refuses
to orphan an edge unless you say where it should point (`rewire`), never removes the root, and marks
the node `removed:true` rather than dropping it; and the whole result goes through the same ledger
and read-back verification as `build_flow`. Use `relayout: true` whenever you add nodes.

## After building

`build_flow` returns `captionToOid` (the id the server now knows each node by), a `verify` block
comparing what was sent with what came back, and any client-only `warnings`. Quote `verify`, not the
fact the call returned 200.

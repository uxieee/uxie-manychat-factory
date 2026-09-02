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
Text ≤ 2000 characters (server); the builder warns over 1000 on Instagram.

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
```jsonc
{ "caption": "Known email?", "type": "condition", "else": "Ask email",
  "conditions": [
    { "if": { "system_field": "email", "op": "HAS_VALUE" }, "then": "Deliver" },
    { "if": { "field": "MC Interest", "op": "IS", "value": "Wizard" }, "then": "Wizard path" },
    { "if": { "tag": "MC - Wizard Lead", "op": "IS" }, "then": "Returning" }
  ] }
```
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
```

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

## After building

`build_flow` returns `captionToOid` (the id the server now knows each node by), a `verify` block
comparing what was sent with what came back, and any client-only `warnings`. Quote `verify`, not the
fact the call returned 200.

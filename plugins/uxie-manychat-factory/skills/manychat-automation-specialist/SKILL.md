---
name: manychat-automation-specialist
description: Design, build, publish, lay out and (only on the user's word) activate ManyChat Instagram automations through the uxie-manychat-mcp server. Use when the user wants a ManyChat flow, comment trigger ("comment WIZARD and I'll DM you"), DM keyword, lead capture into email or a CRM, tags/fields/bot fields, or asks why a ManyChat publish was refused, why a message never sent, or why the wrong flow fired. Carries the comment-reply rules that decide the shape of every comment-triggered flow, the server-vs-client validation ledger, Meta's messaging-window and trigger-precedence rules, and the draft-first policy.
---

# ManyChat automation specialist

You build ManyChat automations through **`uxie-manychat-mcp`** — the plugin's local MCP server over
ManyChat's own internal API. The public ManyChat API cannot build flows at all; the internal rail
can, and this server wraps it with the validation ledger, the multi-call trigger dances and a
read-back on every write.

**Not connected?** `auth_status` says so. Run `/uxie-manychat-factory:manychat-connect` (it harvests the
browser session; only a lapsed login needs the user). Never ask the user to paste a cookie.

## Before you design: say what the platform will not do

Some of what callers ask for cannot be built, and ManyChat reports no error when you build it
anyway — it publishes, lays out, and silently never sends. **A design that contains one of these is
wrong no matter how good the rest of it is**, so check the request against this table *first* and
open with what has to change:

| The request | What actually happens | What to design instead |
|---|---|---|
| "DM them again in 2 days" / "next week" / "if they haven't clicked" | A `delay` past **24 hours** from the contact's last interaction never delivers. Meta's messaging window; ManyChat blocks the send. No error, anywhere. | Capture the email, `external_request` to the CRM, follow up **there** |
| "Use the Human Agent tag so we can message later" | API-blocked for automation; policy violation | A human sends it from Live Chat, inside 7 days |
| "Run these 3 comment campaigns at once" | A contact gets **1 automated DM per 24h** across *all* comment/story triggers. The rest are dropped, not queued | Fine for distinct audiences; never a same-day double-touch |
| "Comment trigger on all posts" | On Instagram the **oldest** all-posts trigger wins, and a specific-post trigger beats any all-posts one. A forgotten legacy automation silently outranks your new flow | `list_triggers` first; retire or re-scope the old one |
| Keyword `love` / `call` / `info` / `guide` | Matches on `contains` — fires on ordinary comments that were never opt-ins | A deliberate, unlikely token |
| "Send them this image/PDF from a URL" | Refused: `Attachment without caid` | `upload_attachment` first, pass the returned object |

Nothing above is a judgement call you get to make differently on a given account. If the caller
wants it anyway, say plainly which part the platform refuses and where it has to move to instead —
**at design time, not after the build**. `references/delivery-rules.md` has the mechanics, the
confidence marks, and the audit that proves each one on a specific account.

## The things that decide every build

1. **A comment-triggered flow's first node is fixed by ManyChat, not by you.** With a comment or
   story trigger attached, the root must be `private_reply`, may not use "Next step", and must be
   **exactly one block with buttons or quick replies**. So every such flow opens with one message
   plus a button ("Send it to me"), and the real work — the email question, the tagging, the
   delivery — starts on the *next* node. Design it that way from the start; it is not a detail you
   can retrofit. In a `build_flow` spec that is `"private_reply": true` on the root node.
2. **Draft-first, and nothing goes live by itself.** Flows are published so links resolve, but a
   flow whose triggers are all `draft` sends nothing. `create_comment_trigger` and
   `create_dm_keyword` always end in draft. Only `set_trigger_status` with `confirm:true` makes a
   trigger live, and only when the user asked for it **in that session**.
3. **Publish reports ONE error per call.** So never publish to discover problems — `check_flow` and
   the ledger inside `build_flow` / `edit_flow` / `publish_flow` report every problem at once, keyed
   by caption, with ManyChat's exact string.
4. **The ledger blocks on any rule whose string is known**, whether ManyChat's server enforces it or
   only its builder does. A builder-only rule still matters: **Instagram's DM limit is 1000
   characters**, and the API happily stores a longer one (up to the server's own 2000) before the
   channel refuses it at send time. If a caller genuinely wants a node the builder will mark broken,
   that is `allowUiWarnings: true` — an explicit choice, never a default, and it never demotes a
   server rule.
5. **ManyChat will not send an image it did not store.** A URL image is refused with
   `Attachment without caid` in every form, including the `external_image` shape ManyChat's own
   code emits. Upload first with `upload_attachment`, then pass the returned object as the block's
   `data` or the card's `image`. (A dynamic block's `payload` has a matching trap: it must be a JSON
   **string**, not an object.)
6. **Never re-use a node `_oid`.** Re-used ids across publishes corrupt a flow permanently: the
   builder still renders it but any full republish (including `layout_flow`) fails with
   `Something went wrong`. `build_flow` mints fresh ids for you; if you hand-write batches, do too.
7. **Publishing is not delivering.** The ledger proves a flow will publish; it says nothing about
   whether a human ever receives it. Messaging windows, the per-contact DM cap and trigger
   precedence all fail *after* a clean 200 — that is what the table above and
   `references/delivery-rules.md` exist for. A build you validated but did not check against them
   is not finished.

## Tool routing

| You want to | Call |
|---|---|
| See what exists | `list_flows`, `get_flow`, `list_triggers`, `list_tags`, `list_fields`, `list_bot_fields` |
| Build a new automation | `build_flow` (spec → compile → ledger → create → publish → read back) |
| Check before sending | `check_flow`, or `build_flow` with `dryRun:true` |
| Change a published flow | **`edit_flow`** with caption-addressed ops — never hand-edit node JSON |
| Add an image, video, gif, pdf or audio | `upload_attachment` first (pass `node` so it carries the right `dest`), then reference the returned object |
| Find a sequence id | `list_sequences` — or address the sequence by name and let `build_flow` resolve it |
| Change a flow the ops cannot express | `get_flow` → edit `batchForResend` → `publish_flow` (upsert by `_oid`; unmentioned nodes survive) |
| Work in progress | `set_flow_draft` (replaces the draft) / `patch_flow_draft` (merges) → `publish_flow` → or `discard_flow_changes` |
| Tidy the canvas | `layout_flow` |
| Attach triggers | `create_comment_trigger`, `create_dm_keyword` (both end in draft) |
| Go live | `set_trigger_status` + `confirm:true` + the user's word |
| Contacts | public rail: `find_contact`, `get_contact`, `tag_contact`, `set_contact_field` |
| Anything else | `search_endpoints` → `describe_endpoint` → `raw_request` |

## References

| File | Answers |
|---|---|
| `references/flow-spec.md` | `build_flow`'s spec format, every node and action type, a worked lead-capture example, and the `edit_flow` ops |
| `references/validation-ledger.md` | Every rule that decides **will this publish** — which layer enforces it and ManyChat's exact string. `check_flow` with `rules:true` returns the same table live |
| `references/delivery-rules.md` | Every rule that decides **will this actually be delivered** — messaging windows, DM Lists, rate and frequency caps, trigger precedence, keyword choice, the compliance floor, and the pre-build audit |
| `references/account-architecture.md` | How to keep an account legible — hub-and-spoke, bot fields as the config layer, tags vs fields, naming, where follow-up lives, handover |

Read `delivery-rules.md` before designing anything with a follow-up, a second campaign, or a
trigger on an account you have not audited this session. It is the file that stops you shipping a
flow that publishes cleanly and never sends.

## How to run a build

1. **Recon first** — `auth_status`, `list_flows`, **`list_triggers`**, `list_tags`, `list_fields`,
   `list_bot_fields`. Never invent a tag or field name: `build_flow` resolves names to ids and
   refuses unknown ones, and ManyChat refuses trigger auto-tags in `add_tag` with `Wrong tag`.
   `list_triggers` is not optional — it is how you find the live legacy trigger that will outrank
   what you are about to build (`references/delivery-rules.md` §7 is the full audit).

   **Any design you hand back opens with two things, before the first node:** what the audit found
   (what is already live, what collides), and which requested behaviours the platform refuses —
   from the table above — with where each one moves to instead. If the answer to both is "nothing",
   say that. A design whose first section is a node diagram skipped this step.
2. **Create the objects the flow needs** (`create_tag`, `create_field`, `create_bot_field`) before
   compiling. Put every URL in a **bot field** and reference it as `{{bot:Name}}` — then changing a
   link is one `set_bot_field_value` call, not an edit to every flow.
3. **Write the spec** (`references/flow-spec.md`), run `build_flow` with `dryRun:true`, read the
   ledger, fix, then run it for real.
   *Changing something that already exists?* Use `edit_flow`, which takes operations addressed by
   caption (`set_text`, `add_button`, `set_next`, `add_node`, `remove_node` with a rewire target,
   `set_conditions`, …), runs the same ledger, republishes as an upsert and verifies. `dryRun:true`
   shows the resulting batch without sending. `relayout:true` re-runs the canvas layout, which
   nodes added by an edit need — they otherwise stack at the origin.
4. **`layout_flow`** so a human can read the canvas.
5. **Attach triggers** — draft.
6. **Hand over**: name the flow ns, the trigger ids, and say plainly that nothing is live and what
   the one call to make it live is. Do not make it live yourself unless asked.

## Safety

- **Never delete.** Not a flow, not a tag, not a field, not a trigger. Leave probe objects named
  `TEST-CAP-*` and list them by id at the end. `create_comment_trigger` also mints a throw-away
  "Opt-In Message" flow per call — it is returned in `leftovers`; list it, do not remove it.
- **Never send to a real person** without being asked: no `send_flow`, no preview
  (`content/createPreview`), no `followReply/switch`. All are outward-facing.
- **Never print** a cookie, a CSRF token or an API key. The server redacts them; do not defeat it
  by echoing raw responses you fetched another way.
- **A 200 is not proof.** Every write tool here reads back on a separate request and returns a
  `verify` block — quote it rather than the fact the call succeeded.

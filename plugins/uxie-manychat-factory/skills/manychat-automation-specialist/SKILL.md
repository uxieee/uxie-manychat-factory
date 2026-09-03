---
name: manychat-automation-specialist
description: Design, build, publish, lay out and (only on the user's word) activate ManyChat Instagram automations through the uxie-manychat-mcp server. Use when the user wants a ManyChat flow, comment trigger ("comment WIZARD and I'll DM you"), DM keyword, lead capture into email or a CRM, tags/fields/bot fields, or asks why a ManyChat publish was refused. Carries the comment-reply rules that decide the shape of every comment-triggered flow, the server-vs-client validation ledger, and the draft-first policy.
---

# ManyChat automation specialist

You build ManyChat automations through **`uxie-manychat-mcp`** — the plugin's local MCP server over
ManyChat's own internal API. The public ManyChat API cannot build flows at all; the internal rail
can, and this server wraps it with the validation ledger, the multi-call trigger dances and a
read-back on every write.

**Not connected?** `auth_status` says so. Run `/uxie-manychat-factory:manychat-connect` (it harvests the
browser session; only a lapsed login needs the user). Never ask the user to paste a cookie.

## The five things that decide every build

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
   only its builder does. A builder-only rule still matters: the API stores a 1500-character
   Instagram message and the channel then refuses it at send time. If a caller genuinely wants a
   node the builder will mark broken, that is `allowUiWarnings: true` — an explicit choice, never a
   default, and it never demotes a server rule.
5. **ManyChat will not send an image it did not store.** A URL image is refused with
   `Attachment without caid` in every form, including the `external_image` shape ManyChat's own
   code emits. Upload first with `upload_attachment`, then pass the returned object as the block's
   `data` or the card's `image`. (A dynamic block's `payload` has a matching trap: it must be a JSON
   **string**, not an object.)
6. **Never re-use a node `_oid`.** Re-used ids across publishes corrupt a flow permanently: the
   builder still renders it but any full republish (including `layout_flow`) fails with
   `Something went wrong`. `build_flow` mints fresh ids for you; if you hand-write batches, do too.

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

`build_flow`'s spec format, every node and action type, and a worked lead-capture example are in
`references/flow-spec.md`. The full validation ledger — every rule, which layer enforces it and the
exact string — is in `references/validation-ledger.md`; `check_flow` with `rules:true` returns the
same table live.

## How to run a build

1. **Recon first.** `list_flows` and `list_tags`/`list_fields`/`list_bot_fields`. Never invent a tag
   or field name: `build_flow` resolves names to ids and refuses unknown ones, and ManyChat refuses
   trigger auto-tags in `add_tag` with `Wrong tag`.
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

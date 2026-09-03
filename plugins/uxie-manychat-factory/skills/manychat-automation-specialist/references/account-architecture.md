# Account architecture — how to build a ManyChat account that stays legible

ManyChat has **no version control**: no diff, no history, no rollback. Nothing warns you that two
flows do the same job, that a tag is orphaned, or that a trigger has been dead for a year. The only
thing standing between an account and entropy is convention applied from the first object.

Apply these on a new account. On an existing one, propose them and let the operator decide —
renaming is cheap, but it is still someone else's account.

---

## 1. Hub and spoke — the shape that survives

The default structure for any campaign family with more than one entry point:

```
Acme Entry · WIZARD        3 nodes   private_reply → stamp tags/fields → goto Core
Acme Entry · MARRIAGE      3 nodes   private_reply → stamp tags/fields → goto Core
Acme Entry · REAL ESTATE   3 nodes   private_reply → stamp tags/fields → goto Core
                                          ↓
Acme Core · Lead Capture & Deliver   ~10 nodes   condition → ask email → sync → deliver
```

**Entry flows are thin and dumb.** One per keyword. They do exactly three things: satisfy the
comment-reply root rule, stamp *which* keyword brought this contact in, and `goto` the core.

**The core flow is thick and single.** Email capture, validation, CRM sync, delivery, fallbacks —
written once.

**Why it matters:** changing the email question, the CRM payload, or the delivery copy is one edit
instead of N. Adding a fifth campaign is a 3-node flow, not a copy-paste of 10 nodes that will
drift out of sync within a month.

**When not to use it:** a genuinely standalone automation with one entry point and no shared
downstream (a booking-link reply, an FAQ responder). Do not build a hub for a single spoke.

---

## 2. Bot fields are the configuration layer

**Every URL, price, date, and piece of copy that might change goes in a bot field**, referenced as
`{{bot:Name}}`. Never inline a URL in a message.

```jsonc
// the flow references this — forever
{ "text": "Here it is 👉 {{bot:Offer URL - Wizard}}" }
```

Changing the destination is then one `set_bot_field_value` call. Inlined, it is an `edit_flow`
against every node that mentions it, on every flow, and you *will* miss one.

Name them for what they configure, not where they are used:
`Offer URL - Wizard`, `GHL Inbound Webhook URL`, `Booking Link`, `Support Email`.

**Placeholder discipline:** when a real value is not known yet, write an obviously fake one —
`https://REPLACE-ME.example/...` — never a plausible-looking guess. A placeholder that looks real
ships to production. Then list every placeholder in the handover so the operator knows exactly what
blocks go-live.

---

## 3. Tags vs custom fields — the dividing line

The distinction is not stylistic; ManyChat filters them differently.

| | Tags | Custom fields |
|---|---|---|
| Filter operators | `is` / `isn't` only | `contains`, `>`, `<`, `before`, `after`, `has value`… |
| Can be shown in a message | No | Yes, via `{{field:Name}}` |
| Good for | binary membership: *is this person in bucket X?* | values: *what is this person's X?* |

**The test:** if you would ever want to print it in a message, compare it, or ask "how long ago" —
it is a **field**. If you only need yes/no — it is a **tag**.

Common mistake: a tag per interest *and* a field holding the interest. That is fine and often
correct — the tag drives segmentation and broadcasts, the field drives message personalisation and
the CRM payload. What is not fine is three tags encoding what one field should hold
(`Interest-A`, `Interest-B`, `Interest-C` when you also need to *display* the interest).

---

## 4. Naming

**One prefix scheme per account, chosen once.** The specific scheme matters far less than its
consistency. A workable default:

| Object | Pattern | Example |
|---|---|---|
| Entry flow | `<Brand> Entry · <KEYWORD>` | `Acme Entry · WIZARD` |
| Shared flow | `<Brand> Core · <purpose>` | `Acme Core · Lead Capture & Deliver` |
| Standalone flow | `<Brand> · <purpose>` | `Acme · Booking Link Reply` |
| Test / probe | `TEST-<label>` or `PROBE <date> <what>` | `PROBE 2026-09-03 sequence actions` |
| Custom field | `<Prefix> <Thing>` | `MC Interest`, `MC Lead Source` |
| Bot field | `<Thing> - <Variant>` | `Offer URL - Wizard` |
| Tag | one scheme — pick `Interest - X` **or** `Keyword: X` **or** `MC - X`, not all three | `Interest - Marriage` |
| Comment trigger | `<KEYWORD> — <scope>` | `WIZARD — comment on any post or reel` |

**Fill in the description field** on every custom field and bot field. It is the only place an
account explains itself, it costs one line, and it is the difference between an account a stranger
can pick up and one they have to reverse-engineer.

**Sticky notes (`type: "note"`) carry the *why*.** Flow structure shows what happens; a note next
to a condition explaining *why the branch exists* is the closest thing ManyChat has to a commit
message. Use them on anything non-obvious.

### Auto-generated names are a smell
ManyChat's stock templates and trigger creation mint objects like
`link_clicked (2026-08-30 18:59:04)`, `email address & first name collected`, and
`Post or Reel Comments #7 Opt-In Message`. They are harmless but they crowd out the real system.
Leave them (see §6) — just never let one become load-bearing.

---

## 5. Where follow-up lives

ManyChat is the **capture and delivery** layer, not the nurture layer. The 24-hour window
(`delivery-rules.md` §1) makes that architectural, not a preference.

```
Instagram comment  →  ManyChat  →  email/phone captured  →  external_request  →  CRM
                      (seconds)                                                  (days, weeks)
```

Everything past the first conversation — nurture, reminders, re-engagement, long sequences — runs
in the CRM, where there is no messaging window. Design the handoff early: one `external_request`
to a webhook held in a bot field, with a payload carrying enough to be useful.

```jsonc
{ "external_request": { "url": "{{bot:GHL Inbound Webhook URL}}", "method": "POST",
    "headers": { "Content-Type": "application/json" },
    "payload": { "first_name": "{{first_name}}", "email": "{{email}}",
                 "instagram_username": "{{ig_username}}",
                 "interest": "{{field:MC Interest}}",
                 "lead_source": "{{field:MC Lead Source}}" } } }
```

Stamp a lead-source field on every path so the CRM can tell an Instagram lead from a form fill.

**ManyChat sequences** still earn their place for short in-window drips and for anything that must
stay in the DM channel — but they cannot outrun the 24-hour window either.

---

## 6. Test debris, and the rule about deletion

**Never delete anything** — not a flow, tag, field, trigger, or sequence, including probes you
created yourself. Deletion in ManyChat is unrecoverable and you cannot see what a tag is wired into
before it is gone.

Instead:

- **Prefix probes at creation** (`TEST-…`, `PROBE <date> …`) so they are filterable forever.
- **Move them to a folder** rather than removing them.
- **List them by id in the handover** so the operator can prune deliberately if they choose.
- `create_comment_trigger` mints a throwaway "Opt-In Message" flow per call — it comes back in
  `leftovers`. Report it; leave it.

---

## 7. Handover

A build is not finished when it publishes. Finish by stating, in plain terms:

1. **Flow ns and trigger ids** for everything created.
2. **What is live and what is not** — and that nothing was activated, because it wasn't.
3. **The one call that makes it live**, per trigger: `set_trigger_status` + `confirm:true`.
4. **Every placeholder** still holding a fake value, and what blocks go-live.
5. **Anything the platform refused to do** and where it went instead (usually: follow-up → CRM).
6. **Leftovers and probes**, by id.

Quote the `verify` block, not the fact that a call returned 200.

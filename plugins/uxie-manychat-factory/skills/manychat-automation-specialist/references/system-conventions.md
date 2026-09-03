# ManyChat system conventions

How the operator builds in ManyChat. Account-agnostic: no agency, client or persona names
live here. Anything client-specific — persona, business name, prices, links, cadences, copy —
is per-build data, not a convention.

This file decides what a design **looks like**: its shape, its names, where data lives, the
gates it passes through. It does not build. `flow-spec.md` is how you express a build,
`validation-ledger.md` is what publishes, `delivery-rules.md` is what actually sends.

It assumes the plugin is installed — the `uxie-manychat-mcp` tools are the hands, and the
account is readable. There is no standalone mode.

**When you cannot verify a mechanic, say so.** Never fill the gap with web knowledge.
ManyChat's public article layer is thin and largely restatement; it has no equivalent of a
proven corpus, and the practitioner layer publishes tutorials rather than standards. The
ledger, the delivery rules, and the live account are the only things that count as evidence.

---

## Before you answer anything: recon

**Never respond to a build question cold.** Look first, then talk. A reply that arrives
instantly was written from assumptions, and the operator can tell — the fastest way to lose
their confidence is to ask them something the account would have told you.

Recon is **silent and read-only**. Don't narrate each call or ask permission to look. Go, then
come back with what you found.

```
auth_status        right account? which channels are actually active?
list_flows         what exists, what reports anyActive, what is orphaned
list_triggers      what is LIVE, what collides, what is half-live      ← never skip
list_tags          the existing taxonomy, and the auto-generated debris
list_fields        what already holds the value you were about to invent
list_bot_fields    what config exists, and which values are still placeholders
list_sequences     what drips exist
```

`list_triggers` is the one people skip and the one that bites. It is how you find the live
legacy automation that will outrank the flow you are about to build, and how you spot a
half-live flow (comment widget `draft` while its DM keyword rule is `live`). Read
`delivery-rules.md` §4 before interpreting it.

Then look at **the client folder on disk** — briefs, prior audits, design docs, handoffs. Half
the questions you were about to ask are usually answered in a file from three weeks ago.

Then respond, leading with what you found, asking only what recon genuinely could not answer.

---

## The meta-rule: guide the operator to a plan, don't hand them one

Your job is to walk the operator to a design **they have agreed to, one decision at a time**.
It is not to produce a finished system in your first reply. A complete build proposal that
arrives before the business is understood looks impressive while resting on facts nobody
established.

### 1. Know the business before you design anything

"Coach selling a course on Instagram" is a vertical. It is not a brief. What you typically
need before the first structural decision:

- **The offer** — what is being advertised, at what price, and is it the real product or a
  front end into something bigger?
- **The entry points** — comment keyword, DM keyword, story reply, ads, link in bio? Each is
  a different trigger with different rules.
- **What is captured** — email? phone? nothing? This decides whether there is a handoff at all.
- **What happens after the DM** — does the lead go to a CRM, a checkout, a calendar, or
  nowhere? Anything past 24 hours is not ManyChat's job (see the wall, below).
- **What already exists** — flows, triggers, tags, and especially anything still live from a
  previous build or a stock template.
- **Volume** — comment volume decides whether rate ceilings matter.

Ask for what's missing in one batch they can answer in a single pass, grouped by topic, and
say why each one changes the build. Every question in it should have survived recon.

### 2. Move one layer at a time, and stop at each

1. **Business and offer** — confirmed in their words, before anything structural.
2. **The entry map** — which keywords, on which surfaces, and what each one promises. Agree
   this before flows exist, because entry points decide how many flows there are.
3. **The flow list** — names and one-line jobs only. No nodes, no copy.
4. **Each flow in detail, one at a time** — nodes, conditions, actions, exits.
5. **Copy** — once the structure is settled.
6. **The pre-build document** — the whole agreed design in one file, approved before anything
   is created. Say from the first reply that this is where the design lands, so nobody expects
   a build to start from a chat.

Present a layer, give reasoning and a recommendation, then stop.

### 3. Gaps

- If two different answers produce **two different builds**, that's a design question — ask.
- If it's a missing value (a link, a price), collect it. Never guess, and never let a
  placeholder reach a live flow.

---

## Hard rules

**Structure**

- **No emoji in any ManyChat object name** — flows, folders, tags, fields, bot fields.
  Emoji in customer-facing DM copy is fine and often right; in a name it is noise that breaks
  sorting and search.
- **Every object lives in a folder.** Folders exist for flows, tags, custom fields and bot
  fields, and they are the only organisational primitive ManyChat gives you. An object at the
  root is an object nobody will find in six months.
- **Each distinct journey gets its own entry flow.** Don't bolt a second keyword onto an
  existing flow's root — the comment-reply root rule makes that impossible to do cleanly
  anyway.
- **Shared logic lives in one core flow**, reached by `goto`. See Modular Flow Design.
- **Triggers ship draft. Always.** Live is a separate, deliberate call, made only when the
  operator asks for it in that session.
- **Escalation never dead-ends.** If a contact asks for a human, prove a human is actually
  told — `notify_admin`, an assigned conversation, or an alert into the CRM. "Someone will get
  back to you" with nobody notified is a defect.
- **Never delete anything.** Not a flow, tag, field, trigger or sequence — including probes
  you created. Deletion is unrecoverable and you cannot see what a tag is wired into before
  it's gone. Retire instead: `X ` prefix, move to `Archive`, stop writing to it.
- **Test objects say TEST in the name** and live in the `TEST` folder.
- **Sticky notes carry the *why*.** ManyChat has no version control — no history, no diff, no
  rollback — so a `note` node beside a condition explaining why the branch exists is the
  closest thing the platform has to a commit message. Use one on anything non-obvious. The
  canvas shows what happens; the note is the only place that records what it was for.

**Copy**

- **No em dashes** in anything a contact can see. The rule exists so customer-facing writing
  doesn't read as machine-written.
- **1000 characters hard on Instagram.** The API stores up to 2000 and the channel then
  refuses the send. Write short.
- **Every automated DM carries a visible opt-out** — "Reply STOP" or equivalent.
- **It has to read like a human wrote it.** If only an AI would phrase it that way, rewrite it.
- **Emoji are welcome in DM copy.** This is Instagram, not an SMS ladder. Use them the way the
  client's own audience does, not as decoration.

---

## Folders

Five top-level folders. Same five on every account, so any account is navigable on sight.

| Folder | Holds |
|---|---|
| `Entry` | One thin flow per entry point (keyword, story reply, ad) |
| `Core` | Shared flows that entry flows `goto` — capture, delivery, routing |
| `Utility` | Default reply, opt-out handler, admin/internal tools |
| `Archive` | Retired flows, `X ` prefixed. Nothing here is live |
| `TEST` | Probes and capture tests. Never load-bearing |

Tags, custom fields and bot fields get folders too — group by purpose (`Lead Data`,
`Delivery`, `Config`), not by the flow that writes them, since more than one flow usually will.

`create_flow`, `create_field`, `create_bot_field` and `build_flow` all take a `path`
parameter. Set it at creation; moving things later is manual work in the UI.

---

## Naming

**Flows** — `<Class> · <Name>`, inside the matching folder.

```
Entry   · WIZARD                    keyword in CAPS, matching the trigger
Entry   · MARRIAGE
Core    · Lead Capture & Deliver    Title Case, describes the job
Utility · Default Reply
X Old Tutorial Flow                 retired, in Archive
TEST-CAP-01                         probe, in TEST
```

No numbers. ManyChat is not one journey — it is entry points plus shared cores, so numbering
order is arbitrary and every new keyword forces a renumber. The folder carries the class and
the name carries the job.

**Tags** — `namespace:value`, lowercase, hyphens inside multi-word values.

ManyChat does **not** normalise tag case on write. `Interest - Marriage` and
`interest - marriage` are two different tags and both will exist within a month. Lowercase
`namespace:value` removes the ambiguity entirely.

```
interest:marriage          interest:real-estate
state:guide-delivered      state:nudge-sent      state:opted-out
source:instagram-comment   source:story-reply
```

**Custom fields** — human-readable Title Case. ManyChat has no separate key; the merge tag is
numeric (`{{cuf_14928265}}`), so the caption exists purely for the human picking it from a
list. That also means **renaming a field is safe and cheap** — nothing references the string.

**Never create a custom field for something that is already a system field.** `email`, `phone`,
`first_name`, `last_name`, `ig_username` and the rest are built in: capture with
`save_to: "email"`, read with `{{email}}`, branch with `{"system_field": "email"}`. A custom
`Lead Email` sitting beside the system one is two sources of truth, only one of which the
question node and the native integrations write to. `flow-spec.md` lists the system merge tags;
`validation-ledger.md` lists the full `SYSTEM_FIELDS` enum.

```
Interest          Lead Source          Last Keyword          Offer URL Delivered
```

A prefix like `MC ` is only worth carrying when the field name travels somewhere else — into a
CRM payload where "which system set this" matters. Inside ManyChat it is noise. Decide once
per account and be consistent.

**Bot fields** — `<Thing> - <Variant>`, Title Case. These are referenced by name in specs
(`{{bot:Offer URL - Wizard}}`), so they have to read well.

```
Offer URL - Wizard          Booking Link          GHL Inbound Webhook URL
```

**Triggers** — `<KEYWORD> — <surface and scope>`, so the trigger list is readable without
opening anything.

```
WIZARD — comment on any post or reel
WIZARD — DM keyword
```

**Every field and bot field gets a real description.** It is the only place an account explains
itself, it costs one line, and it is the difference between an account a stranger can pick up
and one they have to reverse-engineer.

---

## Tags, fields, and bot fields — where data lives

The area with the most room to get wrong. Take the first "yes":

1. **Is it the same for every contact on the account?** → **bot field**.
   Links, webhook URLs, prices, promo names, support email. Config, not data.
2. **Is it one-of-N, a number, a date, or something you will print in a message or send in a
   webhook payload?** → **custom field**.
   A field holds one value, so mutual exclusion is enforced by the data structure instead of by
   every flow remembering to remove three other tags.
3. **Does it only need to exist during one flow run?** → **don't persist it.**
   Use a condition or a branch. A tag added at node 3 and removed at node 9 of the same flow is
   usually a node you didn't need.
4. **Is it a durable yes/no you will segment or broadcast on?** → **tag**.
5. Otherwise → nothing.

**The sharpest test: if a tag's name contains a number, a date, or a category, it wants to be a
custom field.** `link_clicked (2026-08-30 18:59:04)` is a date field wearing a tag's clothes.

### Tags are deliberate

Every tag needs a named **applier**, a named **remover** (or "permanent"), and **at least one
consumer**. A tag nothing reads is a defect. So is a tag that says the same thing a field
already says — now there are two sources of truth and they will drift.

### The one legitimate duplication

A tag and a field may hold the same fact **only when they have different consumers**:

- the **tag** is what ManyChat's own audience filters and broadcasts can select on
- the **field** is what you print in a message and put in the CRM payload

When both are genuinely needed, write them **in the same action group** so they cannot drift:

```jsonc
{ "caption": "Stamp", "type": "actions", "actions": [
    { "add_tag": "interest:marriage" },
    { "set_field": { "field": "Interest", "value": "Marriage" } }
] }
```

One tag plus one field. Never three. If you only ever need the CRM payload, drop the tag. If
you only ever segment, drop the field.

### A starting taxonomy

| Namespace | Class | Lifecycle |
|---|---|---|
| `interest:<x>` | what they asked for | permanent, one per contact in practice |
| `state:<x>` | a lifecycle fact that has happened | permanent once set (`state:guide-delivered`) |
| `source:<x>` | which surface they arrived on | permanent |
| `optout` → `state:opted-out` | suppression, human-visible | permanent |

Avoid a `keyword:` namespace. Which keyword someone used is a *value* — it belongs in a
`Last Keyword` field — unless you can name a broadcast that actually segments on it.

### Anti-patterns, worst first

| ❌ | ✅ |
|---|---|
| A tag per value of one attribute (`interest:a`, `interest:b`, `interest:c`) *and* no field | One field holding the value; add tags only if you broadcast by them |
| A field you only ever test with `HAS_VALUE` | A tag |
| A tag and a field with identical meaning and no separate consumer | Pick one |
| A timestamp or count in a tag name | A date or number field |
| Creating an object because it "feels needed" | Create it when a specific node reads it |
| Inventing a name recon would have found | Reuse. `build_flow` refuses unknown names anyway |
| Letting a ManyChat auto-generated tag become load-bearing | Leave them; never wire them. Trigger auto-tags are refused by `add_tag` with `Wrong tag` |

### Placeholders

When a real value isn't known, write an obviously fake one — `https://REPLACE-ME.example/...`
— never a plausible guess, which ships to production. List every placeholder in the handover
as a go-live blocker.

---

## Modular Flow Design

ManyChat's own recommended pattern, and the industry term: break a system into small
interconnected flows rather than one large one. There is no subroutine in ManyChat — the only
reuse mechanisms are the **Start Automation** action (`start_flow`) and the **Go-To** node
(`goto`).

The default shape:

```
Entry · WIZARD          3 nodes    private_reply → stamp tags/fields → goto Core
Entry · MARRIAGE        3 nodes    private_reply → stamp tags/fields → goto Core
Entry · REAL ESTATE     3 nodes    private_reply → stamp tags/fields → goto Core
                                          ↓
Core · Lead Capture & Deliver     ~10 nodes    condition → ask email → sync → deliver
```

**Entry flows are thin and dumb.** One per entry point. They do three things: satisfy the
comment-reply root rule, stamp which keyword brought the contact in, and hand off.

**The core flow is thick and single.** Capture, validation, CRM sync, delivery, fallbacks —
written once. Changing the email question is one edit, not N.

**When not to use it:** a genuinely standalone automation with one entry point and no shared
downstream — a booking-link reply, an FAQ responder. Don't build a hub for a single spoke.

**Every flow declares its exits.** Which flows remove a contact from which, and what stops a
sequence. A contact who has converted must not keep getting chased.

---

## The 24-hour wall, and where follow-up lives

The defining architectural constraint, and the reason this section replaces anything resembling
a pipeline. Full mechanics in `delivery-rules.md`; the design consequence is here.

**Nothing automated reaches a contact more than 24 hours after their last interaction.** A
`delay` crossing that window publishes, lays out, reports nothing, and never sends.

So a build declares its shape up front, and there are two legitimate ones:

### ManyChat-only build

Everything finishes inside the first conversation. Comment → DM → link. No capture, or capture
that goes nowhere but ManyChat's own contact record.

Correct for: link delivery, booking-link replies, FAQ responders, story-reply automations,
list growth where ManyChat's own broadcasts are the follow-up channel.

Say plainly that there is no follow-up beyond the conversation, so nobody expects one.

### Handoff build

ManyChat captures, an external CRM nurtures. One `external_request` posts the lead out the
moment it is captured.

```
Instagram comment → ManyChat → email captured → external_request → CRM
                    (seconds)                                      (days, weeks)
```

```jsonc
{ "external_request": { "url": "{{bot:GHL Inbound Webhook URL}}", "method": "POST",
    "headers": { "Content-Type": "application/json" },
    "payload": { "first_name": "{{first_name}}", "email": "{{email}}",
                 "instagram_username": "{{ig_username}}",
                 "interest": "{{field:Interest}}",
                 "lead_source": "{{field:Lead Source}}" } } }
```

Stamp a lead-source field on every path so the CRM can tell an Instagram lead from a form fill.
Hold the endpoint in a bot field so it is one call to change.

**ManyChat sequences** are still right for short in-window drips and anything that must stay in
the DM channel. They cannot outrun the window either.

---

## Triggers

- **Draft on creation, always.** `create_comment_trigger` and `create_dm_keyword` both end in
  draft. `set_trigger_status` + `confirm:true` + the operator's word, in that session.
- **Audit precedence before designing.** On Instagram the **oldest** all-posts trigger wins and
  a specific-post trigger beats any all-posts one — so a forgotten legacy automation silently
  outranks new work. Facebook is the opposite. `delivery-rules.md` §4.
- **Pair the surfaces deliberately.** A keyword usually deserves both a comment trigger and a
  DM keyword, so someone who DMs the word directly gets the same flow. Ship them together or
  say why not — a half-live pair is the most common broken state on a real account.
- **Pick keywords nobody types by accident.** Matching is `contains`. `love`, `call`, `info`
  and `guide` will fire on ordinary comments that were never opt-ins.
- **Comment triggers need three unique public replies.** They are posted publicly under the
  commenter's comment, so they are client-facing copy and need sign-off like any other.
- `create_comment_trigger` mints a throwaway "Opt-In Message" flow per call, returned in
  `leftovers`. List it; leave it.

---

## Working with the operator

- **Recon before you speak.** Silent, read-only, every time.
- **They're in the planning loop, layer by layer.** Business, then entry map, then flow list,
  then each flow, stopping for their answer at each. They decide; you bring reasoning and a
  recommendation.
- **Nothing gets built until they say the design is good.**
- **Build one at a time** so they can check each, then `layout_flow` so the canvas is readable.
- **Default to drafts.** Publishing a flow is fine — it makes links resolve and sends nothing
  while triggers are draft. Activating a trigger is not, unless asked.
- **Verify against the live account.** Quote the `verify` block, not the fact a call returned
  200.
- **E2E test before launch** — a real, clearly-marked TEST contact through every entry point,
  walked all the way through, with the results written down. Never test on a real follower.
- **Every change set ships with a before/after and a report of what was actually done.**
- **Explain clearly.** Technical detail is fine; unexplained jargon isn't. Don't invent terms —
  if a word isn't ManyChat's own vocabulary, define it in plain language the first time.
- **Never delete anything of theirs.** Mark it and leave it.

---

## The pre-build document

Before anything is built, the operator reviews a **single self-contained HTML file**. It is the
approval artifact, not a report: they approve the diagrams, and building becomes transcription.

Format, sidebar, theming, mermaid re-render on theme change, click-to-enlarge diagrams and the
copy-appendix idiom are all specified in `prebuild-doc-spec.md`. The ManyChat sections differ
from the GHL ones; the file mechanics do not.

---

## References

- `delivery-rules.md` — what actually sends: messaging windows, DM caps, trigger precedence.
- `validation-ledger.md` — what publishes: every rule and ManyChat's exact error string.
- `flow-spec.md` — how to express a build, every node and action type.
- `prebuild-doc-spec.md` — the approval document.

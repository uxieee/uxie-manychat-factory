# Delivery rules — what publishes cleanly and still never reaches a human

The validation ledger answers *"will this publish?"*. This file answers the other question:
**"will it actually be delivered?"** Everything here passes `flow/publish` with a 200 and then
fails, silently, at send time — or never fires at all because another trigger outranked it.

A flow that publishes is not a flow that works.

**Confidence marks** used below: **[MC]** ManyChat's own documentation · **[PROVEN]** verified
against a live account by this plugin · **[3P]** third-party 2026 reporting, corroborated across
at least two independent sources but not confirmed in Meta's own docs.

---

## 1. The messaging windows — the rule that reshapes every follow-up

| Window | Opens | What may be sent |
|---|---|---|
| **24 hours** | The contact's last interaction (DM, comment, story reply). **Resets** on each new interaction. | Automations and manual messages, freely. |
| **+7 days** | After the 24h window closes. | **Manual Inbox messages only.** Automations will not deliver. |
| After 7 days | — | Nothing, without an approved exception (§2). |

**[MC] ManyChat blocks the send itself.** If a contact falls outside the 24-hour window and a
message is scheduled for them, ManyChat prevents it from being sent. You do not get an error at
build time, at publish time, or at run time that a caller would notice — the step simply does not
deliver.

### The consequence, stated plainly

> **A `delay` node whose total elapsed time can exceed 24 hours from the contact's last
> interaction is a dead branch.** It publishes. It lays out. It reports no error. It never sends.

This is the single most common way a correct-looking ManyChat build fails in production.

**When a caller asks for "follow up in 2 days" / "nudge them next week" / "check in after a
month" — that is not a ManyChat delay node.** Say so before designing it. The options are:

| Want | Correct mechanism |
|---|---|
| Follow up < 24h after last interaction | `delay` node inside the flow — fine |
| Follow up later, contact gave an email/phone | **Hand off to the CRM/ESP** and follow up there. This is what the `external_request` → webhook pattern exists for. |
| Follow up later, no email captured | A human sends it from Live Chat inside the 7-day window (§3), or it does not happen |
| Re-engage at scale | An opt-in DM List — if the account has one (§2) |

**The Human Agent tag is not an escape hatch.** [MC] ManyChat applies it automatically to messages
a human sends from Live Chat. Applying it to automated sends is blocked by the API and is a Meta
policy violation. Never design around it.

---

## 2. DM Lists — the only sanctioned way past 24 hours, and most accounts don't have it

[MC] Instagram DM Lists (formerly Recurring Notifications) let a contact **explicitly opt in** to
a named topic, after which you may message them outside the 24-hour window.

**[MC] Meta paused allowlisting for the Instagram DM List beta in February 2024.** Only accounts
approved before that pause have the feature. A new account cannot get it.

**Check before you promise it — never assume:**

```
raw_request GET /notificationReason/list
```

`{"reasons": [], "state": true}` means the account has **no** DM Lists, and therefore **no**
mechanism at all for an automated message outside 24 hours. [PROVEN 2026-09-04: returns empty on a
flex_trial Instagram account.]

If `reasons` is non-empty, the account has topics and outside-window sends become possible against
those specific topics.

---

## 3. Rate and frequency ceilings

| Limit | Value | Source |
|---|---|---|
| **Automated DMs per user per 24h from comment/story triggers** | **1** | [3P] new in 2026 |
| Private replies to post/reel comments | 750 / hour | [3P] |
| Instagram DM text length | **1000 characters** — the API stores more and the channel refuses at send | [PROVEN] |
| "~200 DMs/hour" | **Not a Meta limit.** A tool-side safety cap, widely misquoted | [3P] |

### The 1-DM-per-24h cap changes multi-campaign design

If an account runs several comment campaigns at once, a contact who comments on two different
posts within a day receives **one** DM, not two. The second is dropped.

**Design consequence:** you cannot use repeat comment engagement as a re-touch mechanism, and you
cannot assume a contact enrolled in campaign A will also receive campaign B's opener the same day.
Where two campaigns must both reach the same person, the second touch belongs in the CRM.

Rate limits apply **per Instagram account across every connected tool**, not per tool.

---

## 4. Trigger precedence — which flow actually fires

Attaching a trigger does not mean it wins. [MC], and **Instagram is the opposite of Facebook**:

| Situation | Winner |
|---|---|
| Specific-post trigger vs all-posts trigger | **Specific post**, both channels |
| Two all-posts triggers, neither using keywords — **Instagram** | **Oldest** (created first) |
| Two all-posts triggers, neither using keywords — **Facebook** | **Newest** (created last) |
| Triggers using *different* keywords | No conflict — each keyword fires its own flow |
| One comment containing **two** trigger keywords | **Only the first** keyword fires |

**Why this bites:** on Instagram, age wins. A forgotten stock automation or an abandoned test from
last year outranks the flow you just built, and nothing anywhere reports the conflict.

**Therefore `list_triggers` before you design, not after you build** — and read it for three
things, not one:

1. **What is already live.** `status: "active"` on a widget, `status: "live"` on a keyword rule.
   Legacy ManyChat "Quick Automation" templates are the usual culprits.
2. **Keyword collisions** against every trigger, live or draft.
3. **Half-live flows** — a flow whose comment widget is `draft` while its DM keyword rule is
   `live` (or the reverse) responds to one entry path and silently ignores the other. Almost never
   intentional.

---

## 5. Keyword selection

- **Pick words nobody types by accident.** A keyword matches on `contains` by default. `love` on
  a relationships account, `call` on any account ("can you call me back"), or `revenue` on a
  business account will fire constantly on comments that were never opt-ins. Prefer a deliberate
  token: `GUIDE`, `WIZARD`, `SEND ME X`.
- A comment with two keywords fires only the first — so overlapping keyword sets across campaigns
  produce arbitrary-looking behaviour.
- [MC] Case is handled for you; adding `wizard`, `Wizard` and `WIZARD` as separate keywords adds
  nothing and clutters the rule.
- Keyword limits: ≤ 12 per rule, ≤ 5 rules per keyword trigger (see the ledger).

---

## 6. Compliance floor

Enough to keep an account healthy; not legal advice.

- **Opt-out.** [3P] Every automated DM should carry a visible opt-out ("Reply STOP"). Meta App
  Review expects a documented mechanism.
- **Triggers must be user-initiated.** Comment keyword, story reply/mention, or inbound DM. Cold
  outreach to people who never engaged is a hard violation.
- **Professional account required** — Creator or Business. Personal accounts cannot connect.
- **[3P] Deprecated 2026-04-27:** the `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE` and
  `POST_PURCHASE_UPDATE` message tags now return error 100.
- **Penalty ladder:** feature restriction (hours–days) → temporary ban (24h–30d) → suspension
  (≤180d) → permanent. Most enforcement needs repeated violations, so a single mistake is
  recoverable — but the ladder is why "just try it and see" is a bad instinct on a client account.

---

## 7. Pre-build audit

Run this before designing anything on an account you have not built on this session. It is four
read-only calls and it catches every failure class above.

```
auth_status        # right account? which channels are actually active?
list_flows         # what exists; which flows report anyActive
list_triggers      # what is LIVE, what collides, what is half-live  (§4)
list_tags / list_fields / list_bot_fields    # never invent a name; build_flow refuses unknowns
```

Then, if any follow-up beyond 24 hours has been requested:

```
raw_request GET /notificationReason/list     # DM Lists — almost always empty  (§2)
```

Report what you find **before** proposing a design, and say plainly which requested behaviours the
platform will not do. A caller who hears "the 2-day nudge has to move to email" at design time is
being served. The same caller hearing it after the build shipped is not.

---

## 8. Quick reference — requests that need a redesign, not a build

| The caller asks for | What actually happens | Say instead |
|---|---|---|
| "DM them again in 2 days" | Delay node publishes, never delivers | Capture email → follow up from the CRM |
| "Nudge everyone who didn't click" | Same, plus click tracking is a separate problem | CRM, or same-session quick reply |
| "Run five comment campaigns at once" | A contact gets **one** DM per 24h across all of them | Fine for distinct audiences; not a re-touch strategy |
| "Use the Human Agent tag to follow up" | API-blocked, policy violation | Live Chat, by an actual human, inside 7 days |
| "Comment trigger on all posts" (account has old ones) | The **oldest** all-posts trigger wins on IG | Audit and retire the legacy trigger first |
| "Make the keyword `love`/`call`/`info`" | Fires on unrelated comments constantly | Pick a deliberate, unlikely token |

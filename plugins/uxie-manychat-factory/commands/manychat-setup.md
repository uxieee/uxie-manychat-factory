---
description: First-run setup for the ManyChat side of the plugin — prerequisites, the session capture, the optional public API key, the MCP connection test, and what each rail can and cannot do.
---

# /uxie-manychat-factory:manychat-setup

Run these in order and report a pass/fail table at the end.

1. **PREREQUISITES.** `node --version` ≥ 22.5 (the connect script reads Chrome's SQLite cookie store
   with `node:sqlite`). The **chrome-devtools MCP** must be available — its browser profile is where
   the user signs in to ManyChat. Say which features degrade without it: everything on the internal
   rail (flows, triggers, tags, fields); the public rail still works with a pasted key.

2. **TWO RAILS, TWO CREDENTIALS.**
   - *Internal rail* (`app.manychat.com`, the builder's own endpoints): a browser session, harvested
     by `/uxie-manychat-factory:manychat-connect`. This is the rail that builds, publishes and lays out
     flows and creates triggers. It is undocumented and off-ToS in the same sense as GHL's internal
     rail — draft-first, confirm-gated, nothing activates without the user's word.
   - *Public rail* (`api.manychat.com`, 34 documented operations): contacts, tags, fields, sending.
     Key from Settings → API in the account, format `<pageId>:<token>`. `manychat-connect` captures
     it automatically when the account has one; otherwise the user pastes it into
     `MANYCHAT_API_KEY` on the registration. It **cannot build flows**.

3. **CONNECT.** Run `/uxie-manychat-factory:manychat-connect` (launcher → session harvest → registration).

4. **CONNECTION TEST.** Call `auth_status` (both rails), then `list_flows` and confirm the account
   title and flow count match what the user expects. Failure → the error's `remediation` names the
   next step; do not retry blindly.

5. **WHAT TO READ NEXT.** Load the `manychat-automation-specialist` skill before designing or
   building anything — it carries the comment-reply rules, the draft-first policy, the spec format
   for `build_flow`, and a worked lead-capture example.

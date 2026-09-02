# uxie-manychat-factory

A plugin for building **ManyChat** Instagram automations from Claude Code or Codex — through
ManyChat's own builder API, the one its web app uses.

ManyChat's public API has 34 operations and **cannot build a flow**. Its internal API can, and this
plugin wraps it: a local MCP server (`uxie-manychat-mcp`, 32 tools over both rails), a command that
captures your browser session so you never handle a cookie, and a specialist skill that carries
ManyChat's own validation rules so you find out what is wrong *before* you publish.

| Component | Name | What it does |
|---|---|---|
| MCP server | `uxie-manychat-mcp` | 32 stdio tools. **Internal rail**: flows, nodes, publish, canvas layout, comment triggers, DM keywords, tags, contact fields, bot fields. **Public rail**: contacts, tags, fields, sending. Confirmation-gated writes, read-back verification on every one. See [`mcp-server/README.md`](plugins/uxie-manychat-factory/mcp-server/README.md) |
| Command | `/uxie-manychat-factory:manychat-connect` | Harvests the `app.manychat.com` session from your chrome-devtools browser profile into a `0600` file. You log in once; the agent never sees the cookie |
| Command | `/uxie-manychat-factory:manychat-setup` | First run: prerequisites, both credentials, connection test |
| Skill | `manychat-automation-specialist` | How to design and build: the comment-reply rules that dictate every comment-triggered flow's shape, the `build_flow` spec format, the full validation ledger, the draft-first policy |

## Install

**Claude Code**

```
/plugin marketplace add uxieee/uxie-manychat-factory
/plugin install uxie-manychat-factory@uxieee-manychat
```

Then `/uxie-manychat-factory:manychat-setup`.

**Codex** — Codex loads skills, not slash commands, so invoke the skill by name and configure the
MCP server yourself:

```
codex plugin marketplace add uxieee/uxie-manychat-factory
codex plugin add uxie-manychat-factory@uxieee-manychat
```

```toml
# ~/.codex/config.toml
[mcp_servers.uxie-manychat-mcp]
command = "node"
args = ["/Users/<you>/.uxie-manychat-mcp/launch.mjs"]
env = { MANYCHAT_SESSION_FILE = "/Users/<you>/.uxie-manychat-mcp/session.json" }
```

Run the connect script directly for the session:
`node <plugin>/mcp-server/scripts/connect.mjs`.

## Prerequisites

- **Node.js ≥ 22.5** — the connect script reads Chrome's cookie store with `node:sqlite`.
- **chrome-devtools MCP** — its browser profile is where you sign in to ManyChat. That profile runs
  with `--use-mock-keychain`, so reading its cookies raises no macOS Keychain prompt.
- **A ManyChat account you administer.** Sign-in is behind an AWS WAF image CAPTCHA; you pass it
  once, by hand, and the session then lasts ~30 days.

## The two rails

- **Internal** (`app.manychat.com`) — undocumented, and what the ManyChat web app itself calls. It
  is the only way to build flows. It can change without notice, and using it is outside ManyChat's
  published API terms in the same sense as any browser-session automation. Every write here is
  gated: nothing publishes without passing ManyChat's own rules, nothing activates without
  `confirm:true` **and** you asking for it in that session, and nothing is ever deleted.
- **Public** (`api.manychat.com`) — the documented 34 operations, Bearer key from Settings → API.
  Contacts, tags, fields, sending. No flow building.

## Safety model

- **Draft-first.** Flows publish so links resolve; triggers stay in `draft`, so nothing can fire.
  `set_trigger_status` is the only door to live, and it dry-runs by default, telling you exactly who
  would start entering the flow.
- **Read-back, not optimism.** Every write reads the object back on a separate request and returns a
  `verify` block. A 200 is not proof.
- **Nothing is deleted.** No tool deletes a flow, tag, field or trigger; `set_trigger_status`
  refuses `trash`/`deleted`. Probe objects are named and listed by id instead.
- **Credentials stay local.** The session file and API key live on your machine, are sent only to
  ManyChat, and are scrubbed out of every tool result and error.

## Repo layout

```
plugins/uxie-manychat-factory/
  mcp-server/        the MCP server (core/, catalog/, scripts/, test/, committed dist/ bundle)
  commands/          manychat-connect.md, manychat-setup.md
  skills/            manychat-automation-specialist/
scripts/             check-privacy.mjs, check-manifest-parity.mjs   (run before every release)
```

Two manifests ship over one tree — `.claude-plugin/plugin.json` (Claude Code) and
`.codex-plugin/plugin.json` (Codex). **Bump both**; each harness decides "is there an update?" by
version number alone, so a one-sided bump is invisible to the other forever.

## Where the shapes come from

Every wire shape is taken from ManyChat's own front-end — 12,197 TypeScript sources recovered from
its public source maps, plus live probe sessions — recorded in the `manychat-internal-api-research`
corpus. That corpus is the source of truth: when a tool proves it wrong, the corpus page is
corrected in the same change.

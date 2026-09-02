#!/usr/bin/env node
// Manifest parity gate: the plugin ships TWO manifests for one tree (.claude-plugin/plugin.json for
// Claude Code, .codex-plugin/plugin.json for Codex). Both harnesses decide "is there an update?" by
// VERSION NUMBER, so a release that bumps only one is invisible to the other forever. The GHL
// plugin learned this the hard way (six releases, two privacy scrubs, never delivered to Codex).
import { readFileSync } from 'node:fs';

const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const BASE = 'plugins/uxie-manychat-factory';
const claude = read(`${BASE}/.claude-plugin/plugin.json`);
const codex = read(`${BASE}/.codex-plugin/plugin.json`);
if (!claude || !codex) { console.error(`manifest parity: could not read both manifests under ${BASE}/ (run from the repo root)`); process.exit(1); }
const problems = [];
if (claude.version !== codex.version) problems.push(`version mismatch — claude=${claude.version} codex=${codex.version}`);
if (claude.name !== codex.name) problems.push(`name mismatch — claude=${claude.name} codex=${codex.name}`);
if (problems.length) { console.error('\nmanifest parity FAILED:\n'); for (const p of problems) console.error(`  ${p}`); console.error('\nBump BOTH manifests on every release.\n'); process.exit(1); }
console.log(`manifest parity: ok (both at ${claude.version})`);

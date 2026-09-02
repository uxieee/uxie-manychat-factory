import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'launch.mjs');
const fakeHome = (versions, marketplace = 'uxieee-manychat') => {
  const home = mkdtempSync(join(tmpdir(), 'mc-launcher-'));
  for (const [v, hasServer] of Object.entries(versions)) {
    const root = join(home, '.claude', 'plugins', 'cache', marketplace, 'uxie-manychat-factory', v);
    if (hasServer) { mkdirSync(join(root, 'mcp-server', 'dist'), { recursive: true }); writeFileSync(join(root, 'mcp-server', 'dist', 'server.mjs'), `process.stdout.write('LAUNCHED v${v}');\n`); }
    else mkdirSync(join(root, 'skills'), { recursive: true });   // a build without the server bundle
  }
  return home;
};
const run = (home) => { try { return { code: 0, out: execFileSync(process.execPath, [LAUNCHER], { env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' }; } };

test('the launcher runs the NEWEST installed build that ships this server, skipping builds without it', () => {
  const home = fakeHome({ '0.1.0': false, '0.2.0': true, '0.3.0': false, '0.0.9': true });
  try { const r = run(home); assert.equal(r.code, 0, r.err); assert.equal(r.out, 'LAUNCHED v0.2.0'); } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the launcher refuses loudly when no installed build ships the server', () => {
  const home = fakeHome({ '0.1.0': false });
  try { const r = run(home); assert.notEqual(r.code, 0); assert.match(r.err, /uxie-manychat-factory/); } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the launcher finds the plugin under ANY marketplace name', () => {
  const home = fakeHome({ '0.2.0': true }, 'some-other-marketplace');
  try { const r = run(home); assert.equal(r.code, 0, r.err); assert.equal(r.out, 'LAUNCHED v0.2.0'); } finally { rmSync(home, { recursive: true, force: true }); }
});

test('MANYCHAT_MCP_SERVER overrides resolution (the pre-release / dev path) and refuses a bad path', () => {
  const home = fakeHome({ '0.2.0': true });
  const dev = join(home, 'dev-server.mjs');
  writeFileSync(dev, "process.stdout.write('LAUNCHED dev');\n");
  try {
    const good = execFileSync(process.execPath, [LAUNCHER], { env: { ...process.env, HOME: home, MANYCHAT_MCP_SERVER: dev }, encoding: 'utf8' });
    assert.equal(good, 'LAUNCHED dev', 'the override wins over the installed build');
    let failed;
    try { execFileSync(process.execPath, [LAUNCHER], { env: { ...process.env, HOME: home, MANYCHAT_MCP_SERVER: join(home, 'nope.mjs') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { failed = e; }
    assert.ok(failed, 'a missing override path must not silently fall back to the installed build');
    assert.match(String(failed.stderr), /does not exist/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

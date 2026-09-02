#!/usr/bin/env node
// Stable launcher for the uxie-manychat-mcp server (shipped inside the uxie-manychat-factory plugin).
//
// MCP configs point at a COPY of this file in a stable home (~/.uxie-manychat-mcp/launch.mjs),
// written by /uxie-manychat-factory:manychat-connect — so a plugin version update never breaks the
// path the way pointing straight at the versioned plugin cache would. At launch it resolves the
// NEWEST installed plugin build that ships this server and runs its bundle, inheriting env
// (MANYCHAT_SESSION_FILE, MANYCHAT_API_KEY, MANYCHAT_ACCOUNT_ID) from the registration.
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The plugin cache is ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/. The marketplace
// segment is whatever name the user added the marketplace under, so EVERY marketplace directory is
// scanned for this plugin rather than pinning one name.
// DEV / PRE-RELEASE OVERRIDE. MANYCHAT_MCP_SERVER names a server bundle to run instead of the
// installed one. It exists because the registration has to work before the plugin is published —
// and because pointing a registration straight at a working tree, with no way back, is the footgun
// this launcher exists to avoid. Set it, and the resolution below is skipped entirely; unset it,
// and you are back on the newest installed build with no edit to the registration.
if (process.env.MANYCHAT_MCP_SERVER) {
  const dev = process.env.MANYCHAT_MCP_SERVER;
  if (!existsSync(dev)) {
    process.stderr.write(`uxie-manychat-mcp: MANYCHAT_MCP_SERVER points at ${dev}, which does not exist.\n`);
    process.exit(1);
  }
  await import(pathToFileURL(dev).href);
} else {

const CACHE = join(homedir(), '.claude', 'plugins', 'cache');
const PLUGIN = 'uxie-manychat-factory';

const semverDesc = (a, b) => {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

const candidates = [];
try {
  for (const marketplace of readdirSync(CACHE)) {
    const root = join(CACHE, marketplace, PLUGIN);
    let versions = [];
    try { versions = readdirSync(root).filter((d) => /^\d+\.\d+\.\d+$/.test(d)); } catch { continue; }
    for (const v of versions) candidates.push({ v, path: join(root, v, 'mcp-server', 'dist', 'server.mjs') });
  }
} catch { /* no plugin cache at all */ }
const server = candidates.sort((a, b) => semverDesc(a.v, b.v)).map((c) => c.path).find((p) => existsSync(p));

if (!server) {
  process.stderr.write(
    `uxie-manychat-mcp: no installed build of ${PLUGIN} ships mcp-server/dist/server.mjs under ${CACHE}/<marketplace>/${PLUGIN}/. `
    + `Install or update the plugin (claude plugin update ${PLUGIN}), then retry.\n`,
  );
  process.exit(1);
}

  await import(pathToFileURL(server).href);
}

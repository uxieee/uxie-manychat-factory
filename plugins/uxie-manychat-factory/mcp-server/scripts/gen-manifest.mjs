// Emit capability-manifest.json: the exact {tool, rail, method, path} rows the tools declare.
// Compiled FROM source (TOOLS); nothing is ever read back the other way. Importing has no side effect.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = resolve(HERE, '..', 'capability-manifest.json');

export function buildCapabilityManifest(tools = TOOLS) {
  return tools.flatMap((t) => (t.capabilities ?? []).map((c) => ({ tool: t.name, rail: c.rail ?? 'internal', method: c.method, path: c.path })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = buildCapabilityManifest();
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n');
  console.log(`capability-manifest: ${entries.length} entries`);
}

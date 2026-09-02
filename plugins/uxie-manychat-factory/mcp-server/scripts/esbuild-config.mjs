// Shared esbuild config for the bundled server, used by scripts/build.mjs and test/bundle.test.mjs
// so the committed bundle and the sync-check can never disagree on defines.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const OUTFILE = resolve(ROOT, 'dist/server.mjs');

export function buildOptions(extra = {}) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const catalog = readFileSync(resolve(ROOT, 'tool-descriptions.json'), 'utf8');
  const endpoints = readFileSync(resolve(ROOT, 'catalog/manychat-endpoints.json'), 'utf8');
  return {
    entryPoints: [resolve(ROOT, 'stdio.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: {
      __MCP_VERSION__: JSON.stringify(pkg.version),
      __HAS_CATALOG__: 'true',
      __TOOL_CATALOG__: catalog,
      __HAS_ENDPOINTS__: 'true',
      __ENDPOINT_CATALOG__: endpoints,
    },
    logLevel: 'warning',
    ...extra,
  };
}

// Bundle stdio.mjs + deps (@modelcontextprotocol/sdk, zod) + the catalogues into dist/server.mjs,
// so the plugin can launch it with just `node` — no npm install on the user's machine.
import { build } from 'esbuild';
import { buildOptions, OUTFILE } from './esbuild-config.mjs';

await build(buildOptions({ outfile: OUTFILE }));
console.log(`bundled ${OUTFILE}`);

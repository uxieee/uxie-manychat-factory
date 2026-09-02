// Compile catalog/manychat-endpoints.json from the source-mined catalogue (a copy of the research
// folder's endpoint-catalogue-from-source.json), the public swagger, and this repo's hand overlay.
// The overlay is never written by this script; a corrected path orphans its key and is NAMED here.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const source = JSON.parse(readFileSync(resolve(ROOT, 'catalog/manychat-endpoints.source.json'), 'utf8'));
const swagger = JSON.parse(readFileSync(resolve(ROOT, 'catalog/public-api-swagger.json'), 'utf8'));
const overlay = JSON.parse(readFileSync(resolve(ROOT, 'catalog/endpoint-overlay.json'), 'utf8')).rows ?? {};
let manifest = [];
try { manifest = JSON.parse(readFileSync(resolve(ROOT, 'capability-manifest.json'), 'utf8')); } catch { /* first build */ }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rows = [];
const seen = new Set();
const familyOf = (files) => { const m = String(files?.[0] ?? '').match(/requests\/([^/]+)\//); return m ? m[1] : (files?.[0] ?? 'legacy'); };

for (const t of source.typed ?? []) {
  // Two source rows spell their url without the leading slash (automationStarter/*); normalise.
  const path = (t.url.startsWith('/') ? t.url : `/${t.url}`).replace(/\{pageId\}/g, '{pageId}');
  const key = `${t.method} ${path}`;
  if (seen.has(key)) continue; seen.add(key);
  rows.push({ id: `internal--${slug(familyOf(t.files))}--${slug(t.name)}`, rail: 'internal', instance: t.instance, method: t.method, path, family: familyOf(t.files), name: t.name, schemaRef: t.schemas ?? null, sources: t.files ?? [], legacy: false });
}
for (const l of source.legacy ?? []) {
  const raw = l.url.replace(/^\/:currentAccountID/, '');
  const path = raw.split('?')[0];
  const query = raw.includes('?') ? raw.split('?')[1].split('&').map((p) => p.split('=')[0]) : [];
  // Verb test on the LAST segment only: `/settings/getNotifications` starts with "set" and was
  // being read as a POST.
  const last = path.split('/').pop() ?? '';
  const method = /^(create|set|update|delete|save|publish|move|sort|change|add|remove|switch|replace)/i.test(last) ? 'POST' : 'GET';
  const key = `${method} ${path}`;
  if (seen.has(key)) continue; seen.add(key);
  rows.push({ id: `internal--legacy--${slug(path)}`, rail: 'internal', instance: 'account', method, path, family: path.split('/')[1] ?? 'legacy', name: path.split('/').pop(), schemaRef: null, sources: l.files ?? [], legacy: true, query, note: 'legacy (pre-zod) endpoint; method inferred from the verb in the path' });
}
for (const [path, ops] of Object.entries(swagger.paths ?? {})) {
  for (const [m, o] of Object.entries(ops)) {
    const method = m.toUpperCase();
    const key = `PUBLIC ${method} ${path}`;
    seen.add(key);
    const body = o.requestBody?.content?.['application/json']?.schema ?? null;
    rows.push({ id: `public--${slug(path.replace(/^\/fb\//, ''))}`, rail: 'public', instance: null, method, path, family: path.split('/')[2] ?? 'public', name: path.split('/').pop(), summary: o.summary || o.description || undefined, query: (o.parameters ?? []).map((p) => ({ name: p.name, required: Boolean(p.required), type: p.schema?.type ?? null })), body: body ? { required: body.required ?? [], properties: Object.fromEntries(Object.entries(body.properties ?? {}).map(([k, v]) => [k, v.type ?? v.description ?? 'any'])) } : null, sources: ['reference/public-api/swagger-Page_API.json'], legacy: false, proven: 'documented' });
  }
}
// Overlay: merge in place; add rows the source lacks.
const byKey = new Map(rows.map((r) => [`${r.rail === 'public' ? 'PUBLIC ' : ''}${r.method} ${r.path}`, r]));
const orphans = [];
for (const [key, o] of Object.entries(overlay)) {
  const { add, ...rest } = o;
  const row = byKey.get(key);
  if (row) { Object.assign(row, rest); continue; }
  if (!add) { orphans.push(key); continue; }
  const [method, path] = key.split(' ');
  const r = { id: `internal--${slug(rest.family ?? 'corpus')}--${slug(path)}`, rail: 'internal', instance: rest.instance ?? 'account', method, path, family: rest.family ?? path.split('/')[1], name: path.split('/').pop(), schemaRef: null, sources: ['corpus'], legacy: Boolean(rest.legacy), ...rest };
  rows.push(r); byKey.set(key, r);
}
// Coverage from the capability manifest (tools declare rail+method+path).
for (const m of manifest) {
  const row = byKey.get(`${m.rail === 'public' ? 'PUBLIC ' : ''}${m.method} ${m.path}`);
  if (row) { row.coveredBy = [...new Set([...(row.coveredBy ?? []), m.tool])]; }
}
for (const r of rows) { r.proven ??= 'source'; r.coveredBy ??= []; r.kind ??= r.method === 'GET' ? 'read' : 'write'; }
rows.sort((a, b) => a.rail.localeCompare(b.rail) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const out = { generated: new Date().toISOString().slice(0, 10), bundle: 490, note: 'internal rows prove the ManyChat front-end calls that path (bundle 490 source maps); proven:live rows were executed on a real account and read back (research live-*.json). public rows are the documented api.manychat.com operations. A row is NOT proof the call is safe.', count: rows.length, endpoints: rows };
writeFileSync(resolve(ROOT, 'catalog/manychat-endpoints.json'), JSON.stringify(out, null, 1) + '\n');
const live = rows.filter((r) => r.proven === 'live').length;
console.log(`catalog: ${rows.length} rows (${rows.filter((r) => r.rail === 'internal').length} internal, ${rows.filter((r) => r.rail === 'public').length} public); proven-live ${live}; covered ${rows.filter((r) => r.coveredBy.length).length}`);
if (orphans.length) { console.error(`overlay ORPHANS (key matches no source row and has no add:true):\n  ${orphans.join('\n  ')}`); process.exit(1); }

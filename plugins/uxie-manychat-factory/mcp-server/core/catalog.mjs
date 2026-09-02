// The endpoint catalogue: 849 typed + 56 legacy internal requests mined from ManyChat's public
// source maps (bundle 490) plus the 34 public-API operations, compiled by
// scripts/build-endpoint-catalog.mjs with the corpus overlay (proven-live marks, summaries, traps).
// Inlined into the bundle at build time (like the GHL server) so dist/ ships without siblings.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
let ROWS = null;
export const endpoints = () => {
  if (ROWS) return ROWS;
  if (typeof __HAS_ENDPOINTS__ !== 'undefined') { ROWS = __ENDPOINT_CATALOG__.endpoints ?? []; return ROWS; }
  try { ROWS = JSON.parse(readFileSync(resolve(HERE, '../catalog/manychat-endpoints.json'), 'utf8')).endpoints ?? []; }
  catch { ROWS = []; }
  return ROWS;
};

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'with', 'my', 'me', 'i', 'it', 'is', 'that', 'this', 'when', 'how', 'do', 'does', 'use', 'manychat']);
export const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const MUTATING = new Set(['create', 'make', 'new', 'build', 'update', 'edit', 'change', 'modify', 'delete', 'remove', 'clear', 'publish', 'unpublish', 'set', 'save', 'rename', 'move', 'clone', 'copy', 'send', 'start', 'stop', 'activate', 'archive', 'restore', 'sort', 'attach', 'switch']);
const DESTRUCTIVE = new Set(['delete', 'remove', 'clear', 'trash', 'unsubscribe', 'permanently']);

export function scoreEndpoint(e, terms) {
  if (!terms.length) return 0;
  const path = String(e.path ?? '').toLowerCase();
  const segs = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
  const camel = String(e.name ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const hay = `${e.method} ${path} ${camel} ${e.family ?? ''} ${e.summary ?? ''} ${e.note ?? ''}`.toLowerCase();
  const mutating = terms.some((t) => MUTATING.has(t));
  const destructive = terms.some((t) => DESTRUCTIVE.has(t));
  let score = 0; let hits = 0;
  for (const t of terms) {
    const stem = t.length > 4 ? t.replace(/(ing|ed|es|s)$/, '') : t;
    const hit = (v) => v === t || v === stem || v.startsWith(stem);
    if ([...segs].some(hit)) { score += 25; hits++; }
    else if (path.includes(stem)) { score += 10; hits++; }
    if (camel.split(' ').some(hit)) { score += 15; hits++; }
    if (hay.includes(stem)) score += 3;
    if ((e.summary ?? '').toLowerCase().includes(stem)) { score += 12; hits++; }
  }
  if (!hits) return 0;
  score += hits * hits * 8;
  const kind = e.kind ?? (e.method === 'GET' ? 'read' : 'write');
  if (kind === 'destructive' && !destructive) return 0;
  if (kind === 'write' && !mutating) score -= 40;
  if (e.proven === 'live') score += 6;
  if (e.reach === 'refused') score -= 60;
  return score;
}

export const stub = (e) => ({
  id: e.id, rail: e.rail, method: e.method, path: e.path,
  kind: e.kind ?? (e.method === 'GET' ? 'read' : 'write'),
  proven: e.proven ?? 'source',
  ...(e.summary ? { summary: e.summary } : {}),
  ...(e.coveredBy?.length ? { coveredBy: e.coveredBy } : {}),
  ...(e.note ? { note: e.note } : {}),
  ...(e.reach && e.reach !== 'source-only' ? { reach: e.reach } : {}),
});

export function searchEndpoints({ intent, rail = null, method = null, limit = 10 }) {
  const terms = words(intent);
  let pool = endpoints();
  if (rail) pool = pool.filter((e) => e.rail === rail);
  if (method) pool = pool.filter((e) => e.method === String(method).toUpperCase());
  const ranked = pool.map((e) => ({ e, score: scoreEndpoint(e, terms) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length);
  return { total: ranked.length, poolSize: pool.length, results: ranked.slice(0, limit).map((x) => stub(x.e)) };
}

export function describeEndpoint({ id, method, path }) {
  const pool = endpoints();
  let hit = id ? pool.find((e) => e.id === id) : null;
  if (!hit && method && path) {
    const want = String(method).toUpperCase();
    hit = pool.find((e) => e.method === want && e.path === path) ?? pool.find((e) => e.method === want && e.path.replace(/\{[^}]+\}/g, '{p}') === String(path).replace(/\{[^}]+\}/g, '{p}'));
  }
  return hit ?? null;
}

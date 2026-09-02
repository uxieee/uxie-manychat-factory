// Pure helpers over ManyChat flow batches: server-stat stripping, published→batch conversion,
// edge walking, BFS canvas layout (port of manychat-internal-api-research/scripts/auto-layout.js),
// duplicate-_oid detection and caption indexing. No I/O.
import { randomUUID } from 'node:crypto';

// Keys the server ADDS on read. A batch that carries them back made publish return
// `Something went wrong` (live-10). Verbatim from scripts/auto-layout.js.
export const STAT_KEY = /^(stats|button_click_stats|target_stats|sent_segment_id|clicked_segment_id|delivered_segment_id|read_segment_id|sent_total|sent_users|sent_unq|clicks_users|clicked_unq|delivered_unique_users|read_unique_users|questions_count|filled_answers_count|waiters_total|waiters_unique|bounced|spam_report|unsubscribed|bounced_segment_id|spam_report_segment_id|unsubscribed_segment_id)$/;

export const stripStats = (o) => {
  if (Array.isArray(o)) return o.map(stripStats);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) { if (STAT_KEY.test(k)) continue; r[k] = stripStats(o[k]); } return r; }
  return o;
};

export const uuid = () => randomUUID();

// flow.contents[] (published read-back) → batch contents the server accepts on publish.
export function publishedToBatch(flow) {
  const ns = flow.ns;
  const contents = (flow.contents ?? [])
    .filter((c) => !c.deleted)
    .map((c) => ({ ...stripStats(c.data ?? {}), type: c.type, content_id: c.content_id, caption: c.caption, namespace: ns, removed: false }));
  return { contents, root: flow.root_content_id ?? null };
}

// Draft batch (flow.draft_batch) → the same shape, stats stripped defensively.
export function draftToBatch(flow) {
  const b = flow.draft_batch;
  if (!b || !Array.isArray(b.contents)) return null;
  return { contents: b.contents.map((c) => ({ ...stripStats(c), namespace: c.namespace ?? flow.ns })), root: b.root_content ?? null };
}

export function duplicateOids(contents) {
  const seen = new Map();
  for (const c of contents ?? []) if (c?._oid) seen.set(c._oid, (seen.get(c._oid) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([oid, n]) => ({ oid, count: n }));
}

// Every outgoing target reference of a node, as target objects.
export function targetRefs(c) {
  const out = [];
  const push = (t) => { if (t && typeof t === 'object' && (t._content_oid || t.content_id)) out.push(t); };
  push(c.target); push(c.content_target);
  (c.quick_replies?.buttons ?? []).forEach(push);
  (c.messages ?? []).forEach((m) => { (m.keyboard ?? []).forEach(push); (m.answer_replies ?? []).forEach(push); push(m.success_target); push(m.timeout_target); });
  (c.conditions ?? []).forEach((x) => push(x.target)); push(c.default_target);
  (c.variants ?? []).forEach((v) => push(v.target));
  if (c.quick_replies?.settings?.timeout_target) push(c.quick_replies.settings.timeout_target);
  return out;
}

export function makeResolver(contents) {
  const byId = new Map(); const byOid = new Map();
  for (const c of contents) { if (c.content_id != null) byId.set(String(c.content_id), c); if (c._oid) byOid.set(c._oid, c); }
  return (t) => {
    if (t == null) return null;
    if (typeof t === 'string') return byOid.get(t) ?? byId.get(t) ?? null;
    if (typeof t === 'number') return byId.get(String(t)) ?? null;
    return (t._content_oid && byOid.get(t._content_oid)) || (t.content_id != null && byId.get(String(t.content_id))) || null;
  };
}

// BFS from the root: x = depth column, y = row within the column. Orphans (unreached) go to the
// right, one column each. Defaults from the CJ build: root at x=900 so the trigger card has room,
// 640 px columns (cards are ~500 px tall) and 640 px rows.
export function layoutCoordinates(contents, root, { col = 640, row = 640, x0 = 900, y0 = 0 } = {}) {
  const resolve = makeResolver(contents);
  const rootNode = resolve(root);
  const depth = new Map(); const order = [];
  if (rootNode) {
    depth.set(rootNode, 0); const q = [rootNode];
    while (q.length) { const n = q.shift(); order.push(n); for (const t of targetRefs(n)) { const m = resolve(t); if (m && !depth.has(m)) { depth.set(m, depth.get(n) + 1); q.push(m); } } }
  }
  let maxDepth = Math.max(0, ...depth.values());
  const orphans = [];
  for (const c of contents) if (!depth.has(c)) { depth.set(c, ++maxDepth); order.push(c); orphans.push(c.caption ?? c._oid); }
  const rows = {}; const coords = {};
  for (const n of order) { const d = depth.get(n); rows[d] = rows[d] ?? 0; coords[n._oid] = { x: x0 + d * col, y: y0 + rows[d] * row }; rows[d]++; }
  return { coords, columns: maxDepth + 1, orphans, reached: order.length - orphans.length };
}

export function indexByCaption(contents) {
  const idx = new Map();
  for (const c of contents ?? []) { const k = String(c.caption ?? ''); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(c); }
  return idx;
}

// content_node_errors is keyed `<oid>` or `<oid>.<prop>`; re-key by caption for humans.
export function captionErrors(contentNodeErrors, contents) {
  const byOid = new Map(); const byId = new Map();
  for (const c of contents ?? []) { if (c._oid) byOid.set(c._oid, c); if (c.content_id != null) byId.set(String(c.content_id), c); }
  const out = [];
  for (const [key, message] of Object.entries(contentNodeErrors ?? {})) {
    const [ref, ...rest] = key.split('.');
    const node = byOid.get(ref) ?? byId.get(ref) ?? null;
    out.push({ key, caption: node?.caption ?? null, type: node?.type ?? null, oid: node?._oid ?? (byOid.has(ref) ? ref : null), content_id: node?.content_id ?? null, prop: rest.join('.') || null, message });
  }
  return out;
}

export function summarizeContents(contents, root) {
  const resolve = makeResolver(contents);
  return (contents ?? []).map((c) => ({
    caption: c.caption ?? null,
    type: c.type,
    oid: c._oid ?? null,
    content_id: c.content_id ?? null,
    root: root != null && (String(c._oid) === String(root) || String(c.content_id) === String(root)),
    ...(c.private_reply ? { private_reply: c.private_reply } : {}),
    blocks: Array.isArray(c.messages) ? c.messages.map((m) => m.type) : undefined,
    actions: Array.isArray(c.actions) ? c.actions.map((a) => a.type) : undefined,
    edges: targetRefs(c).map((t) => resolve(t)?.caption ?? t._content_oid ?? t.content_id),
  }));
}

// ── node / block constructors used by the compiler ────────────────────────────────────────
const channelNode = (type, ns, caption, extra = {}) => ({
  type, _oid: uuid(), namespace: ns, caption, content_id: null, removed: false,
  message_tag: null, one_time_notify_reason_id: null, private_reply: null, target: null,
  quick_replies: { buttons: [], settings: {} }, messages: [], ...extra,
});
export const nodes = {
  channel: channelNode,
  instagram: (ns, caption, extra) => channelNode('instagram', ns, caption, extra),
  actionGroup: (ns, caption, actions = [], extra = {}) => ({ type: 'action_group', _oid: uuid(), namespace: ns, caption, content_id: null, removed: false, target: null, actions: actions.map((a) => ({ _oid: uuid(), ...a })), ...extra }),
  goto: (ns, caption, flowNs) => ({ type: 'goto', _oid: uuid(), namespace: ns, caption, content_id: null, removed: false, target: { flow_ns: flowNs }, content_target: null }),
  condition: (ns, caption) => ({ type: 'multi_condition', _oid: uuid(), namespace: ns, caption, content_id: null, removed: false, conditions: [], default_target: null, default_target_oid: uuid() }),
  smartDelay: (ns, caption, value, unit) => ({ type: 'smart_delay', _oid: uuid(), namespace: ns, caption, content_id: null, removed: false, target: null, limit_time: null, shift_time: { unit, value } }),
  split: (ns, caption, randomized = true) => ({ type: 'split', _oid: uuid(), namespace: ns, caption, content_id: null, removed: false, randomized, variants: [] }),
  note: (ns, text, { color = 'default', font_size = 'small', note_size = 'medium', user_id = null } = {}) => ({ type: 'note', _oid: uuid(), namespace: ns, caption: 'note', content_id: null, removed: false, note: { _oid: uuid(), user_id, timestamp: Math.floor(Date.now() / 1000), text, color, font_size, note_size } }),
  // ManyChat AI step (BackendContentType.AI_NODE): Exporter.processAiNode.
  aiNode: (ns, caption, prompt, { default_target = null, abilities = [], resources = null } = {}) => ({ type: 'ai_node', _oid: uuid(), namespace: ns, caption, content_id: null, removed: false, default_target, prompt, abilities, resources }),
};
export const blocks = {
  text: (text, keyboard = []) => ({ _oid: uuid(), type: 'text', content: { text }, keyboard }),
  delay: (seconds, showTyping = true) => ({ _oid: uuid(), type: 'delay', time: seconds, show_typing: showTyping }),
  question: ({ text, answer_type = 'text', answer_method = 'input', adapters = [], validation_message = null, skip_button_caption = null, limit_failed = 4, timeout = { unit: 'minutes', value: 30 }, success_target = null, timeout_target = null }) => ({
    _oid: uuid(), type: 'question', content: { text }, answer_type, answer_method, adapters, answer_replies: [], validation_message, skip_button_caption, telegram_share_phone_button_caption: null, button_caption: null, limit_failed, question_answer_timeout: timeout, success_target, ...(timeout_target ? { timeout_target } : {}),
  }),
};
// Blocks the Instagram node accepts beyond text/question/delay (Exporter.processBlockSpecific).
blocks.externalImage = (url) => ({ _oid: uuid(), type: 'attachment', content: { type: 'external_image', data: { url } }, keyboard: [] });
// `data` is the object POST /content/upload returned (caid, title, type …); `type` is image|video|file|gif.
blocks.attachment = (type, data) => ({ _oid: uuid(), type: 'attachment', content: { type, data }, keyboard: [] });
blocks.card = ({ title, subtitle = '', image = null, keyboard = [], default_action = null }) => ({ _oid: uuid(), type: 'card', content: { title, subtitle, image }, default_action, is_hidden: false, keyboard });
blocks.cards = (elements, { image_aspect_ratio = 'horizontal' } = {}) => ({ _oid: uuid(), type: 'cards', image_aspect_ratio, elements, keyboard: [] });
blocks.dynamic = ({ url, method = 'get', payload = null, headers = {}, fallback = null }) => ({ _oid: uuid(), type: 'dynamic', method: String(method).toLowerCase(), url, payload, headers, fallback, keyboard: [] });
export const buttons = {
  content: (caption, oid) => ({ _oid: uuid(), type: 'content', caption, _content_oid: oid, actions: [] }),
  url: (caption, url) => ({ _oid: uuid(), type: 'url', caption, url, webview_size: 'full', do_not_track: false, actions: [] }),
};
export const ref = (oid) => ({ _content_oid: oid });

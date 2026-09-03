// Transport-blind tool definitions. Every handler returns the error contract ({ok,…}) and never
// throws; credentials never enter a tool argument or leave in a result (errors.mjs scrubs both).
// Descriptions merge the hand-maintained tool-descriptions.json (proof + risk labels) with the
// operational sentence written here, the way the GHL server does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { CODES, RECONNECT, containsSecrets, fail, failureOf, ok } from './errors.mjs';
import { SessionError, readSession, sessionStatus, writeSession } from './session.mjs';
import { makeInternalGateway, makePublicGateway } from './gateway.mjs';
import { validateBatch, validateKeywordRules, validateWidgetData, validateObjectName, ruleTable, POST_COVERED_AREAS, COMMENT_CONTAINS, KEYWORD_CONDITIONS, WIDGET_STATUSES, KEYWORD_STATUSES, COMMENT_TRIGGER_WIDGET_TYPES } from './rules.mjs';
import { ATTACHMENT_BACKEND_TYPE, ATTACHMENT_UPLOAD_TYPES, ATTACHMENT_WIRE_TYPE, captionErrors, draftToBatch, duplicateOids, layoutCoordinates, publishedToBatch, summarizeContents, stripStats, uuid } from './flow-model.mjs';
import { CompileError, compileSpec } from './build-flow.mjs';
import { EditError, applyOps } from './edit-flow.mjs';
import { describeEndpoint, endpoints, searchEndpoints } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = typeof __HAS_CATALOG__ !== 'undefined'
  ? __TOOL_CATALOG__
  : (() => { try { return JSON.parse(readFileSync(resolve(HERE, '../tool-descriptions.json'), 'utf8')); } catch { return {}; } })();

// Lead sentence from here; the `— proof: …; risk: …` clause from the catalogue, verbatim.
const describe = (tool, sentence) => {
  const meta = CATALOG[tool];
  const clause = meta ? ` — proof: ${meta.proof}; risk: ${meta.risk}.` : '';
  return `${sentence.replace(/\.$/, '')}${clause}`;
};

const SCHEMA_KEYS = new WeakMap();
// Passthrough on purpose: a strict schema echoes an unknown property NAME in the SDK's protocol
// error, which leaks a credential used as that key. Unknown keys are refused below without echo.
const schema = (shape) => { const s = z.object(shape).passthrough(); SCHEMA_KEYS.set(s, new Set(Object.keys(shape))); return s; };

const fromThrown = (e) => {
  if (e instanceof SessionError || (e?.code && e?.remediation)) return fail(e.code, e.detail ?? e.message, e.remediation);
  if (e instanceof CompileError) return fail(CODES.VALIDATION_FAILED, `spec has ${e.problems.length} problem(s)`, 'Fix every listed problem and retry; nothing was sent.', { problems: e.problems });
  if (e instanceof EditError) return fail(CODES.VALIDATION_FAILED, `edit has ${e.problems.length} problem(s)`, 'Fix every listed problem and retry; nothing was sent and the flow is untouched.', { problems: e.problems });
  return fail(CODES.ENGINE_ABORT, e?.message ?? String(e), 'Unexpected failure — inspect detail; nothing more was sent.');
};
const guard = async (fn) => { try { return await fn(); } catch (e) { return fromThrown(e); } };

export function makeGatewayFactory({ state, internalImpl = makeInternalGateway, publicImpl = makePublicGateway }) {
  return ({ rail = 'internal', accountId = null, ...options } = {}) => (rail === 'public'
    ? publicImpl({ sessionFile: state.sessionFile, ...options })
    : internalImpl({ sessionFile: state.sessionFile, accountId: accountId ?? state.accountId ?? null, ...options }));
}

function validateRegisteredArgs(tool, args) {
  if (containsSecrets(args)) return fail(CODES.VALIDATION_FAILED, 'a tool argument contains a credential-looking value (value withheld)', 'Remove credentials from tool arguments. Authentication comes only from the session file / MANYCHAT_API_KEY.');
  const allowed = SCHEMA_KEYS.get(tool.inputSchema) ?? new Set();
  if (Object.keys(args).some((k) => !allowed.has(k))) return fail(CODES.VALIDATION_FAILED, 'tool arguments contain unsupported fields (names withheld)', 'Remove fields not declared by this tool schema and retry.');
  return null;
}

// ── shared internal-rail helpers ──────────────────────────────────────────────────────────
const clientId = (tag) => `${uuid()}|uxie-manychat-mcp${tag ? `|${tag}` : ''}`;

// House conventions, checked before an object is created. A blocking finding
// (only the system-field collision) refuses without calling the API; anything
// else rides along on the result so the caller sees it where they are looking.
const conventions = ({ kind, caption, path }) => {
  const r = validateObjectName({ kind, caption, path });
  return {
    refusal: r.blocking.length
      ? fail(CODES.VALIDATION_FAILED, r.blocking.map((f) => f.message).join(' '), 'Use the system field instead of creating a custom one; nothing was sent.', { conventions: r })
      : null,
    block: r.count ? { conventions: r } : {},
  };
};

// One call, classified. Returns { res, bad } — bad is the error contract or null.
async function mc(gw, method, path, body, opts) { const res = await gw.call(method, path, body, opts); return { res, bad: failureOf(res, 'internal') }; }

async function readFlow(gw, ns) {
  const { res, bad } = await mc(gw, 'GET', '/flow/getFlowData', undefined, { query: { ns } });
  if (bad) return { bad };
  if (!res.json?.flow) return { bad: fail(CODES.NOT_FOUND, `no flow ${ns} on this account`, 'Check the ns with list_flows.') };
  return { flow: res.json.flow };
}

const TRIGGER_TAG_NAME = /^(Post or Reel Comments|Story Reply|Live Comments|Share to Story|Story Mention)( #\d+)?$/i;

const widgetSummary = (w) => ({
  widget_id: w.widget_id, widget_type: w.widget_type, name: w.name, status: w.status, channel: w.channel ?? null, flow_ns: w.namespace ?? w.flow?.ns ?? null,
  post_covered_area: w.data?.feed_comment_settings?.post_covered_area ?? null,
  keywords: w.data?.feed_comment_settings?.include_keywords_array ?? null,
  keyword_rules: w.data?.feed_comment_settings?.keyword_rules ?? null,
  public_replies: w.data?.feed_comment_welcome?.public_reply_messages ?? null,
});
const keywordSummary = (k) => ({ rule_id: k.rule_id, status: k.status, channel: k.channel, flow_ns: k.namespace ?? k.flow?.ns ?? null, keyword_rules: k.keyword_rules, is_reserved: k.is_reserved ?? null });

function flowSummary(flow, { contents = true } = {}) {
  const pub = publishedToBatch(flow);
  const draft = draftToBatch(flow);
  const t = flow.triggers ?? {};
  const widgets = (t.widgets ?? []).map(widgetSummary);
  const others = Object.fromEntries(Object.entries(t).filter(([k]) => !['widgets', 'keywords'].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? v.length : v ? 1 : 0]));
  return {
    ns: flow.ns, name: flow.name, has_published_content: flow.has_published_content, has_unpublished_changes: flow.has_unpublished_changes,
    root_content_id: flow.root_content_id ?? null,
    published: { count: pub.contents.length, ...(contents ? { nodes: summarizeContents(pub.contents, pub.root) } : {}) },
    draft: draft ? { count: draft.contents.length, root_content: draft.root, ...(contents ? { nodes: summarizeContents(draft.contents, draft.root) } : {}) } : null,
    triggers: { widgets, keywords: (t.keywords ?? []).map(keywordSummary), other: others,
      anyActive: widgets.some((w) => w.status === 'active') || (t.keywords ?? []).some((k) => k.status === 'live'),
      commentTriggerAttached: widgets.some((w) => COMMENT_TRIGGER_WIDGET_TYPES.includes(w.widget_type)) },
    draft_coordinates: flow.draft_coordinates ?? null,
  };
}

// The account facts the ledger needs to judge a batch: user tags, trigger auto-tags, fields, bot
// fields, known flows. Fetched fresh per call (small lists; pacing applies).
async function ledgerContext(gw, { flows = false } = {}) {
  const out = { userTagIds: new Set(), triggerTagIds: new Set(), fieldIds: new Set(), botFieldIds: new Set(), knownFlowNs: null, tagsByName: new Map(), fieldsByName: new Map(), botFieldsByName: new Map(), sequencesByName: new Map(), warnings: [] };
  const tags = await mc(gw, 'GET', '/tags/list', undefined, { query: { type: 'user' } });
  if (tags.bad) return { bad: tags.bad };
  let widgetNames = new Set();
  const widgets = await mc(gw, 'GET', '/growth-tools/list');
  if (!widgets.bad) widgetNames = new Set((widgets.res.json.widgets ?? []).map((w) => String(w.name ?? '').toLowerCase()));
  for (const t of tags.res.json.tags ?? []) {
    const name = String(t.tag_name ?? '');
    const isTrigger = TRIGGER_TAG_NAME.test(name) || widgetNames.has(name.toLowerCase());
    (isTrigger ? out.triggerTagIds : out.userTagIds).add(Number(t.tag_id));
    out.tagsByName.set(name.toLowerCase(), { id: Number(t.tag_id), trigger: isTrigger });
  }
  const fields = await mc(gw, 'GET', '/customFields/list', undefined, { query: { active_only: 'true' } });
  if (fields.bad) return { bad: fields.bad };
  for (const f of fields.res.json.fields ?? []) { out.fieldIds.add(Number(f.field_id)); out.fieldsByName.set(String(f.caption ?? '').toLowerCase(), Number(f.field_id)); }
  const gaf = await mc(gw, 'GET', '/globalFields/list', undefined, { query: { active_only: 'true' } });
  if (gaf.bad) return { bad: gaf.bad };
  for (const f of gaf.res.json.fields ?? []) { out.botFieldIds.add(Number(f.field_id)); out.botFieldsByName.set(String(f.caption ?? '').toLowerCase(), Number(f.field_id)); }
  // Sequences: needed so {add_to_sequence:"Name"} resolves. The server refuses an unknown id with
  // "Wrong sequence" (proven 2026-09-03), so a name that misses must fail at compile time.
  const seqs = await mc(gw, 'GET', '/sequence/listSequences');
  if (!seqs.bad) for (const q of seqs.res.json.sequences ?? []) out.sequencesByName.set(String(q.name ?? '').toLowerCase(), Number(q.sequence_id));
  if (flows) {
    const fl = await mc(gw, 'GET', '/cms/getFlows', undefined, { query: { path: '/', field: 'modified', order: 'desc' } });
    if (!fl.bad) out.knownFlowNs = new Set((fl.res.json.list ?? []).map((f) => f.ns));
  }
  return out;
}
const resolversFrom = (ctx) => ({
  tagId: (name) => { const t = ctx.tagsByName.get(String(name).toLowerCase()); return t && !t.trigger ? t.id : null; },
  fieldId: (name) => ctx.fieldsByName.get(String(name).toLowerCase()) ?? null,
  botFieldId: (name) => ctx.botFieldsByName.get(String(name).toLowerCase()) ?? null,
  sequenceId: (name) => ctx.sequencesByName?.get(String(name).toLowerCase()) ?? null,
});

// Run the ledger; blocking findings become a VALIDATION_FAILED with the server's strings.
function ledgerRefusal(result, what) {
  if (result.ok) return null;
  return fail(CODES.VALIDATION_FAILED,
    `${what} would be refused: ${result.blocking.length} server-enforced rule(s) fail (listed with the server's own strings)`,
    'Fix every blocking finding and retry. Nothing was sent. Findings marked serverEnforced:false are refused by tool policy (toolBlocks) because the UI cannot activate the result.',
    { blocking: result.blocking, warnings: result.warnings, meaning: result.meaning });
}

// Publish a batch and read the flow back on a SEPARATE request. Returns {bad} or {published, flow}.
async function publishBatch(gw, { ns, contents, root, coordinates, tag }) {
  const { res, bad } = await mc(gw, 'POST', '/flow/publish', { ns, batch: { contents, root_content: root }, coordinates: coordinates ?? {}, client_id: clientId(tag) });
  if (bad) {
    if (bad.code === CODES.PUBLISH_REJECTED) bad.data = { ...bad.data, byCaption: captionErrors(bad.data.content_node_errors, contents) };
    return { bad };
  }
  if (!res.json?.flow) return { bad: fail(CODES.ENGINE_ABORT, 'publish answered 200 without a flow object', 'Read the flow back with get_flow to see what landed.', { response: res.json }) };
  const rb = await readFlow(gw, ns);
  if (rb.bad) return { bad: rb.bad };
  return { published: res.json.flow, flow: rb.flow };
}

// Compare what was sent with what came back: captions/types by _oid, edge counts, root.
function verifyPublished(sent, root, flow) {
  const pub = publishedToBatch(flow);
  const byOid = new Map(pub.contents.map((c) => [c._oid, c]));
  const missing = []; const typeMismatch = [];
  for (const c of sent) {
    if (c.removed) continue;
    const got = byOid.get(c._oid);
    if (!got) { missing.push(c.caption ?? c._oid); continue; }
    if (got.type !== c.type) typeMismatch.push({ caption: c.caption, sent: c.type, stored: got.type });
  }
  const rootNode = pub.contents.find((c) => c._oid === root || String(c.content_id) === String(root));
  return { matches: !missing.length && !typeMismatch.length && Boolean(rootNode) && !flow.has_unpublished_changes, missing, typeMismatch, rootStored: rootNode ? { caption: rootNode.caption, content_id: rootNode.content_id } : null, has_unpublished_changes: flow.has_unpublished_changes, storedCount: pub.contents.length };
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf', mp3: 'audio/mpeg' };

// ── attachment uploads ────────────────────────────────────────────────────────────────
const UPLOAD_NODE_TYPES = ['instagram', 'telegram', 'whatsapp', 'sms', 'tiktok', 'default'];

// getAttachmentDestination (AttachmentBlock.tsx): the `dest` the builder puts on the multipart,
// decided by (node type, attachment type). null = the builder sends no dest.
function uploadDest(node, type, telegramVideoNote) {
  switch (node) {
    case 'sms': return type === 'image' || type === 'gif' ? 'mms' : null;
    case 'telegram':
      if (telegramVideoNote) return 'tg_video_note';
      return type === 'image' || type === 'gif' ? 'tg' : 'tg_file';
    case 'whatsapp':
      if (type === 'image' || type === 'gif') return 'wa';
      if (type === 'file') return 'wa_document';
      return 'wa_file';
    case 'instagram': return type === 'pdf' ? 'pdf' : null;
    default: return null;
  }
}

// app.attachment_policy from GET /dashboard/getData — the account's own per-channel extension and
// size limits. Cached PER ACCOUNT for the life of the process (it changes with the plan, not with
// the call); one login can reach several accounts, so a single slot would hand one account's policy
// to another.
const ATTACHMENT_POLICY = new Map();
async function attachmentPolicy(gw) {
  const key = gw.accountId();
  if (ATTACHMENT_POLICY.has(key)) return ATTACHMENT_POLICY.get(key);
  const { res, bad } = await mc(gw, 'GET', '/dashboard/getData');
  if (bad) return null;                       // policy is a guard, never a blocker on its own
  const policy = res.json?.['app.attachment_policy'] ?? {};
  ATTACHMENT_POLICY.set(key, policy);
  return policy;
}

// Refuse before the upload when the account's policy already says no. Returns a failure or null.
function policyCheck(policy, node, type, ext, bytes) {
  if (!policy || !node) return null;
  const channel = policy[node];
  if (!channel) return null;                  // no published policy for this channel
  const bucket = channel[ATTACHMENT_BACKEND_TYPE[type]];
  if (!bucket) {
    return fail(CODES.VALIDATION_FAILED, `this account's ${node} channel accepts no ${ATTACHMENT_BACKEND_TYPE[type]} attachments`,
      `Its policy lists: ${Object.keys(channel).join(', ')}. Pick a type the channel accepts.`, { policy: channel });
  }
  if (bucket.extensions?.length && !bucket.extensions.includes(ext)) {
    return fail(CODES.VALIDATION_FAILED, `.${ext} is not an accepted ${ATTACHMENT_BACKEND_TYPE[type]} extension on ${node}`,
      `The account's policy allows: ${bucket.extensions.join(', ')}. Convert the file or change the type.`, { policy: bucket });
  }
  if (bucket.max_bytes != null && bytes > bucket.max_bytes) {
    return fail(CODES.VALIDATION_FAILED, `the file is ${bytes} bytes; ${node} caps a ${ATTACHMENT_BACKEND_TYPE[type]} at ${bucket.max_bytes}`,
      'Shrink the file and upload again. Nothing was sent.', { policy: bucket });
  }
  return null;
}

const CONFIRM = (what, preview) => fail(CODES.CONFIRM_REQUIRED, `${what} — nothing was sent.`, 'Review data.preview, then repeat the same call with confirm:true. Only do so if the user asked for this in THIS session.', { preview });

// ── TOOLS ─────────────────────────────────────────────────────────────────────────────────
export const TOOLS = [
  {
    name: 'auth_status',
    description: describe('auth_status', 'Report both rails: the internal session (account, bundle, cookie days remaining, CSRF present) verified by ONE live probe of the account page, and the public API key (source, verified by GET /fb/page/getInfo). Claims only — never a cookie, token or key.'),
    inputSchema: schema({ probe: z.boolean().default(true).describe('false = file claims only, no network') }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/{accountId}/cms' }, { rail: 'public', method: 'GET', path: '/fb/page/getInfo' }],
    handler: async (args, deps) => guard(async () => {
      const internal = sessionStatus({ sessionFile: deps.state.sessionFile, accountIdOverride: deps.state.accountId });
      const out = { engine: deps.state.engineVersion ?? 'unknown', internal, public: { keySource: null, state: 'missing' } };
      if (args.probe !== false && internal.state === 'ok') {
        try { const gw = deps.makeGw({}); const p = await gw.probe(); out.internal.live = p; out.internal.state = p.loggedIn ? 'ok' : 'expired'; if (!p.loggedIn) out.internal.error = { code: CODES.SESSION_EXPIRED, detail: `account page answered ${p.status}${p.redirect ? ` → ${String(p.redirect).replace(/\?.*$/, '')}` : ''}`, remediation: RECONNECT }; }
        catch (e) { out.internal.state = 'error'; out.internal.error = { code: e.code ?? CODES.ENGINE_ABORT, detail: e.detail ?? e.message, remediation: e.remediation ?? RECONNECT }; }
      }
      try {
        const pg = deps.makeGw({ rail: 'public' });
        out.public = { keySource: pg.keySource, state: 'present' };
        if (args.probe !== false) {
          const res = await pg.call('GET', '/fb/page/getInfo');
          const bad = failureOf(res, 'public');
          out.public.state = bad ? 'rejected' : 'ok';
          if (bad) out.public.error = { code: bad.code, detail: bad.detail, remediation: bad.remediation };
          else out.public.page = { id: res.json?.data?.id ?? null, name: res.json?.data?.name ?? null, is_pro: res.json?.data?.is_pro ?? null };
        }
      } catch (e) { out.public = { keySource: null, state: 'missing', error: { code: e.code ?? CODES.API_KEY_MISSING, detail: e.detail ?? e.message, remediation: e.remediation } }; }
      return ok(out);
    }),
  },
  {
    name: 'list_flows',
    description: describe('list_flows', 'List automations (cms/getFlows) with per-row triggers, live status, unpublished-changes flag, channels and stats, plus the folder tree. Sorted newest-modified first by default.'),
    inputSchema: schema({ path: z.string().default('/').describe('folder path, "/" = root'), field: z.string().default('modified'), order: z.string().default('desc'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/cms/getFlows' }, { rail: 'internal', method: 'GET', path: '/cms/getFolders' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'GET', '/cms/getFlows', undefined, { query: { path: args.path ?? '/', field: args.field ?? 'modified', order: args.order ?? 'desc' } });
      if (bad) return bad;
      const folders = await mc(gw, 'GET', '/cms/getFolders');
      const list = (res.json.list ?? []).map((f) => ({
        ns: f.ns, name: f.name, path: f.path, modified: f.modified, has_published_content: f.has_published_content, has_unpublished_changes: f.has_unpublished_changes, is_quick_automation: f.is_quick_automation, easy_builder: f.easy_builder ?? null,
        channels: Object.entries(f.channels_usage ?? {}).filter(([, v]) => v).map(([k]) => k),
        stats: f.stats ?? null,
        triggers: { widgets: (f.triggers?.widgets ?? []).map(widgetSummary), keywords: (f.triggers?.keywords ?? []).map(keywordSummary), other: Object.fromEntries(Object.entries(f.triggers ?? {}).filter(([k]) => !['widgets', 'keywords'].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])) },
        anyActive: (f.triggers?.widgets ?? []).some((w) => w.status === 'active') || (f.triggers?.keywords ?? []).some((k) => k.status === 'live'),
      }));
      return ok({ accountId: gw.accountId(), count: list.length, has_any_flows: res.json.has_any_flows, flows: list, folders: folders.bad ? null : (folders.res.json.folders ?? folders.res.json) });
    }),
  },
  {
    name: 'get_flow',
    description: describe('get_flow', 'Read one flow (flow/getFlowData): published nodes with captions, types, blocks/actions and edges by caption; the draft batch if any; every trigger with its status; coordinates. Pass raw:true for the untouched server document.'),
    inputSchema: schema({ ns: z.string(), raw: z.boolean().default(false), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const r = await readFlow(gw, args.ns);
      if (r.bad) return r.bad;
      return ok(args.raw ? { flow: r.flow } : { ...flowSummary(r.flow), batchForResend: { note: 'publishedToBatch: published nodes with server stat keys stripped — the shape layout_flow/publish_flow resend', ...publishedToBatch(r.flow) } });
    }),
  },
  {
    name: 'create_flow',
    description: describe('create_flow', 'Create an empty automation (cms/createFlow) and read it back. Names over 60 characters are silently truncated by ManyChat; blank names are refused.'),
    inputSchema: schema({ name: z.string(), path: z.string().default('/').describe('"/" or "/{folderId}"'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/cms/createFlow' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      if (!String(args.name ?? '').trim()) return fail(CODES.VALIDATION_FAILED, 'name cannot be blank.', 'Pass a non-empty name (≤ 60 chars).');
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'POST', '/cms/createFlow', { name: args.name, path: args.path ?? '/' });
      if (bad) return bad;
      const ns = res.json.flow?.ns;
      const rb = await readFlow(gw, ns);
      if (rb.bad) return rb.bad;
      return ok({ ns, name: rb.flow.name, truncated: rb.flow.name !== args.name, folder_id: res.json.fs_object?.folder_id ?? null, readBack: flowSummary(rb.flow, { contents: false }) });
    }),
  },
  {
    name: 'set_flow_draft',
    description: describe('set_flow_draft', 'REPLACE the whole draft (flow/setDraft) with a contents batch. ManyChat validates NOTHING here — garbage is stored and shown as broken nodes — so the ledger runs first and refuses server-enforced failures unless skipValidation:true. Reads back has_unpublished_changes.'),
    inputSchema: schema({ ns: z.string(), contents: z.array(z.unknown()), root_content: z.union([z.string(), z.number()]).optional(), coordinates: z.record(z.string(), z.unknown()).optional(), skipValidation: z.boolean().default(false), allowUiWarnings: z.boolean().default(false).describe('demote the client-only rules (the API accepts them; ManyChat\'s builder marks the node broken and a channel may refuse it at send time) from blocking to warnings — an explicit choice, never the default'),  accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/flow/setDraft' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => draftWrite('setDraft', args, deps),
  },
  {
    name: 'patch_flow_draft',
    description: describe('patch_flow_draft', 'MERGE into the draft (flow/patchDraft): only the contents you send are touched, published nodes not mentioned survive, removed:true marks a node deleted. Ledger runs as warnings (a partial batch legitimately points outside itself). Reads back.'),
    inputSchema: schema({ ns: z.string(), contents: z.array(z.unknown()), root_content: z.union([z.string(), z.number()]).optional(), coordinates: z.record(z.string(), z.unknown()).optional(), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/flow/patchDraft' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => draftWrite('patchDraft', { ...args, skipValidation: true }, deps),
  },
  {
    name: 'check_flow',
    description: describe('check_flow', 'Run the validation ledger (ManyChat\'s own publish rules, server-vs-client marked) over a batch or over a flow\'s current draft/published contents WITHOUT sending anything. Also returns the rule table on request.'),
    inputSchema: schema({ ns: z.string().optional(), contents: z.array(z.unknown()).optional(), root_content: z.union([z.string(), z.number()]).optional(), commentTriggerAttached: z.boolean().optional().describe('override; default = whether the flow has a comment/story widget'), rules: z.boolean().default(false).describe('include the full rule table'), allowUiWarnings: z.boolean().default(false).describe('demote the client-only rules (the API accepts them; ManyChat\'s builder marks the node broken and a channel may refuse it at send time) from blocking to warnings — an explicit choice, never the default'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/flow/getFlowData' }, { rail: 'internal', method: 'GET', path: '/tags/list' }, { rail: 'internal', method: 'GET', path: '/customFields/list' }, { rail: 'internal', method: 'GET', path: '/globalFields/list' }, { rail: 'internal', method: 'GET', path: '/growth-tools/list' }, { rail: 'internal', method: 'GET', path: '/cms/getFlows' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      let contents = args.contents; let root = args.root_content; let attached = args.commentTriggerAttached;
      if (!contents) {
        if (!args.ns) return fail(CODES.VALIDATION_FAILED, 'pass contents or ns', 'Give a batch (contents + root_content) or a flow ns to check its draft/published contents.');
        const r = await readFlow(gw, args.ns); if (r.bad) return r.bad;
        const b = draftToBatch(r.flow) ?? publishedToBatch(r.flow);
        contents = b.contents; root = root ?? b.root;
        attached ??= flowSummary(r.flow, { contents: false }).triggers.commentTriggerAttached;
      }
      const ctx = await ledgerContext(gw, { flows: true }); if (ctx.bad) return ctx.bad;
      const result = validateBatch({ contents, rootContent: root, context: { ...ctx, commentTriggerAttached: attached ?? false, channel: 'instagram' }, allowUiWarnings: args.allowUiWarnings === true });
      return ok({ ...result, commentTriggerAttached: attached ?? false, ...(args.rules ? { rules: ruleTable() } : {}) });
    }),
  },
  {
    name: 'publish_flow',
    description: describe('publish_flow', 'Publish (flow/publish): the batch you pass, or the flow\'s current draft. Runs the ledger FIRST so every server-enforced problem appears at once (keyed by caption) instead of one per call; refuses on a blocking finding unless skipValidation:true. Upserts by _oid/content_id; content_node_errors come back keyed by caption. Reads the flow back on a separate request and verifies what landed.'),
    inputSchema: schema({ ns: z.string(), contents: z.array(z.unknown()).optional().describe('omit to publish the flow\'s current draft_batch'), root_content: z.union([z.string(), z.number()]).optional(), coordinates: z.record(z.string(), z.unknown()).optional(), skipValidation: z.boolean().default(false), allowUiWarnings: z.boolean().default(false).describe('demote the client-only rules (the API accepts them; ManyChat\'s builder marks the node broken and a channel may refuse it at send time) from blocking to warnings — an explicit choice, never the default'),  accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/flow/getFlowData' }, { rail: 'internal', method: 'POST', path: '/flow/publish' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const r = await readFlow(gw, args.ns); if (r.bad) return r.bad;
      const summary = flowSummary(r.flow, { contents: false });
      let contents = args.contents; let root = args.root_content; let coordinates = args.coordinates;
      if (!contents) {
        const d = draftToBatch(r.flow);
        if (!d) return fail(CODES.VALIDATION_FAILED, `flow ${args.ns} has no draft to publish (has_unpublished_changes=${r.flow.has_unpublished_changes})`, 'Pass contents + root_content, or set a draft first.');
        contents = d.contents; root = root ?? d.root; coordinates = coordinates ?? r.flow.draft_coordinates ?? undefined;
      }
      root ??= r.flow.root_content_id ?? null;
      contents = contents.map((c) => ({ ...stripStats(c), namespace: c.namespace ?? args.ns }));
      const dup = duplicateOids(contents);
      if (dup.length) return fail(CODES.VALIDATION_FAILED, `batch carries duplicate _oids: ${dup.map((d) => `${d.oid}×${d.count}`).join(', ')}`, 'Mint a fresh _oid per node (duplicates corrupt the flow; the server answers "Something went wrong").');
      let ledger = null;
      if (!args.skipValidation) {
        const ctx = await ledgerContext(gw, { flows: true }); if (ctx.bad) return ctx.bad;
        ledger = validateBatch({ contents, rootContent: root, context: { ...ctx, commentTriggerAttached: summary.triggers.commentTriggerAttached, channel: 'instagram' }, allowUiWarnings: args.allowUiWarnings === true });
        const refusal = ledgerRefusal(ledger, 'publish'); if (refusal) return refusal;
      }
      const p = await publishBatch(gw, { ns: args.ns, contents, root, coordinates, tag: 'publish' });
      if (p.bad) return p.bad;
      const verify = verifyPublished(contents, root, p.flow);
      return ok({ ns: args.ns, sent: { nodes: contents.length, root }, verify, warnings: ledger?.warnings ?? [], readBack: flowSummary(p.flow) });
    }),
  },
  {
    name: 'discard_flow_changes',
    description: describe('discard_flow_changes', 'Drop the unpublished draft (flow/discardChanges) and read back has_unpublished_changes=false. Published content is untouched.'),
    inputSchema: schema({ ns: z.string(), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/flow/discardChanges' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const { bad } = await mc(gw, 'POST', '/flow/discardChanges', { ns: args.ns, client_id: clientId('discard') });
      if (bad) return bad;
      const rb = await readFlow(gw, args.ns); if (rb.bad) return rb.bad;
      return ok({ ns: args.ns, has_unpublished_changes: rb.flow.has_unpublished_changes, draft_batch: rb.flow.draft_batch ?? null });
    }),
  },
  {
    name: 'rename_flow',
    description: describe('rename_flow', 'Rename a flow (flow/setName) and read back the stored name. Blank is refused by ManyChat ("name cannot be blank."); over 60 characters is SILENTLY TRUNCATED — the result says so.'),
    inputSchema: schema({ ns: z.string(), name: z.string(), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/flow/setName' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const { bad } = await mc(gw, 'POST', '/flow/setName', { ns: args.ns, name: args.name });
      if (bad) return bad;
      const rb = await readFlow(gw, args.ns); if (rb.bad) return rb.bad;
      return ok({ ns: args.ns, requested: args.name, stored: rb.flow.name, truncated: rb.flow.name !== args.name });
    }),
  },
  {
    name: 'layout_flow',
    description: describe('layout_flow', 'Auto-arrange a PUBLISHED flow\'s canvas: BFS from the root (x = depth column, y = row), republishing the same nodes with new coordinates — server stat keys stripped, nothing else changed, triggers untouched. Refuses flows carrying duplicate _oids (the server would answer "Something went wrong"). dryRun returns the coordinates without publishing.'),
    inputSchema: schema({ ns: z.string(), col: z.number().default(640), row: z.number().default(640), x0: z.number().default(900).describe('root x — leaves room for the trigger card on the left'), y0: z.number().default(0), dryRun: z.boolean().default(false), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/flow/getFlowData' }, { rail: 'internal', method: 'POST', path: '/flow/publish' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const r = await readFlow(gw, args.ns); if (r.bad) return r.bad;
      if (!r.flow.has_published_content) return fail(CODES.VALIDATION_FAILED, 'flow has no published content — layout republishes published nodes', 'Publish first; a draft-only flow can carry coordinates in set_flow_draft/publish_flow instead.');
      const { contents, root } = publishedToBatch(r.flow);
      const dup = duplicateOids(contents);
      if (dup.length) return fail(CODES.VALIDATION_FAILED, `flow ${args.ns} holds duplicate node _oids (${dup.map((d) => `${d.oid}×${d.count}`).join(', ')}) — a full republish would fail with "Something went wrong"`, 'This flow was corrupted by re-used _oids across publishes; rebuild it into a fresh flow rather than re-laying it out.');
      const layout = layoutCoordinates(contents, root, { col: args.col ?? 640, row: args.row ?? 640, x0: args.x0 ?? 900, y0: args.y0 ?? 0 });
      const coordsByCaption = Object.fromEntries(contents.map((c) => [c.caption, layout.coords[c._oid]]));
      if (args.dryRun) return ok({ ns: args.ns, dryRun: true, nodes: contents.length, columns: layout.columns, orphans: layout.orphans, coordinates: coordsByCaption });
      const p = await publishBatch(gw, { ns: args.ns, contents, root, coordinates: layout.coords, tag: 'layout' });
      if (p.bad) return p.bad;
      const verify = verifyPublished(contents, root, p.flow);
      return ok({ ns: args.ns, nodes: contents.length, columns: layout.columns, orphans: layout.orphans, coordinates: coordsByCaption, verify, storedCoordinates: p.flow.draft_coordinates ?? null });
    }),
  },
  {
    name: 'build_flow',
    description: describe('build_flow', 'Compile a compact caption-addressed spec into a ManyChat batch (fresh _oids, names resolved to tag/field/bot-field ids, {{field:Name}}/{{bot:Name}} tokens), run the ledger — including the comment-reply root rules — then create the flow (unless ns is given), publish (or setDraft when publish:false), read back and verify. dryRun returns the compiled batch and findings without touching the account. Spec format is in the manychat-automation-specialist skill and in core/build-flow.mjs.'),
    inputSchema: schema({ spec: z.record(z.string(), z.unknown()).describe('{root, nodes:[{caption,type,…}], channel?}'), name: z.string().optional().describe('flow name when creating'), ns: z.string().optional().describe('existing flow to (re)build into'), path: z.string().default('/'), publish: z.boolean().default(true), commentTrigger: z.boolean().default(false).describe('true = validate as if a comment/story trigger will be attached (root must be a private reply)'), dryRun: z.boolean().default(false), allowUiWarnings: z.boolean().default(false).describe('demote the client-only rules (the API accepts them; ManyChat\'s builder marks the node broken and a channel may refuse it at send time) from blocking to warnings — an explicit choice, never the default'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/tags/list' }, { rail: 'internal', method: 'GET', path: '/customFields/list' }, { rail: 'internal', method: 'GET', path: '/globalFields/list' }, { rail: 'internal', method: 'GET', path: '/growth-tools/list' }, { rail: 'internal', method: 'GET', path: '/cms/getFlows' }, { rail: 'internal', method: 'POST', path: '/cms/createFlow' }, { rail: 'internal', method: 'POST', path: '/flow/publish' }, { rail: 'internal', method: 'POST', path: '/flow/setDraft' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      if (!args.ns && !String(args.name ?? '').trim()) return fail(CODES.VALIDATION_FAILED, 'pass name (to create) or ns (to build into an existing flow)', 'Give a flow name or an existing ns.');
      const ctx = await ledgerContext(gw, { flows: true }); if (ctx.bad) return ctx.bad;
      const nsForCompile = args.ns ?? 'PENDING';
      let compiled;
      try { compiled = compileSpec(args.spec, { ns: nsForCompile, resolvers: resolversFrom(ctx) }); }
      catch (e) { return fromThrown(e); }
      let attached = args.commentTrigger;
      if (args.ns) { const r = await readFlow(gw, args.ns); if (r.bad) return r.bad; attached = attached || flowSummary(r.flow, { contents: false }).triggers.commentTriggerAttached; }
      const ledger = validateBatch({ contents: compiled.contents, rootContent: compiled.root, context: { ...ctx, commentTriggerAttached: attached, channel: 'instagram' }, allowUiWarnings: args.allowUiWarnings === true });
      const refusal = ledgerRefusal(ledger, args.publish === false ? 'the draft (on a later publish)' : 'publish');
      const layout = layoutCoordinates(compiled.contents, compiled.root);
      if (args.dryRun || refusal) {
        const body = { dryRun: true, compiled: { root: compiled.root, contents: compiled.contents, coordinates: layout.coords, captionToOid: compiled.captionToOid }, ledger, commentTriggerAttached: attached };
        return refusal ? { ...refusal, data: { ...refusal.data, compiled: body.compiled } } : ok(body);
      }
      let ns = args.ns;
      let created = null;
      if (!ns) {
        const c = await mc(gw, 'POST', '/cms/createFlow', { name: args.name, path: args.path ?? '/' });
        if (c.bad) return c.bad;
        ns = c.res.json.flow?.ns; created = { ns, name: c.res.json.flow?.name };
        for (const node of compiled.contents) node.namespace = ns;
      }
      if (args.publish === false) {
        const s = await mc(gw, 'POST', '/flow/setDraft', { ns, batch: { contents: compiled.contents, root_content: compiled.root }, coordinates: layout.coords, client_id: clientId('build') });
        if (s.bad) return s.bad;
        const rb = await readFlow(gw, ns); if (rb.bad) return rb.bad;
        return ok({ ns, created, mode: 'draft', captionToOid: compiled.captionToOid, warnings: ledger.warnings, readBack: flowSummary(rb.flow) });
      }
      const p = await publishBatch(gw, { ns, contents: compiled.contents, root: compiled.root, coordinates: layout.coords, tag: 'build' });
      if (p.bad) return { ...p.bad, data: { ...(p.bad.data ?? {}), ns, created, compiled: { root: compiled.root, contents: compiled.contents } } };
      const verify = verifyPublished(compiled.contents, compiled.root, p.flow);
      return ok({ ns, created, mode: 'published', captionToOid: compiled.captionToOid, verify, warnings: ledger.warnings, readBack: flowSummary(p.flow) });
    }),
  },
  {
    name: 'list_triggers',
    description: describe('list_triggers', 'List growth-tool widgets (comment/story triggers) and DM keyword rules for the account, each with status and bound flow — the ids set_trigger_status takes.'),
    inputSchema: schema({ channel: z.string().default('instagram'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/growth-tools/list' }, { rail: 'internal', method: 'GET', path: '/keywords/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const w = await mc(gw, 'GET', '/growth-tools/list'); if (w.bad) return w.bad;
      const k = await mc(gw, 'GET', '/keywords/list', undefined, { query: { channel: args.channel ?? 'instagram', repeatHash: 1 } }); if (k.bad) return k.bad;
      return ok({ widgets: (w.res.json.widgets ?? []).map(widgetSummary), keywords: (k.res.json.rules ?? []).map(keywordSummary) });
    }),
  },
  {
    name: 'create_comment_trigger',
    description: describe('create_comment_trigger', 'Attach an Instagram comment trigger to a flow: the createWidget → setFlow → setWidget → setDraftStatus(draft) dance in one call, then loadWidget read-back. post_covered_area is REQUIRED (all_posts | specific_post + post_id | next_post). Always ends in DRAFT. Warns that createWidget also mints a stray "Opt-In Message" flow (its ns is returned — never deleted). Validates the widget data (ledger) and reminds you of the flow\'s private-reply root rule.'),
    inputSchema: schema({ ns: z.string(), keywords: z.array(z.string()).default([]), post_covered_area: z.string().describe('all_posts | specific_post | next_post'), post_id: z.union([z.string(), z.number()]).optional(), public_replies: z.array(z.string()).default([]).describe('rotating public comment replies; the UI wants ≥ 3 unique'), name: z.string().optional(), exclude_keywords: z.array(z.string()).default([]), comment_contains: z.string().default('specific_words'), like_comment: z.boolean().default(false), track_root_comment_only: z.boolean().default(false), skipValidation: z.boolean().default(false), allowUiWarnings: z.boolean().default(false).describe('demote the client-only rules (the API accepts them; ManyChat\'s builder marks the node broken and a channel may refuse it at send time) from blocking to warnings — an explicit choice, never the default'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/growth-tools/createWidget' }, { rail: 'internal', method: 'POST', path: '/growth-tools/setFlow' }, { rail: 'internal', method: 'POST', path: '/growth-tools/setWidget' }, { rail: 'internal', method: 'POST', path: '/growth-tools/setDraftStatus' }, { rail: 'internal', method: 'GET', path: '/growth-tools/loadWidget' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const data = {
        feed_comment_settings: { post_covered_area: args.post_covered_area, post_id: args.post_id ?? 0, post_data: null, comment_contains: args.comment_contains ?? 'specific_words', include_keywords_array: args.keywords ?? [], exclude_keywords_array: args.exclude_keywords ?? [], track_root_comment_only: Boolean(args.track_root_comment_only) },
        feed_comment_welcome: { public_reply_messages: args.public_replies ?? [], like_user_comment: Boolean(args.like_comment) },
        actions: { opt_in_status: 'do_not_send' },
      };
      const ledger = validateWidgetData(data, { allowUiWarnings: args.allowUiWarnings === true });
      if (!args.skipValidation) { const refusal = ledgerRefusal(ledger, 'the trigger'); if (refusal) return refusal; }
      const r = await readFlow(gw, args.ns); if (r.bad) return r.bad;
      const cw = await mc(gw, 'POST', '/growth-tools/createWidget', undefined, { query: { widget_type: 'feed_comment_trigger', name: args.name ?? r.flow.name, ns: args.ns, channel: 'instagram' } });
      if (cw.bad) return cw.bad;
      const w = cw.res.json.widget;
      if (!w?.widget_id) return fail(CODES.ENGINE_ABORT, 'createWidget answered without a widget', 'Inspect data.response.', { response: cw.res.json });
      const strayFlowNs = w.namespace && w.namespace !== args.ns ? w.namespace : null;
      const sf = await mc(gw, 'POST', '/growth-tools/setFlow', { widget_id: w.widget_id, flow_ns: args.ns });
      if (sf.bad) return { ...sf.bad, data: { ...(sf.bad.data ?? {}), partial: { widget_id: w.widget_id, strayFlowNs, step: 'setFlow' } } };
      const base = sf.res.json?.widget ?? w;
      const sw = await mc(gw, 'POST', '/growth-tools/setWidget', { ...base, name: args.name ?? `${r.flow.name} — comment trigger`, data });
      if (sw.bad) return { ...sw.bad, data: { ...(sw.bad.data ?? {}), partial: { widget_id: w.widget_id, strayFlowNs, step: 'setWidget' } } };
      const ds = await mc(gw, 'POST', '/growth-tools/setDraftStatus', { widget_id: w.widget_id, status: 'draft' });
      if (ds.bad) return { ...ds.bad, data: { ...(ds.bad.data ?? {}), partial: { widget_id: w.widget_id, strayFlowNs, step: 'setDraftStatus' } } };
      const lw = await mc(gw, 'GET', '/growth-tools/loadWidget', undefined, { query: { widget_id: w.widget_id } });
      if (lw.bad) return lw.bad;
      const stored = lw.res.json.widget ?? lw.res.json;
      const rb = await readFlow(gw, args.ns);
      const summary = rb.bad ? null : flowSummary(rb.flow, { contents: false });
      const rootNode = rb.bad ? null : publishedToBatch(rb.flow).contents.find((c) => String(c.content_id) === String(rb.flow.root_content_id));
      return ok({
        widget: widgetSummary(stored), status: stored.status,
        verify: { attachedToFlow: (stored.namespace ?? stored.flow?.ns) === args.ns, area: stored.data?.feed_comment_settings?.post_covered_area === args.post_covered_area, keywords: JSON.stringify(stored.data?.feed_comment_settings?.include_keywords_array ?? []) === JSON.stringify(args.keywords ?? []), inFlowTriggers: Boolean(summary?.triggers.widgets.some((x) => x.widget_id === stored.widget_id)) },
        warnings: ledger.warnings,
        leftovers: strayFlowNs ? [{ kind: 'flow', ns: strayFlowNs, why: 'createWidget mints a throw-away "Opt-In Message" flow per call; not deleted (house rule)' }] : [],
        privateReplyRule: rootNode ? (rootNode.private_reply === 'private_reply' ? 'root node is a private reply — publish will pass' : 'ROOT NODE IS NOT A PRIVATE REPLY: the next publish of this flow will be refused ("Mark this message as a Private Reply…"). Rebuild the root as one text block + button with private_reply.') : 'flow has no published root yet',
        activation: 'still DRAFT. Nothing fires until set_trigger_status(kind:"widget", status:"active", confirm:true) — only on the user\'s word.',
      });
    }),
  },
  {
    name: 'create_dm_keyword',
    description: describe('create_dm_keyword', 'Create a DRAFT DM keyword trigger bound to a flow (keywords/createDraft) and read it back (keywords/get). Refuses system keywords (start/stop/subscribe/unsubscribe — the server says "Trying to rewrite system keyword rule"), unknown conditions (the server 500s) and more than 12 keywords per rule.'),
    inputSchema: schema({ ns: z.string(), keyword_rules: z.array(z.object({ condition: z.string(), keywords: z.array(z.string()).default([]) }).passthrough()).describe('condition ∈ equals|contains|word_match|starts|not_contains|any_message|thumbs_up'), channel: z.string().default('instagram'), skipValidation: z.boolean().default(false), allowUiWarnings: z.boolean().default(false).describe('demote the client-only rules (the API accepts them; ManyChat\'s builder marks the node broken and a channel may refuse it at send time) from blocking to warnings — an explicit choice, never the default'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/keywords/createDraft' }, { rail: 'internal', method: 'GET', path: '/keywords/get' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const ledger = validateKeywordRules({ keyword_rules: args.keyword_rules, channel: args.channel ?? 'instagram', allowUiWarnings: args.allowUiWarnings === true });
      if (!args.skipValidation) { const refusal = ledgerRefusal(ledger, 'the keyword rule'); if (refusal) return refusal; }
      const { res, bad } = await mc(gw, 'POST', '/keywords/createDraft', { ns: args.ns, channel: args.channel ?? 'instagram', keyword_rules: args.keyword_rules }, { query: { client_id: uuid() } });
      if (bad) return bad;
      const rule = res.json.rule;
      const rb = await mc(gw, 'GET', '/keywords/get', undefined, { query: { rule_id: rule.rule_id } });
      if (rb.bad) return rb.bad;
      const stored = rb.res.json.rule;
      return ok({ keyword: keywordSummary(stored), verify: { boundToFlow: (stored.namespace ?? stored.flow?.ns) === args.ns, status: stored.status, rules: JSON.stringify(stored.keyword_rules) === JSON.stringify(args.keyword_rules.map((r) => ({ keywords: r.keywords, condition: r.condition }))) }, warnings: ledger.warnings, activation: 'still DRAFT. Nothing fires until set_trigger_status(kind:"keyword", status:"live", confirm:true) — only on the user\'s word.' });
    }),
  },
  {
    name: 'set_trigger_status',
    description: describe('set_trigger_status', 'Flip a trigger\'s status: widget (growth-tools/setDraftStatus: draft|active|archived) or keyword (keywords/setStatus: draft|live). ACTIVE/LIVE MEANS REAL INSTAGRAM USERS ENTER THE FLOW — it needs confirm:true AND the user\'s word in this session; without confirm the call returns a dry run showing exactly what would start firing (flow, keywords, area, whether the flow is published). Reads the trigger back after the write.'),
    inputSchema: schema({ kind: z.string().describe('widget | keyword'), id: z.union([z.string(), z.number()]), status: z.string(), confirm: z.boolean().default(false), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/growth-tools/loadWidget' }, { rail: 'internal', method: 'POST', path: '/growth-tools/setDraftStatus' }, { rail: 'internal', method: 'GET', path: '/keywords/get' }, { rail: 'internal', method: 'POST', path: '/keywords/setStatus' }, { rail: 'internal', method: 'GET', path: '/flow/getFlowData' }],
    handler: async (args, deps) => guard(async () => {
      const kind = args.kind === 'widget' || args.kind === 'keyword' ? args.kind : null;
      if (!kind) return fail(CODES.VALIDATION_FAILED, 'kind must be "widget" or "keyword" (value withheld)', 'Pass kind:"widget" (comment/story trigger) or kind:"keyword" (DM keyword).');
      const allowed = kind === 'widget' ? WIDGET_STATUSES : KEYWORD_STATUSES;
      if (!allowed.includes(args.status)) return fail(CODES.VALIDATION_FAILED, `status must be one of ${allowed.join('|')} (value withheld)`, 'Pass a listed status.');
      if (args.status === 'trash' || args.status === 'deleted') return fail(CODES.VALIDATION_FAILED, 'trash/deleted are deletions — refused by house rule', 'Nothing is deleted through this server. Use draft or archived.');
      const gw = deps.makeGw({ accountId: args.accountId });
      const id = Number(args.id);
      const load = kind === 'widget' ? await mc(gw, 'GET', '/growth-tools/loadWidget', undefined, { query: { widget_id: id } }) : await mc(gw, 'GET', '/keywords/get', undefined, { query: { rule_id: id } });
      if (load.bad) return load.bad;
      const current = kind === 'widget' ? widgetSummary(load.res.json.widget ?? load.res.json) : keywordSummary(load.res.json.rule);
      const goesLive = args.status === 'active' || args.status === 'live';
      let flow = null;
      if (current.flow_ns) { const r = await readFlow(gw, current.flow_ns); if (!r.bad) flow = flowSummary(r.flow, { contents: false }); }
      const preview = { kind, id, from: current.status, to: args.status, goesLive, trigger: current, flow: flow ? { ns: flow.ns, name: flow.name, has_published_content: flow.has_published_content, has_unpublished_changes: flow.has_unpublished_changes, published_nodes: flow.published.count } : null,
        consequence: goesLive ? `REAL Instagram users who ${kind === 'widget' ? `comment ${current.post_covered_area === 'all_posts' ? 'on any post or reel' : current.post_covered_area === 'next_post' ? 'on the next post' : 'on the selected post'} matching ${JSON.stringify(current.keywords ?? current.keyword_rules)}` : `send a DM matching ${JSON.stringify(current.keyword_rules)}`} will enter flow "${flow?.name ?? current.flow_ns}" immediately.` : 'no user-facing effect' };
      if (goesLive && args.confirm !== true) return CONFIRM('activation needs confirm:true and the user\'s explicit word in this session', preview);
      if (goesLive && flow && !flow.has_published_content) return fail(CODES.VALIDATION_FAILED, `flow ${current.flow_ns} has no published content — activating would fire an empty flow`, 'Publish the flow first.', { preview });
      const w = kind === 'widget' ? await mc(gw, 'POST', '/growth-tools/setDraftStatus', { widget_id: id, status: args.status }) : await mc(gw, 'POST', '/keywords/setStatus', { rule_id: id, status: args.status });
      if (w.bad) return w.bad;
      const rb = kind === 'widget' ? await mc(gw, 'GET', '/growth-tools/loadWidget', undefined, { query: { widget_id: id } }) : await mc(gw, 'GET', '/keywords/get', undefined, { query: { rule_id: id } });
      if (rb.bad) return rb.bad;
      const stored = kind === 'widget' ? widgetSummary(rb.res.json.widget ?? rb.res.json) : keywordSummary(rb.res.json.rule);
      return ok({ ...preview, stored: stored.status, verify: { applied: stored.status === args.status } });
    }),
  },
  {
    name: 'list_sequences',
    description: describe('list_sequences', 'List the account\'s sequences (sequence/listSequences) with their ids, message counts and subscriber counts. This is where an add_to_sequence / remove_from_sequence id comes from: flow/publish refuses an id the account does not have with "Wrong sequence". build_flow also accepts a sequence by NAME and resolves it here.'),
    inputSchema: schema({ accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/sequence/listSequences' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'GET', '/sequence/listSequences');
      if (bad) return bad;
      const list = res.json?.sequences ?? [];
      return ok({
        count: list.length,
        sequences: list.map((q) => ({ sequence_id: q.sequence_id, name: q.name, status: q.status, messages: q.messages, subscribers: q.subscribers })),
        ...(list.length ? {} : { note: 'this account has no sequences — an add_to_sequence action cannot be published until one exists (the builder creates them under Automation -> Sequences).' }),
      });
    }),
  },
  {
    name: 'list_tags',
    description: describe('list_tags', 'List user tags (tags/list?type=user) and mark the trigger auto-tags ("Post or Reel Comments #N") that add_tag actions cannot use.'),
    inputSchema: schema({ accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/tags/list' }, { rail: 'internal', method: 'GET', path: '/growth-tools/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const ctx = await ledgerContext(gw); if (ctx.bad) return ctx.bad;
      const t = await mc(gw, 'GET', '/tags/list', undefined, { query: { type: 'user' } }); if (t.bad) return t.bad;
      return ok({ count: (t.res.json.tags ?? []).length, tags: (t.res.json.tags ?? []).map((x) => ({ tag_id: x.tag_id, tag_name: x.tag_name, folder_id: x.folder_id, active: x.active, triggerAutoTag: ctx.triggerTagIds.has(Number(x.tag_id)) })) });
    }),
  },
  {
    name: 'create_tag',
    description: describe('create_tag', 'Create a user tag (tags/create) and read it back from tags/list. Duplicate (case-insensitive) names come back verbatim as "Tag with the specified name already exists".'),
    inputSchema: schema({ tag_name: z.string(), path: z.string().default('/'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/tags/create' }, { rail: 'internal', method: 'GET', path: '/tags/list' }],
    handler: async (args, deps) => guard(async () => {
      const conv = conventions({ kind: 'tag', caption: args.tag_name, path: args.path ?? '/' });
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'POST', '/tags/create', { tag_name: args.tag_name, path: args.path ?? '/', client_id: uuid() });
      if (bad) return bad;
      const t = await mc(gw, 'GET', '/tags/list', undefined, { query: { type: 'user' } }); if (t.bad) return t.bad;
      const stored = (t.res.json.tags ?? []).find((x) => x.tag_id === res.json.tag?.tag_id) ?? null;
      return ok({ tag: res.json.tag, ...conv.block, verify: { listed: Boolean(stored), nameMatches: stored?.tag_name === args.tag_name } });
    }),
  },
  {
    name: 'list_fields',
    description: describe('list_fields', 'List contact custom fields (customFields/list) with the {{cuf_<id>}} token and the condition key "cuf_<id>" for each.'),
    inputSchema: schema({ active_only: z.boolean().default(true), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/customFields/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'GET', '/customFields/list', undefined, { query: { active_only: args.active_only === false ? 'false' : 'true' } });
      if (bad) return bad;
      return ok({ count: (res.json.fields ?? []).length, fields: (res.json.fields ?? []).map((f) => ({ field_id: f.field_id, caption: f.caption, type: f.type, status: f.status, folder_id: f.folder_id, description: f.description, mergeTag: `{{cuf_${f.field_id}}}`, conditionField: `cuf_${f.field_id}` })) });
    }),
  },
  {
    name: 'create_field',
    description: describe('create_field', 'Create a contact custom field (customFields/create; type text|number|date|datetime|boolean|array, caption ≤ 50) and read it back. Duplicate captions and bad types come back verbatim from ManyChat.'),
    inputSchema: schema({ caption: z.string(), type: z.string().default('text'), description: z.string().default(''), path: z.string().default('/'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/customFields/create' }, { rail: 'internal', method: 'GET', path: '/customFields/list' }],
    handler: async (args, deps) => guard(async () => {
      const conv = conventions({ kind: 'field', caption: args.caption, path: args.path ?? '/' });
      if (conv.refusal) return conv.refusal;
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'POST', '/customFields/create', { caption: args.caption, type: args.type ?? 'text', description: args.description ?? '', path: args.path ?? '/' });
      if (bad) return bad;
      const l = await mc(gw, 'GET', '/customFields/list', undefined, { query: { active_only: 'true' } }); if (l.bad) return l.bad;
      const stored = (l.res.json.fields ?? []).find((f) => f.field_id === res.json.field?.field_id) ?? null;
      return ok({ field: res.json.field, mergeTag: res.json.field ? `{{cuf_${res.json.field.field_id}}}` : null, ...conv.block, verify: { listed: Boolean(stored), captionMatches: stored?.caption === args.caption } });
    }),
  },
  {
    name: 'list_bot_fields',
    description: describe('list_bot_fields', 'List bot (global) fields (globalFields/list) with their current values and the {{gaf_<id>}} token.'),
    inputSchema: schema({ active_only: z.boolean().default(true), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/globalFields/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'GET', '/globalFields/list', undefined, { query: { active_only: args.active_only === false ? 'false' : 'true' } });
      if (bad) return bad;
      return ok({ count: (res.json.fields ?? []).length, fields: (res.json.fields ?? []).map((f) => ({ field_id: f.field_id, caption: f.caption, type: f.type, value: f.value, status: f.status, description: f.description, mergeTag: `{{gaf_${f.field_id}}}` })) });
    }),
  },
  {
    name: 'create_bot_field',
    description: describe('create_bot_field', 'Create a bot (global) field (globalFields/create), optionally set its value (globalFields/changeValue), and read it back.'),
    inputSchema: schema({ caption: z.string(), type: z.string().default('text'), description: z.string().default(''), value: z.union([z.string(), z.number(), z.boolean()]).optional(), path: z.string().default('/'), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/globalFields/create' }, { rail: 'internal', method: 'POST', path: '/globalFields/changeValue' }, { rail: 'internal', method: 'GET', path: '/globalFields/list' }],
    handler: async (args, deps) => guard(async () => {
      const conv = conventions({ kind: 'bot_field', caption: args.caption, path: args.path ?? '/' });
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'POST', '/globalFields/create', { caption: args.caption, type: args.type ?? 'text', description: args.description ?? '', value: args.value ?? null, path: args.path ?? '/' });
      if (bad) return bad;
      const field = res.json.field;
      if (args.value !== undefined && field?.value !== args.value) {
        const cv = await mc(gw, 'POST', '/globalFields/changeValue', { field_id: field.field_id, value: args.value });
        if (cv.bad) return { ...cv.bad, data: { ...(cv.bad.data ?? {}), created: field } };
      }
      const l = await mc(gw, 'GET', '/globalFields/list', undefined, { query: { active_only: 'true' } }); if (l.bad) return l.bad;
      const stored = (l.res.json.fields ?? []).find((f) => f.field_id === field?.field_id) ?? null;
      return ok({ field: stored ?? field, mergeTag: field ? `{{gaf_${field.field_id}}}` : null, ...conv.block, verify: { listed: Boolean(stored), valueMatches: args.value === undefined ? null : stored?.value === args.value } });
    }),
  },
  {
    name: 'set_bot_field_value',
    description: describe('set_bot_field_value', 'Set a bot field\'s value (globalFields/changeValue) by id or caption and read it back from globalFields/list.'),
    inputSchema: schema({ field_id: z.number().optional(), caption: z.string().optional(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/globalFields/list' }, { rail: 'internal', method: 'POST', path: '/globalFields/changeValue' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const l = await mc(gw, 'GET', '/globalFields/list', undefined, { query: { active_only: 'true' } }); if (l.bad) return l.bad;
      const fields = l.res.json.fields ?? [];
      const target = args.field_id != null ? fields.find((f) => f.field_id === args.field_id) : fields.find((f) => String(f.caption).toLowerCase() === String(args.caption ?? '').toLowerCase());
      if (!target) return fail(CODES.NOT_FOUND, `no bot field ${args.field_id ?? args.caption}`, 'Check list_bot_fields.');
      const cv = await mc(gw, 'POST', '/globalFields/changeValue', { field_id: target.field_id, value: args.value }); if (cv.bad) return cv.bad;
      const l2 = await mc(gw, 'GET', '/globalFields/list', undefined, { query: { active_only: 'true' } }); if (l2.bad) return l2.bad;
      const stored = (l2.res.json.fields ?? []).find((f) => f.field_id === target.field_id);
      return ok({ field_id: target.field_id, caption: target.caption, previous: target.value, stored: stored?.value, verify: { applied: String(stored?.value) === String(args.value) } });
    }),
  },
  {
    name: 'create_public_api_key',
    description: describe('create_public_api_key', 'Mint the account\'s PUBLIC API key (internal rail POST /api/token/generate) when Settings → API has none, verify it against /fb/page/getInfo, and store it in the session file so the public-rail tools work. This creates a real credential on the account, so it needs confirm:true AND the user\'s word; it REFUSES when a key already exists (regenerating would invalidate whatever is using the old one) unless replaceExisting:true. It never deletes a key.'),
    inputSchema: schema({ confirm: z.boolean().default(false), replaceExisting: z.boolean().default(false), accountId: z.string().optional() }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/api/token/generate' }, { rail: 'public', method: 'GET', path: '/fb/page/getInfo' }],
    handler: async (args, deps) => guard(async () => {
      const existing = (() => { try { return readSession({ sessionFile: deps.state.sessionFile }).publicApiToken ?? null; } catch { return null; } })();
      const preview = { action: 'POST /api/token/generate', consequence: 'mints a ManyChat public API key for this account (Settings → API). Additive when the account has none; when one exists ManyChat replaces it and anything using the old key stops working.', existingKeyKnown: Boolean(existing) };
      if (existing && !args.replaceExisting) return fail(CODES.VALIDATION_FAILED, 'this session already holds a public API key for the account', 'Use it, or pass replaceExisting:true (with confirm:true) only if the user has said the old key may be invalidated.', { preview });
      if (args.confirm !== true) return CONFIRM('minting a public API key creates a real credential on the account', preview);
      const gw = deps.makeGw({ accountId: args.accountId });
      const { res, bad } = await mc(gw, 'POST', '/api/token/generate', {});
      if (bad) return bad;
      const token = res.json?.token;
      if (!token) return fail(CODES.ENGINE_ABORT, 'the mint answered 200 without a token', 'Inspect data.response.', { response: res.json });
      const session = readSession({ sessionFile: deps.state.sessionFile });
      const key = String(token).includes(':') ? String(token) : `${session.pageId}:${token}`;
      // Verify BEFORE storing: a stored key that 401s is worse than no key (that is exactly how
      // settings.api_key got captured and then refused).
      const pg = makePublicGateway({ sessionFile: deps.state.sessionFile, apiKey: key });
      const probe = await pg.call('GET', '/fb/page/getInfo');
      const probeBad = failureOf(probe, 'public');
      if (probeBad) return { ...probeBad, detail: `the minted key was refused by api.manychat.com: ${probeBad.detail}`, data: { note: 'nothing was stored; the key exists on the account and can be read in Settings → API' } };
      writeSession({ ...session, publicApiToken: key, publicKeyNote: 'minted by create_public_api_key and verified against /fb/page/getInfo', publicKeyMintedAt: new Date().toISOString() }, { sessionFile: deps.state.sessionFile });
      return ok({ minted: true, replaced: Boolean(existing), storedIn: deps.state.sessionFile, verified: { page: { id: probe.json?.data?.id ?? null, name: probe.json?.data?.name ?? null } }, note: 'the key itself is never returned; the public-rail tools read it from the session file' });
    }),
  },
  {
    name: 'edit_flow',
    description: describe('edit_flow', 'Edit a PUBLISHED flow with caption-addressed operations instead of hand-writing node JSON: set_text, set_caption, set_next, set_private_reply, add/set/remove_button, set_quick_replies, add/replace/remove_block, set/add/remove_action, set_conditions, set_delay, set_split, set_goto, set_prompt, add_node, remove_node (with rewire), set_root. Reads the flow, applies the ops to its published batch, runs the SAME ledger publish_flow runs, republishes as an upsert, then reads back and verifies. dryRun returns the resulting batch and findings without sending. Nothing is deleted: remove_node marks removed:true and refuses to orphan an edge unless you say where it should point.'),
    inputSchema: schema({
      ns: z.string(),
      ops: z.array(z.record(z.string(), z.unknown())).describe('operations in order; each names its node by caption'),
      dryRun: z.boolean().default(false),
      relayout: z.boolean().default(false).describe('re-run the BFS canvas layout after the edit (nodes added by an edit otherwise stack at the origin)'),
      allowUiWarnings: z.boolean().default(false),
      skipValidation: z.boolean().default(false),
      accountId: z.string().optional(),
    }),
    capabilities: [{ rail: 'internal', method: 'GET', path: '/flow/getFlowData' }, { rail: 'internal', method: 'GET', path: '/tags/list' }, { rail: 'internal', method: 'GET', path: '/customFields/list' }, { rail: 'internal', method: 'GET', path: '/globalFields/list' }, { rail: 'internal', method: 'GET', path: '/growth-tools/list' }, { rail: 'internal', method: 'GET', path: '/cms/getFlows' }, { rail: 'internal', method: 'POST', path: '/flow/publish' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ accountId: args.accountId });
      const r = await readFlow(gw, args.ns); if (r.bad) return r.bad;
      if (!r.flow.has_published_content) return fail(CODES.VALIDATION_FAILED, `flow ${args.ns} has no published content to edit`, 'Build it first (build_flow), or write the draft with set_flow_draft.');
      const summary = flowSummary(r.flow, { contents: false });
      const batch = publishedToBatch(r.flow);
      const ctx = await ledgerContext(gw, { flows: true }); if (ctx.bad) return ctx.bad;
      let edited;
      try { edited = applyOps({ batch, ops: args.ops ?? [], ns: args.ns, resolvers: resolversFrom(ctx) }); }
      catch (e) { return fromThrown(e); }
      let ledger = null;
      if (!args.skipValidation) {
        ledger = validateBatch({ contents: edited.contents, rootContent: edited.root, context: { ...ctx, commentTriggerAttached: summary.triggers.commentTriggerAttached, channel: 'instagram' }, allowUiWarnings: args.allowUiWarnings === true });
        const refusal = ledgerRefusal(ledger, 'the edited flow'); if (refusal) return { ...refusal, data: { ...refusal.data, summary: edited.summary } };
      }
      const coordinates = args.relayout
        ? layoutCoordinates(edited.contents.filter((c) => !c.removed), edited.root).coords
        : (r.flow.draft_coordinates ?? undefined);
      if (args.dryRun) return ok({ ns: args.ns, dryRun: true, summary: edited.summary, ledger, batch: { root: edited.root, contents: edited.contents }, coordinates });
      const p = await publishBatch(gw, { ns: args.ns, contents: edited.contents, root: edited.root, coordinates, tag: 'edit' });
      if (p.bad) return { ...p.bad, data: { ...(p.bad.data ?? {}), summary: edited.summary } };
      const verify = verifyPublished(edited.contents, edited.root, p.flow);
      return ok({ ns: args.ns, summary: edited.summary, verify, warnings: ledger?.warnings ?? [], readBack: flowSummary(p.flow) });
    }),
  },
  {
    name: 'upload_attachment',
    description: describe('upload_attachment', 'Upload a local image, video, gif, pdf, audio or other file to the account (POST /content/upload, multipart) and return the attachment object a message block needs. Pass that object back as blocks:[{attachment:{type,data}}]. There is no URL shortcut: ManyChat refuses an image it did not store ("Attachment without caid"), so every image goes through here first. Pass `node` (the channel node the block will live on) so the upload carries the `dest` the builder sends — an Instagram PDF without it comes back with no preview.'),
    inputSchema: schema({
      path: z.string().describe('absolute path to the local file'),
      type: z.string().default('image').describe('image | video | gif | pdf | audio | file — the BUILDER type; pdf and video both reach the wire as "file"'),
      node: z.string().optional().describe('the node the block will live on: instagram | telegram | whatsapp | sms | default. Decides the `dest` field and which attachment policy applies.'),
      telegramVideoNote: z.boolean().default(false).describe('Telegram only: upload as a video note (12 MB cap)'),
      accountId: z.string().optional(),
    }),
    capabilities: [{ rail: 'internal', method: 'POST', path: '/content/upload' }],
    handler: async (args, deps) => guard(async () => {
      const type = String(args.type ?? 'image');
      if (!ATTACHMENT_UPLOAD_TYPES.includes(type)) return fail(CODES.VALIDATION_FAILED, `type must be one of ${ATTACHMENT_UPLOAD_TYPES.join(', ')} (value withheld)`, 'Pass one of those.');
      const node = args.node == null ? null : String(args.node).toLowerCase();
      if (node && !UPLOAD_NODE_TYPES.includes(node)) return fail(CODES.VALIDATION_FAILED, `node must be one of ${UPLOAD_NODE_TYPES.join(', ')}`, 'Name the channel node the block will live on, or omit it.');
      let bytes;
      try { bytes = readFileSync(args.path); }
      catch (e) { return fail(CODES.VALIDATION_FAILED, `cannot read ${args.path}: ${e.code ?? e.message}`, 'Pass an absolute path to a readable local file.'); }
      const gw = deps.makeGw({ accountId: args.accountId });
      // The field name is the INDEX, not "file": ManyChat's own uploader does `body.append('0', file)`
      // (apps/easyBuilder/.../DmGalleryImageUploader.tsx; the builder's multi-file path appends '0',
      // '1', …). Sending it as `file` returned `Uploaded file is not an image`, which reads like a
      // bad file and is really a field-name mismatch. The MIME type must be set on the part too.
      const name = args.path.split('/').pop();
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const mime = MIME[ext] ?? (type === 'image' ? 'image/png' : 'application/octet-stream');

      // The account's OWN policy decides what each channel accepts — never guess it.
      const policy = await attachmentPolicy(gw);
      const check = policyCheck(policy, node, type, ext, bytes.length);
      if (check) return check;

      const form = new FormData();
      form.append('0', new Blob([bytes], { type: mime }), name);
      // The builder sets `dest` from (nodeType, attachmentType) — AttachmentBlock.tsx
      // getAttachmentDestination + attachmentActions.js `body.set('dest', …)`. It is not cosmetic:
      // PROVEN 2026-09-03 by differential that only dest=pdf makes the server generate the PDF
      // preview an Instagram PDF block needs.
      const dest = uploadDest(node, type, args.telegramVideoNote === true);
      if (dest) form.set('dest', dest);

      const { res, bad } = await mc(gw, 'POST', '/content/upload', form);
      if (bad) return bad;
      const attachment = res.json?.attachment;
      if (!attachment) return fail(CODES.ENGINE_ABORT, 'upload answered 200 without an attachment', 'Inspect data.response.', { response: res.json });
      // What the server STORED, not what we asked for: an mp4 and a pdf both come back type "file",
      // and the builder re-derives Video/PDF from data.mime. Report the mismatch rather than hide it.
      const warnings = [];
      if (type === 'pdf' && !attachment.preview) warnings.push('this PDF has no `preview` — an Instagram PDF block needs one. Re-upload with node:"instagram" so the request carries dest=pdf.');
      if (attachment.type !== type) warnings.push(`the server stored this as type "${attachment.type}" (mime ${attachment.mime ?? 'n/a'}); the builder re-derives "${type}" from the mime on read-back, so the block is correct.`);
      return ok({
        attachment,
        type,
        wireType: ATTACHMENT_WIRE_TYPE[type] ?? type,
        dest: dest ?? null,
        warnings,
        useAs: {
          block: { attachment: { type: ATTACHMENT_WIRE_TYPE[type] ?? type, data: attachment } },
          cardImage: attachment,
        },
        note: 'pass useAs.block into a blocks list, or useAs.cardImage as a card\'s `image`. ManyChat refuses an image it did not store: a URL-only block fails with "Attachment without caid".',
      });
    }),
  },
  // ── public rail ──────────────────────────────────────────────────────────────────────
  {
    name: 'get_contact',
    description: describe('get_contact', 'Public rail: read one contact by subscriber_id (GET /fb/subscriber/getInfo).'),
    inputSchema: schema({ subscriber_id: z.union([z.string(), z.number()]) }),
    capabilities: [{ rail: 'public', method: 'GET', path: '/fb/subscriber/getInfo' }],
    handler: async (args, deps) => guard(async () => {
      const pg = deps.makeGw({ rail: 'public' });
      const res = await pg.call('GET', '/fb/subscriber/getInfo', { query: { subscriber_id: args.subscriber_id } });
      return failureOf(res, 'public') ?? ok(res.json.data ?? res.json);
    }),
  },
  {
    name: 'find_contact',
    description: describe('find_contact', 'Public rail: find contacts by name (findByName), by email or phone (findBySystemField), or by a custom field value (findByCustomField). Returns the list ManyChat returns; an empty list is a real answer.'),
    inputSchema: schema({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), field_id: z.number().optional(), field_value: z.string().optional() }),
    capabilities: [{ rail: 'public', method: 'GET', path: '/fb/subscriber/findByName' }, { rail: 'public', method: 'GET', path: '/fb/subscriber/findBySystemField' }, { rail: 'public', method: 'GET', path: '/fb/subscriber/findByCustomField' }],
    handler: async (args, deps) => guard(async () => {
      const pg = deps.makeGw({ rail: 'public' });
      let res; let via;
      if (args.name) { via = 'findByName'; res = await pg.call('GET', '/fb/subscriber/findByName', { query: { name: args.name } }); }
      else if (args.email || args.phone) { via = 'findBySystemField'; res = await pg.call('GET', '/fb/subscriber/findBySystemField', { query: { email: args.email, phone: args.phone } }); }
      else if (args.field_id != null && args.field_value != null) { via = 'findByCustomField'; res = await pg.call('GET', '/fb/subscriber/findByCustomField', { query: { field_id: args.field_id, field_value: args.field_value } }); }
      else return fail(CODES.VALIDATION_FAILED, 'pass name, email, phone, or field_id + field_value', 'One lookup key is required.');
      const bad = failureOf(res, 'public'); if (bad) return bad;
      const data = res.json.data;
      const list = Array.isArray(data) ? data : data ? [data] : [];
      return ok({ via, count: list.length, contacts: list });
    }),
  },
  {
    name: 'tag_contact',
    description: describe('tag_contact', 'Public rail: add (or remove:true) a tag on a contact by tag_id or tag_name, then read the contact back (getInfo) and verify the tag is present/absent.'),
    inputSchema: schema({ subscriber_id: z.union([z.string(), z.number()]), tag_id: z.number().optional(), tag_name: z.string().optional(), remove: z.boolean().default(false) }),
    capabilities: [{ rail: 'public', method: 'POST', path: '/fb/subscriber/addTag' }, { rail: 'public', method: 'POST', path: '/fb/subscriber/addTagByName' }, { rail: 'public', method: 'POST', path: '/fb/subscriber/removeTag' }, { rail: 'public', method: 'POST', path: '/fb/subscriber/removeTagByName' }, { rail: 'public', method: 'GET', path: '/fb/subscriber/getInfo' }],
    handler: async (args, deps) => guard(async () => {
      if (args.tag_id == null && !args.tag_name) return fail(CODES.VALIDATION_FAILED, 'pass tag_id or tag_name', 'One tag key is required.');
      const pg = deps.makeGw({ rail: 'public' });
      const sid = Number(args.subscriber_id);
      const path = `/fb/subscriber/${args.remove ? 'remove' : 'add'}Tag${args.tag_id == null ? 'ByName' : ''}`;
      const body = { subscriber_id: sid, ...(args.tag_id != null ? { tag_id: args.tag_id } : { tag_name: args.tag_name }) };
      const res = await pg.call('POST', path, { body });
      const bad = failureOf(res, 'public'); if (bad) return bad;
      const rb = await pg.call('GET', '/fb/subscriber/getInfo', { query: { subscriber_id: sid } });
      const rbBad = failureOf(rb, 'public'); if (rbBad) return rbBad;
      const tags = rb.json.data?.tags ?? [];
      const present = tags.some((t) => (args.tag_id != null ? Number(t.id) === Number(args.tag_id) : String(t.name).toLowerCase() === String(args.tag_name).toLowerCase()));
      return ok({ via: path, response: res.json, verify: { present, expected: !args.remove, applied: present === !args.remove }, tags });
    }),
  },
  {
    name: 'set_contact_field',
    description: describe('set_contact_field', 'Public rail: set a contact custom field by field_id or field_name (setCustomField / setCustomFieldByName), then read the contact back and verify.'),
    inputSchema: schema({ subscriber_id: z.union([z.string(), z.number()]), field_id: z.number().optional(), field_name: z.string().optional(), field_value: z.union([z.string(), z.number(), z.boolean()]) }),
    capabilities: [{ rail: 'public', method: 'POST', path: '/fb/subscriber/setCustomField' }, { rail: 'public', method: 'POST', path: '/fb/subscriber/setCustomFieldByName' }, { rail: 'public', method: 'GET', path: '/fb/subscriber/getInfo' }],
    handler: async (args, deps) => guard(async () => {
      if (args.field_id == null && !args.field_name) return fail(CODES.VALIDATION_FAILED, 'pass field_id or field_name', 'One field key is required.');
      const pg = deps.makeGw({ rail: 'public' });
      const sid = Number(args.subscriber_id);
      const path = args.field_id != null ? '/fb/subscriber/setCustomField' : '/fb/subscriber/setCustomFieldByName';
      const res = await pg.call('POST', path, { body: { subscriber_id: sid, ...(args.field_id != null ? { field_id: args.field_id } : { field_name: args.field_name }), field_value: args.field_value } });
      const bad = failureOf(res, 'public'); if (bad) return bad;
      const rb = await pg.call('GET', '/fb/subscriber/getInfo', { query: { subscriber_id: sid } });
      const rbBad = failureOf(rb, 'public'); if (rbBad) return rbBad;
      const fields = rb.json.data?.custom_fields ?? [];
      const f = fields.find((x) => (args.field_id != null ? Number(x.id) === Number(args.field_id) : String(x.name).toLowerCase() === String(args.field_name).toLowerCase()));
      return ok({ via: path, verify: { found: Boolean(f), stored: f?.value ?? null, applied: f ? String(f.value) === String(args.field_value) : false } });
    }),
  },
  {
    name: 'send_flow',
    description: describe('send_flow', 'Public rail: send a flow to ONE real contact (POST /fb/sending/sendFlow). This messages a real person: confirm:true is required and only on the user\'s explicit word in this session; without it the call returns a preview and sends nothing.'),
    inputSchema: schema({ subscriber_id: z.union([z.string(), z.number()]), flow_ns: z.string(), confirm: z.boolean().default(false) }),
    capabilities: [{ rail: 'public', method: 'POST', path: '/fb/sending/sendFlow' }],
    handler: async (args, deps) => guard(async () => {
      const preview = { subscriber_id: Number(args.subscriber_id), flow_ns: args.flow_ns, consequence: 'a real ManyChat contact receives the flow\'s messages now' };
      if (args.confirm !== true) return CONFIRM('send_flow messages a real contact', preview);
      const pg = deps.makeGw({ rail: 'public' });
      const res = await pg.call('POST', '/fb/sending/sendFlow', { body: { subscriber_id: Number(args.subscriber_id), flow_ns: args.flow_ns } });
      return failureOf(res, 'public') ?? ok({ ...preview, response: res.json });
    }),
  },
  // ── discovery + escape hatch ─────────────────────────────────────────────────────────
  {
    name: 'search_endpoints',
    description: describe('search_endpoints', `Ranked search over ${endpoints().length} catalogued endpoints — every internal request ManyChat's own front-end defines (from its public source maps) plus the 34 public-API operations. Each hit says its rail, whether it was proven live, which typed tool covers it, and the trap worth knowing. Use before raw_request. A hit proves the front-end calls that path, not that calling it is safe.`),
    inputSchema: schema({ intent: z.string().describe('plain words: "rename a flow", "list contact fields", "story reply trigger"'), rail: z.string().optional().describe('internal | public'), method: z.string().optional(), limit: z.number().default(10) }),
    capabilities: [],
    handler: async (args) => guard(async () => {
      if (args.rail && !['internal', 'public'].includes(args.rail)) return fail(CODES.VALIDATION_FAILED, 'rail must be internal or public (value withheld)', 'Pass rail:"internal" or rail:"public", or omit it.');
      const r = searchEndpoints({ intent: args.intent, rail: args.rail ?? null, method: args.method ?? null, limit: args.limit ?? 10 });
      if (!r.results.length) return ok({ results: [], total: 0, note: `No endpoint matched "${args.intent}". ${r.poolSize} endpoints are catalogued — try ManyChat's own noun (the URL segment or the request name), or drop the filters.` });
      return ok({ ...r, next: 'describe_endpoint with the id you pick' });
    }),
  },
  {
    name: 'describe_endpoint',
    description: describe('describe_endpoint', 'Full record for ONE catalogued endpoint: rail, method, wire path, family, the zod schema reference in ManyChat\'s source, query/body where known, proof status, covering tools, trap, and a copy-pasteable raw_request call.'),
    inputSchema: schema({ id: z.string().optional(), method: z.string().optional(), path: z.string().optional() }),
    capabilities: [],
    handler: async (args) => guard(async () => {
      const hit = describeEndpoint({ id: args.id, method: args.method, path: args.path });
      if (!hit) return fail(CODES.VALIDATION_FAILED, `no catalogued endpoint matches ${args.id ?? `${args.method} ${args.path}`}`, 'Run search_endpoints first and copy the id.');
      const q = (hit.query ?? []).map((x) => (typeof x === 'string' ? x : x.name));
      return ok({ ...hit, meaning: hit.rail === 'public' ? 'documented public API operation' : `ManyChat's front-end defines this request (${hit.legacy ? 'legacy constants' : `shared/api/requests/${hit.family}`}). ${hit.proven === 'live' ? 'Executed and read back on a real account.' : 'NOT executed here — shape from source only.'}`,
        callWith: { tool: 'raw_request', rail: hit.rail, method: hit.method, path: hit.path, ...(q.length ? { query: Object.fromEntries(q.map((k) => [k, `<${k}>`])) } : {}), note: hit.rail === 'internal' ? 'path is relative to /fb<accountId> unless instance is "base"; cookie, CSRF and bundle headers are added for you.' : 'Bearer key is added for you.' } });
    }),
  },
  {
    name: 'raw_request',
    description: describe('raw_request', 'Escape hatch for endpoints the typed tools do not cover, on either rail. Auth headers are injected — never set them. GET is read-only; any other method needs confirm:true and returns a preview first. Internal paths are relative to /fb<accountId> (pass accountless:true for base-instance routes like /agency/get). Business errors come back as BUSINESS_ERROR with ManyChat\'s own message; a 200 is not proof a write applied — read back.'),
    inputSchema: schema({ rail: z.string().default('internal').describe('internal | public'), method: z.string().default('GET'), path: z.string().startsWith('/'), query: z.record(z.string(), z.unknown()).optional(), body: z.unknown().optional(), accountless: z.boolean().default(false), confirm: z.boolean().default(false), accountId: z.string().optional() }),
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      const rail = args.rail ?? 'internal';
      if (!['internal', 'public'].includes(rail)) return fail(CODES.VALIDATION_FAILED, 'rail must be internal or public (value withheld)', 'Pass rail:"internal" (default) or rail:"public".');
      const method = String(args.method ?? 'GET').trim().toUpperCase();
      if (!/^[A-Z]{3,7}$/.test(method)) return fail(CODES.VALIDATION_FAILED, 'method must be an HTTP method token', 'Pass GET, POST, PUT, PATCH or DELETE.');
      let body = args.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return fail(CODES.VALIDATION_FAILED, 'body was a string that is not valid JSON', 'Pass body as an object; the gateway serialises it.'); } }
      const preview = { rail, method, path: args.path, ...(args.query ? { query: args.query } : {}), ...(body === undefined ? {} : { body }) };
      if (method !== 'GET' && args.confirm !== true) return CONFIRM('raw write preview is ready', preview);
      if (rail === 'public') {
        const pg = deps.makeGw({ rail: 'public' });
        const res = await pg.call(method, args.path, { query: args.query, body });
        return failureOf(res, 'public') ?? ok({ status: res.status, json: res.json });
      }
      const gw = deps.makeGw({ accountId: args.accountId });
      const res = await gw.call(method, args.path, body, { query: args.query, accountless: Boolean(args.accountless) });
      return failureOf(res, 'internal') ?? ok({ status: res.status, json: res.json });
    }),
  },
];

// Shared by set_flow_draft / patch_flow_draft.
async function draftWrite(op, args, deps) {
  return guard(async () => {
    const gw = deps.makeGw({ accountId: args.accountId });
    const r = await readFlow(gw, args.ns); if (r.bad) return r.bad;
    const contents = (args.contents ?? []).map((c) => ({ ...stripStats(c), namespace: c.namespace ?? args.ns }));
    const root = args.root_content ?? r.flow.root_content_id ?? contents[0]?._oid ?? null;
    let ledger = null;
    const ctx = await ledgerContext(gw, { flows: true }); if (ctx.bad) return ctx.bad;
    ledger = validateBatch({ contents, rootContent: root, context: { ...ctx, commentTriggerAttached: flowSummary(r.flow, { contents: false }).triggers.commentTriggerAttached, channel: 'instagram' }, allowUiWarnings: args.allowUiWarnings === true });
    if (!args.skipValidation) { const refusal = ledgerRefusal(ledger, 'a later publish'); if (refusal) return refusal; }
    const { res, bad } = await mc(gw, 'POST', `/flow/${op}`, { ns: args.ns, batch: { contents, root_content: root }, coordinates: args.coordinates ?? {}, client_id: clientId(op) });
    if (bad) return bad;
    const rb = await readFlow(gw, args.ns); if (rb.bad) return rb.bad;
    const draft = draftToBatch(rb.flow);
    return ok({ ns: args.ns, op, response: res.json, has_unpublished_changes: rb.flow.has_unpublished_changes, draftCount: draft?.contents.length ?? 0, findings: { blocking: ledger.blocking, warnings: ledger.warnings }, note: op === 'setDraft' ? 'setDraft replaced the whole draft and validated nothing; publish_flow is where the server judges it.' : 'patchDraft touched only the contents sent.' });
  });
}

export function registerTools(server, deps, tools = TOOLS) {
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, async (args) => {
      const safeArgs = args ?? {};
      const result = validateRegisteredArgs(t, safeArgs) ?? await t.handler(safeArgs, deps);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
  }
}

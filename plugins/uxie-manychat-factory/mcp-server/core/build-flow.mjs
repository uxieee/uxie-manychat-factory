// The compiler: a compact, caption-addressed spec → ManyChat contents with fresh _oids. Names
// (tags, custom fields, bot fields) resolve against the account through `resolvers`; the compiler
// never touches the network. The comment-reply root rules and every other rule are applied by the
// shared ledger (rules.mjs) on the compiled batch, not re-implemented here.
//
// The block / button / action / condition / node compilers are exported on their own so edit_flow
// (edit-flow.mjs) compiles the SAME spec fragments against an existing flow. One vocabulary.
//
// SPEC (every node has a unique `caption`; edges name captions):
//   { root: "Caption", channel?: "instagram",
//     nodes: [
//       { caption, type: "message", private_reply?: true, next?: "Caption",
//         text?: "…", buttons?: [{caption, to?: "Caption", url?: "https://…"}],   // shorthand: one text block
//         blocks?: [ {text, buttons?}, {delay: seconds, typing?: bool},
//                    {question: {text, answer_type?, save_to?: "email"|"phone"|"first_name"|"last_name"|{field:"Name"},
//                                retry_text?, retries?, timeout?: {value, unit}, next?: "Caption", on_timeout?: "Caption"}},
//                    {image_url: "https://…", buttons?},
//                    {attachment: {type: "image"|"video"|"gif"|"pdf"|"audio"|"file", data: <object /content/upload returned>}},
//                    {cards: [{title, subtitle?, image_url?, url?, buttons?}], aspect?: "horizontal"|"square"},
//                    {dynamic: {url, method?, payload?, headers?, fallback?: "Caption"}} ],
//         quick_replies?: [{caption, to: "Caption"}] },
//       { caption, type: "actions", next?, actions: [ …see ACTION SHORTHANDS below… ] },
//       { caption, type: "condition", conditions: [{ if: <ITEM> | {all: [<ITEM>…]} | {any: [<ITEM>…]}, then: "Caption" }], else?: "Caption" },
//           ITEM = {system_field, op, value?} | {field: "Name", op, value?} | {tag: "Name", op?}
//       { caption, type: "goto", flow: "content…" },
//       { caption, type: "delay", value, unit: "minutes"|"hours"|"days", next? },
//       { caption, type: "split", randomized?, variants: [{title?, percent, to: "Caption"}] },
//       { caption, type: "ai", prompt, next?: "Caption" },
//       { caption, type: "note", text, color?, font_size?, note_size? } ] }
// ACTION SHORTHANDS (a tag/field may be a name or a numeric id):
//   {add_tag} {remove_tag} {set_field:{field,value}} {unset_field} {set_bot_field:{field,value}}
//   {external_request:{url,method?,headers?,payload?,mapping?}} {notify_admin:{text,send_to?,via?}}
//   {start_flow:"ns"} {add_to_sequence:id|"Name"} {remove_from_sequence:id|"Name"} {open_conversation:true}
//   {close_conversation:true} {assign_conversation:{user_id|group_id}} {set_optin:"sms"|"email"|"instagram"|"telegram"|"tiktok"}
//   {set_optout:"sms"|"email"|"whatsapp"|"instagram"|"telegram"|"tiktok"} {pause_automations:{duration}}
//   {pause_automation_forever:true} {resume_automation:true} {fire_custom_event:{event_id,cost?}}
//   {set_main_menu:"ns"} {integration:{type,action,data}} {raw:{type,…}}
// Text tokens: {{field:Name}} → {{cuf_<id>}}, {{bot:Name}} → {{gaf_<id>}}; system tokens pass through.
import { ATTACHMENT_UPLOAD_TYPES, ATTACHMENT_WIRE_TYPE, blocks, buttons, nodes, uuid } from './flow-model.mjs';

export class CompileError extends Error {
  constructor(problems) { super(`spec has ${problems.length} problem(s)`); this.problems = problems; }
}

const SAVE_TO = {
  email: { answer_type: 'email', adapters: [{ type: 'save_email_to_system_field' }, { type: 'set_email_optin' }] },
  phone: { answer_type: 'phone', adapters: [{ type: 'save_phone_to_system_field' }, { type: 'set_sms_optin' }] },
  first_name: { answer_type: 'first_name', adapters: [{ type: 'save_first_name_to_system_field' }] },
  last_name: { answer_type: 'last_name', adapters: [{ type: 'save_last_name_to_system_field' }] },
};
const OPTIN = { sms: 'set_sms_optin', email: 'set_email_optin', instagram: 'set_instagram_optin', telegram: 'set_telegram_optin', tiktok: 'set_tiktok_optin' };
const OPTOUT = { sms: 'set_sms_optout', email: 'set_email_optout', whatsapp: 'set_whatsapp_optout', instagram: 'set_instagram_optout', telegram: 'set_telegram_optout', tiktok: 'set_tiktok_optout' };
const INTEGRATIONS = ['hubspot', 'convertkit', 'chatgpt', 'claude', 'deepseek', 'google_sheets', 'active_campaign', 'klaviyo', 'mailchimp'];

// The compile context: name resolution, token rewriting, edge resolution, problem collection.
// `target(caption, where)` is supplied by the caller — build_flow points edges at fresh _oids,
// edit_flow points them at existing content_ids or at nodes it is adding.
export function makeCtx({ ns, resolvers = {}, target }) {
  const problems = [];
  const idOr = (v, resolve, kind, where, hint) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    const id = resolve?.(String(v));
    if (id == null) { problems.push({ where, message: `${kind} "${v}" does not exist on this account${hint ? ` (${hint})` : ''}` }); return 0; }
    return id;
  };
  const ctx = {
    ns, problems,
    tag: (name, where) => idOr(name, resolvers.tagId, 'tag', where, 'create it with create_tag; trigger auto-tags cannot be used'),
    field: (name, where) => idOr(name, resolvers.fieldId, 'custom field', where, 'create it with create_field'),
    botField: (name, where) => idOr(name, resolvers.botFieldId, 'bot field', where, 'create it with create_bot_field'),
    sequence: (name, where) => idOr(name, resolvers.sequenceId, 'sequence', where, 'list them with list_sequences; the server refuses an unknown id with "Wrong sequence"'),
    target: (cap, where) => (cap == null ? null : target(cap, where)),
    problem: (where, message) => problems.push({ where, message }),
  };
  ctx.tokens = (text, where) => String(text ?? '')
    .replace(/\{\{\s*field:([^}]+?)\s*\}\}/g, (_, name) => `{{cuf_${ctx.field(name.trim(), where)}}}`)
    .replace(/\{\{\s*bot:([^}]+?)\s*\}\}/g, (_, name) => `{{gaf_${ctx.botField(name.trim(), where)}}}`);
  return ctx;
}

export function compileButton(b, ctx, where) {
  if (b?.url) return buttons.url(String(b.caption ?? ''), ctx.tokens(b.url, where));
  const t = ctx.target(b?.to, where);
  return { _oid: uuid(), type: 'content', caption: String(b?.caption ?? ''), ...(t ?? {}), actions: [] };
}

export function compileBlock(b, ctx, where) {
  if (!b || typeof b !== 'object') { ctx.problem(where, 'a block must be an object'); return null; }
  if (b.text != null) return blocks.text(ctx.tokens(b.text, where), (b.buttons ?? []).map((x) => compileButton(x, ctx, where)));
  if (b.delay != null) return blocks.delay(Number(b.delay), b.typing ?? true);
  if (b.image_url) {
    // ManyChat refuses an image it did not store: `Attachment without caid` (proven 2026-09-03 for
    // the external_image shape its own exporter emits, for {type,url}, and for a bare URL).
    ctx.problem(where, 'ManyChat will not send an image by URL — it answers "Attachment without caid". Upload it first with upload_attachment and pass {attachment:{type:"image", data:<the returned object>}}');
    return null;
  }
  if (b.attachment) {
    if (!b.attachment.type || !b.attachment.data) {
      ctx.problem(where, `attachment needs {type: ${ATTACHMENT_UPLOAD_TYPES.join('|')}, data: <the object upload_attachment returned>}`);
      return blocks.attachment(b.attachment?.type, b.attachment?.data);
    }
    const t = String(b.attachment.type);
    // pdf and audio are builder display types; the exporter downgrades pdf -> file on the wire.
    const wire = ATTACHMENT_WIRE_TYPE[t];
    if (!wire) ctx.problem(where, `attachment type "${t}" is not one of ${ATTACHMENT_UPLOAD_TYPES.join(', ')}`);
    return blocks.attachment(wire ?? t, b.attachment.data);
  }
  if (b.cards) {
    const els = (Array.isArray(b.cards) ? b.cards : []).map((c) => blocks.card({
      title: ctx.tokens(c.title, where), subtitle: ctx.tokens(c.subtitle ?? '', where),
      image: c.image_url
        ? (ctx.problem(where, 'a card image cannot be a URL — ManyChat answers "Attachment without caid". Upload it with upload_attachment and pass the returned object as `image`'), null)
        : (c.image ?? null),
      default_action: c.url ? { type: 'url', url: ctx.tokens(c.url, where), webview_size: 'full' } : null,
      keyboard: (c.buttons ?? []).map((x) => compileButton(x, ctx, where)),
    }));
    return blocks.cards(els, { image_aspect_ratio: b.aspect ?? 'horizontal' });
  }
  if (b.dynamic) {
    const d = b.dynamic;
    // payload must reach the wire as a STRING or null — an object fails with `Something went
    // wrong` (proven 2026-09-03), the same rule external_request follows.
    const payload = d.payload == null ? null : payloadString(d.payload, ctx, where);
    return blocks.dynamic({ url: ctx.tokens(d.url, where), method: d.method ?? 'get', payload, headers: d.headers ?? {}, fallback: ctx.target(d.fallback, where) });
  }
  if (b.question) {
    const q = b.question;
    const saveTo = typeof q.save_to === 'string' ? SAVE_TO[q.save_to] : null;
    if (typeof q.save_to === 'string' && !saveTo) ctx.problem(where, `question.save_to "${q.save_to}" is not email|phone|first_name|last_name|{field:"Name"}`);
    const adapters = saveTo ? saveTo.adapters : q.save_to?.field ? [{ type: 'save_answer_to_custom_field', field_id: ctx.field(q.save_to.field, where) }] : [];
    return blocks.question({
      text: ctx.tokens(q.text, where),
      answer_type: q.answer_type ?? saveTo?.answer_type ?? 'text',
      adapters,
      validation_message: q.retry_text ?? null,
      skip_button_caption: q.skip_caption ?? null,
      limit_failed: q.retries ?? 4,
      timeout: q.timeout ?? { unit: 'minutes', value: 30 },
      success_target: ctx.target(q.next, where),
      timeout_target: ctx.target(q.on_timeout, where),
    });
  }
  ctx.problem(where, 'a block must be {text}, {delay}, {question}, {image_url}, {attachment}, {cards} or {dynamic}');
  return null;
}

const payloadString = (payload, ctx, where) => (typeof payload === 'string' ? ctx.tokens(payload, where) : ctx.tokens(JSON.stringify(payload ?? {}, null, 2), where));

export function compileAction(a, ctx, where) {
  if (!a || typeof a !== 'object') { ctx.problem(where, 'an action must be an object'); return null; }
  if (a.add_tag != null) return { type: 'add_tag', tag_id: ctx.tag(a.add_tag, where) };
  if (a.remove_tag != null) return { type: 'remove_tag', tag_id: ctx.tag(a.remove_tag, where) };
  if (a.set_field) return { type: 'set_custom_field_value', field_id: ctx.field(a.set_field.field, where), value: ctx.tokens(a.set_field.value, where) };
  if (a.unset_field != null) return { type: 'unset_custom_field_value', field_id: ctx.field(a.unset_field, where) };
  if (a.set_bot_field) return { type: 'change_global_field_value', field_id: ctx.botField(a.set_bot_field.field, where), value: ctx.tokens(a.set_bot_field.value, where) };
  if (a.external_request) {
    const e = a.external_request;
    return { type: 'external_request', url: ctx.tokens(e.url, where), method: (e.method ?? 'POST').toUpperCase(), headers: e.headers ?? { 'Content-Type': 'application/json' }, payload: payloadString(e.payload, ctx, where), mapping: e.mapping ?? [] };
  }
  if (a.notify_admin) return { type: 'notify_admin', text: ctx.tokens(a.notify_admin.text, where), send_to: a.notify_admin.send_to ?? [], all_send_by: a.notify_admin.via ?? ['email'], options: { send_link_to_live_chat: a.notify_admin.link_to_chat ?? true } };
  if (a.start_flow) return { type: 'start_flow', flow_ns: a.start_flow };
  if (a.add_to_sequence != null) return { type: 'add_to_sequence', sequence_id: ctx.sequence(a.add_to_sequence, where) };
  if (a.remove_from_sequence != null) return { type: 'remove_from_sequence', sequence_id: ctx.sequence(a.remove_from_sequence, where) };
  if (a.open_conversation) return { type: 'open_conversation' };
  if (a.close_conversation) return { type: 'close_conversation' };
  if (a.assign_conversation) return { type: 'assign_conversation', ...(a.assign_conversation.user_id != null ? { user_id: a.assign_conversation.user_id } : {}), ...(a.assign_conversation.group_id != null ? { group_id: a.assign_conversation.group_id } : {}) };
  if (a.set_optin) { const t = OPTIN[a.set_optin]; if (!t) ctx.problem(where, `set_optin "${a.set_optin}" is not ${Object.keys(OPTIN).join('|')}`); return { type: t ?? 'set_email_optin', optin: true }; }
  if (a.set_optout) { const t = OPTOUT[a.set_optout]; if (!t) ctx.problem(where, `set_optout "${a.set_optout}" is not ${Object.keys(OPTOUT).join('|')}`); return { type: t ?? 'set_email_optout' }; }
  if (a.pause_automations) return { type: 'pause_automations', pause_duration: a.pause_automations.duration ?? a.pause_automations.pause_duration };
  if (a.pause_automation_forever) return { type: 'pause_automation_forever' };
  if (a.resume_automation) return { type: 'resume_automation' };
  if (a.fire_custom_event) return { type: 'fire_custom_event', event_id: a.fire_custom_event.event_id, ...(a.fire_custom_event.cost != null ? { cost: a.fire_custom_event.cost } : {}) };
  if (a.set_main_menu) return { type: 'set_user_level_menu', main_menu_flow_ns: a.set_main_menu };
  if (a.integration) {
    if (!INTEGRATIONS.includes(a.integration.type)) ctx.problem(where, `integration.type "${a.integration.type}" is not ${INTEGRATIONS.join('|')}`);
    return { type: a.integration.type, action: a.integration.action, data: a.integration.data ?? {} };
  }
  if (a.raw?.type) return { ...a.raw };
  ctx.problem(where, `unrecognised action ${JSON.stringify(a).slice(0, 80)}`);
  return null;
}

function compileConditionItem(w, ctx, where) {
  if (w.system_field) return { _oid: uuid(), type: 'suf', field: w.system_field, operator: w.op ?? 'HAS_VALUE', ...(w.value !== undefined ? { value: w.value } : {}) };
  if (w.field) return { _oid: uuid(), type: 'cuf', field: `cuf_${ctx.field(w.field, where)}`, operator: w.op ?? 'HAS_VALUE', ...(w.value !== undefined ? { value: w.value } : {}) };
  if (w.tag != null) return { _oid: uuid(), type: 'tag', field: 'tag', operator: w.op ?? 'IS', value: ctx.tag(w.tag, where) };
  ctx.problem(where, 'a condition item needs system_field, field or tag');
  return null;
}

// `if` is one item, {all:[…]} (every item must hold) or {any:[…]} (one is enough).
// A ManyChat filter is TWO levels: `groups` joined by `operator`, and items inside each group
// joined by that group's own `operator`. So the spec's `all` / `any` nest exactly one level deep,
// and that is enough to write every condition the builder can:
//
//   if: {system_field:…}                         one item
//   if: { all: [a, b] }                          a AND b                       (one AND group)
//   if: { any: [a, b] }                          a OR b                        (one OR group)
//   if: { all: [ {any:[a,b]}, c ] }              (a OR b) AND c                (two groups, AND)
//   if: { any: [ {all:[a,b]}, c ] }              (a AND b) OR c                (two groups, OR)
//
// A third level has nowhere to go in the wire shape, so it is refused by name rather than
// silently flattened into a filter that means something else.
export function compileFilter(ifSpec, ctx, where) {
  if (!ifSpec || typeof ifSpec !== 'object') { ctx.problem(where, 'condition.if is required'); return { operator: 'AND', groups: [] }; }
  const outer = Array.isArray(ifSpec.all) ? 'AND' : Array.isArray(ifSpec.any) ? 'OR' : null;
  if (!outer) {
    const one = compileConditionItem(ifSpec, ctx, where);
    return { operator: 'AND', groups: [{ operator: 'AND', items: one ? [one] : [] }] };
  }
  const list = ifSpec.all ?? ifSpec.any;
  if (!list.length) ctx.problem(where, 'condition.if all/any needs at least one item');
  const groups = [];
  const loose = [];
  for (const entry of list) {
    const innerOp = Array.isArray(entry?.all) ? 'AND' : Array.isArray(entry?.any) ? 'OR' : null;
    if (!innerOp) { loose.push(entry); continue; }
    const inner = entry.all ?? entry.any;
    if (inner.some((x) => Array.isArray(x?.all) || Array.isArray(x?.any))) {
      ctx.problem(where, 'condition.if nests at most one level (a ManyChat filter is groups of items); flatten the third level');
      continue;
    }
    groups.push({ operator: innerOp, items: inner.map((w) => compileConditionItem(w, ctx, where)).filter(Boolean) });
  }
  // The un-nested entries share one group, joined by the OUTER operator — `all:[a,b]` is one AND
  // group, `any:[a,b]` one OR group, which is what the two simple forms above must produce.
  if (loose.length) groups.push({ operator: outer, items: loose.map((w) => compileConditionItem(w, ctx, where)).filter(Boolean) });
  return { operator: outer, groups };
}

// One spec node → one content object. `oid` is the node's _oid (fresh for new nodes). Edges go
// through ctx.target so the caller decides between fresh-_oid and content_id references.
export function compileNode(n, ctx, oid) {
  const cap = String(n.caption ?? '').trim();
  const where = cap;
  const type = n.type ?? 'message';
  let node;
  if (type === 'message' || type === 'instagram') {
    node = nodes.channel(n.channel ?? ctx.channel ?? 'instagram', ctx.ns, cap);
    if (n.private_reply) node.private_reply = 'private_reply';
    const blockSpecs = Array.isArray(n.blocks) ? [...n.blocks] : [];
    if (n.text != null || n.buttons) blockSpecs.unshift({ text: n.text ?? '', buttons: n.buttons ?? [] });
    for (const b of blockSpecs) { const blk = compileBlock(b, ctx, where); if (blk) node.messages.push(blk); }
    if (n.quick_replies?.length) node.quick_replies = { buttons: n.quick_replies.map((x) => compileButton(x, ctx, where)), settings: {} };
    node.target = ctx.target(n.next, where);
  } else if (type === 'actions' || type === 'action_group') {
    const acts = (n.actions ?? []).map((a) => compileAction(a, ctx, where)).filter(Boolean);
    node = nodes.actionGroup(ctx.ns, cap, acts, { target: ctx.target(n.next, where) });
  } else if (type === 'condition') {
    node = nodes.condition(ctx.ns, cap);
    for (const c of n.conditions ?? []) node.conditions.push({ _oid: uuid(), filter: compileFilter(c.if, ctx, where), target: ctx.target(c.then, where) });
    node.default_target = ctx.target(n.else, where);
  } else if (type === 'goto') {
    if (!n.flow) ctx.problem(where, 'goto needs flow: "<ns>"');
    node = nodes.goto(ctx.ns, cap, n.flow);
  } else if (type === 'delay' || type === 'smart_delay') {
    node = nodes.smartDelay(ctx.ns, cap, Number(n.value), n.unit ?? 'minutes');
    node.target = ctx.target(n.next, where);
  } else if (type === 'split') {
    node = nodes.split(ctx.ns, cap, n.randomized ?? true);
    const colors = ['#5AB2FF', '#8DDF6D', '#FFC94F', '#FF8A65', '#B39DDB', '#4DD0E1'];
    (n.variants ?? []).forEach((v, i) => node.variants.push({ _oid: uuid(), type: 'variant', data: { color: colors[i % colors.length], title: v.title ?? String.fromCharCode(65 + i) }, percent: Number(v.percent), target: ctx.target(v.to, where) }));
  } else if (type === 'ai' || type === 'ai_node') {
    node = nodes.aiNode(ctx.ns, cap, ctx.tokens(n.prompt, where), { default_target: ctx.target(n.next, where), abilities: n.abilities ?? [], resources: n.resources ?? null });
  } else if (type === 'note') {
    node = nodes.note(ctx.ns, String(n.text ?? ''), { color: n.color, font_size: n.font_size, note_size: n.note_size });
  } else {
    ctx.problem(where, `unknown node type "${type}" (message|actions|condition|goto|delay|split|ai|note)`);
    return null;
  }
  if (oid) node._oid = oid;
  return node;
}

// Whole spec → batch. Every node compiles (so every problem is reported at once); captions are the
// edge addresses and must be unique.
export function compileSpec(spec, { ns, resolvers = {} } = {}) {
  const entries = [];
  const captions = new Map();
  const list = Array.isArray(spec?.nodes) ? spec.nodes : [];
  const pre = [];
  if (!ns) pre.push({ where: 'ns', message: 'a flow namespace (ns) is required — create the flow first or let build_flow create it' });
  if (!list.length) pre.push({ where: 'nodes', message: 'spec.nodes is empty' });
  for (const n of list) {
    const cap = String(n?.caption ?? '').trim();
    if (!cap) { pre.push({ where: 'nodes', message: 'every node needs a caption' }); continue; }
    const entry = { spec: n, oid: uuid(), cap };
    entries.push(entry);
    if (captions.has(cap)) pre.push({ where: cap, message: `duplicate caption "${cap}" — captions are the edge addresses and must be unique` });
    else captions.set(cap, entry);
  }
  const rootCap = String(spec?.root ?? '').trim();
  if (!rootCap) pre.push({ where: 'root', message: 'spec.root must name the first node by caption' });
  else if (!captions.has(rootCap)) pre.push({ where: 'root', message: `spec.root "${rootCap}" names no node` });

  const ctx = makeCtx({ ns: ns ?? 'PENDING', resolvers, target: (cap, where) => {
    const e = captions.get(String(cap));
    if (!e) { ctx.problem(where, `edge to unknown caption "${cap}"`); return null; }
    return { _content_oid: e.oid };
  } });
  ctx.channel = spec?.channel ?? 'instagram';
  ctx.problems.push(...pre);
  const contents = entries.map(({ spec: n, oid }) => compileNode(n, ctx, oid)).filter(Boolean);
  if (ctx.problems.length) throw new CompileError(ctx.problems);
  return { contents, root: captions.get(rootCap).oid, captionToOid: Object.fromEntries([...captions].map(([k, v]) => [k, v.oid])), warnings: [] };
}

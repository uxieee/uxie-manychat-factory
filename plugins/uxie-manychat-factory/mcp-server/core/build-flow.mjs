// The compiler: a compact, caption-addressed spec → a ManyChat contents batch with fresh _oids.
// Names (tags, custom fields, bot fields) resolve against the account through `resolvers`; the
// compiler itself never touches the network. The comment-reply root rules are applied by the
// shared ledger (rules.mjs) on the compiled batch, not re-implemented here.
//
// SPEC (every node has a unique `caption`; edges name captions):
//   { root: "Caption", channel?: "instagram",
//     nodes: [
//       { caption, type: "message", private_reply?: true, next?: "Caption",
//         text?: "…", buttons?: [{caption, to?: "Caption", url?: "https://…"}],   // shorthand: one text block
//         blocks?: [ {text, buttons?}, {delay: seconds, typing?: bool},
//                    {question: {text, answer_type, save_to?: "email"|"phone"|"first_name"|"last_name"|{field:"Name"},
//                                retry_text?, retries?, timeout?: {value, unit}, next?: "Caption", on_timeout?: "Caption"}} ],
//         quick_replies?: [{caption, to: "Caption"}] },
//       { caption, type: "actions", next?, actions: [ {add_tag: "Name"}, {remove_tag: "Name"},
//           {set_field: {field: "Name", value}}, {unset_field: "Name"}, {set_bot_field: {field: "Name", value}},
//           {external_request: {url, method?, headers?, payload?, mapping?}}, {notify_admin: {text, send_to?, via?}},
//           {start_flow: "content…"}, {raw: {type, …}} ] },
//       { caption, type: "condition", conditions: [{ if: {system_field|field|tag, op, value?}, then: "Caption" }], else?: "Caption" },
//       { caption, type: "goto", flow: "content…" },
//       { caption, type: "delay", value, unit: "minutes"|"hours"|"days", next? },
//       { caption, type: "split", randomized?, variants: [{title?, percent, to: "Caption"}] },
//       { caption, type: "note", text, color?, font_size?, note_size? } ] }
// Text tokens: {{field:Name}} → {{cuf_<id>}}, {{bot:Name}} → {{gaf_<id>}}; system tokens pass through.
import { blocks, buttons, nodes, ref, uuid } from './flow-model.mjs';

export class CompileError extends Error {
  constructor(problems) { super(`spec has ${problems.length} problem(s)`); this.problems = problems; }
}

const SAVE_TO = {
  email: { answer_type: 'email', adapters: [{ type: 'save_email_to_system_field' }, { type: 'set_email_optin' }] },
  phone: { answer_type: 'phone', adapters: [{ type: 'save_phone_to_system_field' }, { type: 'set_sms_optin' }] },
  first_name: { answer_type: 'first_name', adapters: [{ type: 'save_first_name_to_system_field' }] },
  last_name: { answer_type: 'last_name', adapters: [{ type: 'save_last_name_to_system_field' }] },
};

// resolvers: { tagId(name)→id|null, fieldId(name)→id|null, botFieldId(name)→id|null }
export function compileSpec(spec, { ns, resolvers = {} } = {}) {
  const problems = [];
  const warnings = [];
  if (!ns) problems.push({ where: 'ns', message: 'a flow namespace (ns) is required — create the flow first or let build_flow create it' });
  const list = Array.isArray(spec?.nodes) ? spec.nodes : [];
  if (!list.length) problems.push({ where: 'nodes', message: 'spec.nodes is empty' });
  // Every node compiles (so every problem is reported at once); the caption map keeps the FIRST
  // node under a duplicated caption for edge resolution and reports the duplicate.
  const entries = [];
  const captions = new Map();
  for (const n of list) {
    const cap = String(n?.caption ?? '').trim();
    if (!cap) { problems.push({ where: 'nodes', message: 'every node needs a caption' }); continue; }
    const entry = { spec: n, oid: uuid(), cap };
    entries.push(entry);
    if (captions.has(cap)) problems.push({ where: cap, message: `duplicate caption "${cap}" — captions are the edge addresses and must be unique` });
    else captions.set(cap, entry);
  }
  const rootCap = String(spec?.root ?? '').trim();
  if (!rootCap) problems.push({ where: 'root', message: 'spec.root must name the first node by caption' });
  else if (!captions.has(rootCap)) problems.push({ where: 'root', message: `spec.root "${rootCap}" names no node` });
  const oidOf = (cap, where) => {
    if (cap == null) return null;
    const e = captions.get(String(cap));
    if (!e) { problems.push({ where, message: `edge to unknown caption "${cap}"` }); return null; }
    return e.oid;
  };
  const tag = (name, where) => {
    const id = resolvers.tagId?.(name);
    if (id == null) { problems.push({ where, message: `tag "${name}" does not exist on this account (create it with create_tag; trigger auto-tags cannot be used)` }); return 0; }
    return id;
  };
  const field = (name, where) => {
    const id = resolvers.fieldId?.(name);
    if (id == null) { problems.push({ where, message: `custom field "${name}" does not exist on this account (create it with create_field)` }); return 0; }
    return id;
  };
  const botField = (name, where) => {
    const id = resolvers.botFieldId?.(name);
    if (id == null) { problems.push({ where, message: `bot field "${name}" does not exist on this account (create it with create_bot_field)` }); return 0; }
    return id;
  };
  const tokens = (text, where) => String(text ?? '')
    .replace(/\{\{\s*field:([^}]+?)\s*\}\}/g, (_, name) => `{{cuf_${field(name.trim(), where)}}}`)
    .replace(/\{\{\s*bot:([^}]+?)\s*\}\}/g, (_, name) => `{{gaf_${botField(name.trim(), where)}}}`);
  const mkButton = (b, where) => {
    if (b?.url) return buttons.url(String(b.caption ?? ''), String(b.url));
    return buttons.content(String(b?.caption ?? ''), oidOf(b?.to, where));
  };

  const contents = [];
  for (const { spec: n, oid, cap } of entries) {
    const type = n.type ?? 'message';
    const where = cap;
    if (type === 'message' || type === 'instagram') {
      const node = nodes.channel(n.channel ?? spec.channel ?? 'instagram', ns, cap);
      node._oid = oid;
      if (n.private_reply) node.private_reply = 'private_reply';
      const blockSpecs = Array.isArray(n.blocks) ? n.blocks : [];
      if (n.text != null || n.buttons) blockSpecs.unshift({ text: n.text ?? '', buttons: n.buttons ?? [] });
      for (const b of blockSpecs) {
        if (b.text != null) node.messages.push(blocks.text(tokens(b.text, where), (b.buttons ?? []).map((x) => mkButton(x, where))));
        else if (b.delay != null) node.messages.push(blocks.delay(Number(b.delay), b.typing ?? true));
        else if (b.question) {
          const q = b.question;
          const saveTo = typeof q.save_to === 'string' ? SAVE_TO[q.save_to] : null;
          if (typeof q.save_to === 'string' && !saveTo) problems.push({ where, message: `question.save_to "${q.save_to}" is not email|phone|first_name|last_name|{field:"Name"}` });
          const adapters = saveTo ? saveTo.adapters : q.save_to?.field ? [{ type: 'save_answer_to_custom_field', field_id: field(q.save_to.field, where) }] : [];
          node.messages.push(blocks.question({
            text: tokens(q.text, where),
            answer_type: q.answer_type ?? saveTo?.answer_type ?? 'text',
            adapters,
            validation_message: q.retry_text ?? null,
            skip_button_caption: q.skip_caption ?? null,
            limit_failed: q.retries ?? 4,
            timeout: q.timeout ?? { unit: 'minutes', value: 30 },
            success_target: q.next ? ref(oidOf(q.next, where)) : null,
            timeout_target: q.on_timeout ? ref(oidOf(q.on_timeout, where)) : null,
          }));
        } else problems.push({ where, message: 'a block must be {text}, {delay} or {question}' });
      }
      if (n.quick_replies?.length) node.quick_replies = { buttons: n.quick_replies.map((x) => mkButton(x, where)), settings: {} };
      if (n.next) node.target = ref(oidOf(n.next, where));
      contents.push(node);
    } else if (type === 'actions' || type === 'action_group') {
      const acts = [];
      for (const a of n.actions ?? []) {
        if (a.add_tag) acts.push({ type: 'add_tag', tag_id: tag(a.add_tag, where) });
        else if (a.remove_tag) acts.push({ type: 'remove_tag', tag_id: tag(a.remove_tag, where) });
        else if (a.set_field) acts.push({ type: 'set_custom_field_value', field_id: field(a.set_field.field, where), value: tokens(a.set_field.value, where) });
        else if (a.unset_field) acts.push({ type: 'unset_custom_field_value', field_id: field(a.unset_field, where) });
        else if (a.set_bot_field) acts.push({ type: 'change_global_field_value', field_id: botField(a.set_bot_field.field, where), value: tokens(a.set_bot_field.value, where) });
        else if (a.external_request) {
          const e = a.external_request;
          acts.push({ type: 'external_request', url: tokens(e.url, where), method: e.method ?? 'POST', headers: e.headers ?? { 'Content-Type': 'application/json' }, payload: typeof e.payload === 'string' ? tokens(e.payload, where) : JSON.stringify(e.payload ?? {}, null, 2).replace(/\{\{\s*field:([^}]+?)\s*\}\}/g, (_, nm) => `{{cuf_${field(nm.trim(), where)}}}`).replace(/\{\{\s*bot:([^}]+?)\s*\}\}/g, (_, nm) => `{{gaf_${botField(nm.trim(), where)}}}`), mapping: e.mapping ?? [] });
        } else if (a.notify_admin) acts.push({ type: 'notify_admin', text: tokens(a.notify_admin.text, where), send_to: a.notify_admin.send_to ?? [], all_send_by: a.notify_admin.via ?? ['email'], options: { send_link_to_live_chat: a.notify_admin.link_to_chat ?? true } });
        else if (a.start_flow) acts.push({ type: 'start_flow', flow_ns: a.start_flow });
        else if (a.raw?.type) acts.push({ ...a.raw });
        else problems.push({ where, message: `unrecognised action ${JSON.stringify(a).slice(0, 80)}` });
      }
      const node = nodes.actionGroup(ns, cap, acts, { target: n.next ? ref(oidOf(n.next, where)) : null });
      node._oid = oid;
      contents.push(node);
    } else if (type === 'condition') {
      const node = nodes.condition(ns, cap); node._oid = oid;
      for (const c of n.conditions ?? []) {
        const w = c.if ?? {};
        let item;
        if (w.system_field) item = { _oid: uuid(), type: 'suf', field: w.system_field, operator: w.op ?? 'HAS_VALUE', ...(w.value !== undefined ? { value: w.value } : {}) };
        else if (w.field) item = { _oid: uuid(), type: 'cuf', field: `cuf_${field(w.field, where)}`, operator: w.op ?? 'HAS_VALUE', ...(w.value !== undefined ? { value: w.value } : {}) };
        else if (w.tag) item = { _oid: uuid(), type: 'tag', field: 'tag', operator: w.op ?? 'IS', value: tag(w.tag, where) };
        else { problems.push({ where, message: 'condition.if needs system_field, field or tag' }); continue; }
        node.conditions.push({ _oid: uuid(), filter: { operator: 'AND', groups: [{ operator: 'AND', items: [item] }] }, target: c.then ? ref(oidOf(c.then, where)) : null });
      }
      if (n.else) node.default_target = ref(oidOf(n.else, where));
      contents.push(node);
    } else if (type === 'goto') {
      if (!n.flow) problems.push({ where, message: 'goto needs flow: "<ns>"' });
      const node = nodes.goto(ns, cap, n.flow); node._oid = oid; contents.push(node);
    } else if (type === 'delay' || type === 'smart_delay') {
      const node = nodes.smartDelay(ns, cap, Number(n.value), n.unit ?? 'minutes'); node._oid = oid;
      if (n.next) node.target = ref(oidOf(n.next, where));
      contents.push(node);
    } else if (type === 'split') {
      const node = nodes.split(ns, cap, n.randomized ?? true); node._oid = oid;
      const colors = ['#5AB2FF', '#8DDF6D', '#FFC94F', '#FF8A65', '#B39DDB', '#4DD0E1'];
      (n.variants ?? []).forEach((v, i) => node.variants.push({ _oid: uuid(), type: 'variant', data: { color: colors[i % colors.length], title: v.title ?? String.fromCharCode(65 + i) }, percent: Number(v.percent), target: v.to ? ref(oidOf(v.to, where)) : null }));
      contents.push(node);
    } else if (type === 'note') {
      const node = nodes.note(ns, String(n.text ?? ''), { color: n.color, font_size: n.font_size, note_size: n.note_size }); node._oid = oid; node.caption = 'note'; contents.push(node);
    } else problems.push({ where, message: `unknown node type "${type}" (message|actions|condition|goto|delay|split|note)` });
  }
  if (problems.length) throw new CompileError(problems);
  return { contents, root: captions.get(rootCap).oid, captionToOid: Object.fromEntries([...captions].map(([k, v]) => [k, v.oid])), warnings };
}

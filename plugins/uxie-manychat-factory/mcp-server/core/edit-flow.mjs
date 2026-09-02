// edit_flow's engine: caption-addressed operations applied to a PUBLISHED flow's batch (the shape
// publishedToBatch returns), producing a new batch for the same publish path the compiler uses.
// Edges to existing nodes are written {content_id, _content_oid} — exactly what the server returns
// on read — and edges to nodes added in the same edit are {_content_oid}. Nothing here touches the
// network; the caller runs the ledger, publishes, and verifies.
//
// OPS (all address nodes by caption):
//   { op: "set_text",        node, text, block?: 0 }
//   { op: "set_caption",     node, caption }
//   { op: "set_next",        node, to: "Caption" | null }
//   { op: "set_private_reply", node, value: true|false }
//   { op: "add_button",      node, button: {caption, to?|url?}, block?: 0 }
//   { op: "set_button",      node, caption, to?, url?, new_caption?, block?: 0 }
//   { op: "remove_button",   node, caption, block?: 0 }
//   { op: "set_quick_replies", node, quick_replies: [{caption, to}] }
//   { op: "add_block",       node, block: <block spec>, at?: index }
//   { op: "replace_block",   node, block: <block spec>, at: index }
//   { op: "remove_block",    node, at: index }
//   { op: "set_actions",     node, actions: [<action spec>…] }
//   { op: "add_action",      node, action: <action spec>, at?: index }
//   { op: "remove_action",   node, at: index }
//   { op: "set_conditions",  node, conditions: [{if, then}], else? }
//   { op: "set_delay",       node, value, unit }
//   { op: "set_split",       node, variants: [{title?, percent, to}], randomized? }
//   { op: "set_goto",        node, flow }
//   { op: "set_prompt",      node, prompt }
//   { op: "add_node",        node: <node spec> }                         // fresh node, edges by caption
//   { op: "remove_node",     node, rewire?: "Caption" | null }           // removed:true; every edge into it is
//                                                                          // re-pointed at `rewire` (or must not exist)
//   { op: "set_root",        node }
import { compileAction, compileBlock, compileButton, compileFilter, compileNode, makeCtx } from './build-flow.mjs';
import { targetRefs, uuid } from './flow-model.mjs';

export class EditError extends Error {
  constructor(problems) { super(`edit has ${problems.length} problem(s)`); this.problems = problems; }
}

const CHANNEL = new Set(['default', 'instagram', 'whatsapp', 'telegram', 'tiktok', 'sms', 'email_new']);

export function applyOps({ batch, ops, ns, resolvers = {} }) {
  const contents = batch.contents.map((c) => ({ ...c }));   // shallow copies; nested objects are replaced, not mutated in place
  let root = batch.root;
  const byCaption = new Map();
  for (const c of contents) if (!c.removed) byCaption.set(String(c.caption), c);
  const added = new Set(); const changed = new Set(); const removed = new Set();

  const refTo = (node) => (node.content_id != null ? { content_id: node.content_id, _content_oid: node._oid } : { _content_oid: node._oid });
  const ctx = makeCtx({ ns, resolvers, target: (cap, where) => {
    const n = byCaption.get(String(cap));
    if (!n) { ctx.problem(where, `edge to unknown caption "${cap}"`); return null; }
    return refTo(n);
  } });
  ctx.channel = 'instagram';

  const need = (op, i) => {
    const n = byCaption.get(String(op.node));
    if (!n) ctx.problem(`ops[${i}] ${op.op}`, `no node with caption "${op.node}"`);
    return n;
  };
  const touch = (n) => { if (!added.has(n._oid)) changed.add(n.caption); };
  const blockAt = (n, op, i) => {
    if (!CHANNEL.has(n.type)) { ctx.problem(`ops[${i}] ${op.op}`, `"${n.caption}" is ${/^[aeiou]/.test(n.type) ? 'an' : 'a'} ${n.type} node, not a message node`); return null; }
    const idx = op.block ?? 0;
    const b = (n.messages ?? [])[idx];
    if (!b) ctx.problem(`ops[${i}] ${op.op}`, `"${n.caption}" has no block ${idx}`);
    return b;
  };
  const replaceBlock = (n, idx, blk) => { n.messages = n.messages.map((b, j) => (j === idx ? blk : b)); };

  ops.forEach((op, i) => {
    const where = `ops[${i}] ${op?.op}`;
    switch (op?.op) {
      case 'set_text': { const n = need(op, i); if (!n) break; const b = blockAt(n, op, i); if (!b) break;
        if (b.type !== 'text' && b.type !== 'question') { ctx.problem(where, `block ${op.block ?? 0} of "${n.caption}" is a ${b.type} block`); break; }
        replaceBlock(n, op.block ?? 0, { ...b, content: { ...(b.content ?? {}), text: ctx.tokens(op.text, where) } }); touch(n); break; }
      case 'set_caption': { const n = need(op, i); if (!n) break; const cap = String(op.caption ?? '').trim();
        if (!cap) { ctx.problem(where, 'caption cannot be blank'); break; }
        if (byCaption.has(cap) && byCaption.get(cap) !== n) { ctx.problem(where, `caption "${cap}" is already used`); break; }
        byCaption.delete(String(n.caption)); n.caption = cap; byCaption.set(cap, n); touch(n); break; }
      case 'set_next': { const n = need(op, i); if (!n) break;
        if (n.type === 'multi_condition' || n.type === 'split' || n.type === 'goto' || n.type === 'note') { ctx.problem(where, `"${n.caption}" (${n.type}) has no single next step; use set_conditions / set_split / set_goto`); break; }
        const key = n.type === 'ai_node' ? 'default_target' : 'target';
        n[key] = op.to == null ? null : ctx.target(op.to, where); touch(n); break; }
      case 'set_private_reply': { const n = need(op, i); if (!n) break; if (!CHANNEL.has(n.type)) { ctx.problem(where, `"${n.caption}" is not a message node`); break; }
        n.private_reply = op.value ? 'private_reply' : null; touch(n); break; }
      case 'add_button': { const n = need(op, i); if (!n) break; const b = blockAt(n, op, i); if (!b) break;
        replaceBlock(n, op.block ?? 0, { ...b, keyboard: [...(b.keyboard ?? []), compileButton(op.button, ctx, where)] }); touch(n); break; }
      case 'set_button': { const n = need(op, i); if (!n) break; const b = blockAt(n, op, i); if (!b) break;
        const j = (b.keyboard ?? []).findIndex((x) => x.caption === op.caption);
        if (j < 0) { ctx.problem(where, `no button "${op.caption}" on block ${op.block ?? 0} of "${n.caption}"`); break; }
        const old = b.keyboard[j];
        const fresh = compileButton({ caption: op.new_caption ?? old.caption, ...(op.url ? { url: op.url } : op.to ? { to: op.to } : old.url ? { url: old.url } : {}) }, ctx, where);
        if (!op.url && !op.to && !old.url) Object.assign(fresh, { content_id: old.content_id, _content_oid: old._content_oid });
        fresh._oid = old._oid;
        replaceBlock(n, op.block ?? 0, { ...b, keyboard: b.keyboard.map((x, k) => (k === j ? fresh : x)) }); touch(n); break; }
      case 'remove_button': { const n = need(op, i); if (!n) break; const b = blockAt(n, op, i); if (!b) break;
        const before = (b.keyboard ?? []).length;
        const kb = (b.keyboard ?? []).filter((x) => x.caption !== op.caption);
        if (kb.length === before) { ctx.problem(where, `no button "${op.caption}" on block ${op.block ?? 0} of "${n.caption}"`); break; }
        replaceBlock(n, op.block ?? 0, { ...b, keyboard: kb }); touch(n); break; }
      case 'set_quick_replies': { const n = need(op, i); if (!n) break; if (!CHANNEL.has(n.type)) { ctx.problem(where, `"${n.caption}" is not a message node`); break; }
        n.quick_replies = { buttons: (op.quick_replies ?? []).map((x) => compileButton(x, ctx, where)), settings: n.quick_replies?.settings ?? {} }; touch(n); break; }
      case 'add_block': { const n = need(op, i); if (!n) break; if (!CHANNEL.has(n.type)) { ctx.problem(where, `"${n.caption}" is not a message node`); break; }
        const blk = compileBlock(op.block, ctx, where); if (!blk) break;
        const msgs = [...(n.messages ?? [])]; msgs.splice(op.at ?? msgs.length, 0, blk); n.messages = msgs; touch(n); break; }
      case 'replace_block': { const n = need(op, i); if (!n) break; const b = blockAt(n, { ...op, block: op.at }, i); if (!b) break;
        const blk = compileBlock(op.block, ctx, where); if (!blk) break; replaceBlock(n, op.at, blk); touch(n); break; }
      case 'remove_block': { const n = need(op, i); if (!n) break; const b = blockAt(n, { ...op, block: op.at }, i); if (!b) break;
        n.messages = n.messages.filter((_, j) => j !== op.at); touch(n); break; }
      case 'set_actions': { const n = need(op, i); if (!n) break; if (n.type !== 'action_group') { ctx.problem(where, `"${n.caption}" is not an action group`); break; }
        n.actions = (op.actions ?? []).map((a) => compileAction(a, ctx, where)).filter(Boolean).map((a) => ({ _oid: uuid(), ...a })); touch(n); break; }
      case 'add_action': { const n = need(op, i); if (!n) break; if (n.type !== 'action_group') { ctx.problem(where, `"${n.caption}" is not an action group`); break; }
        const a = compileAction(op.action, ctx, where); if (!a) break;
        const acts = [...(n.actions ?? [])]; acts.splice(op.at ?? acts.length, 0, { _oid: uuid(), ...a }); n.actions = acts; touch(n); break; }
      case 'remove_action': { const n = need(op, i); if (!n) break; if (n.type !== 'action_group') { ctx.problem(where, `"${n.caption}" is not an action group`); break; }
        if (!(n.actions ?? [])[op.at]) { ctx.problem(where, `"${n.caption}" has no action ${op.at}`); break; }
        n.actions = n.actions.filter((_, j) => j !== op.at); touch(n); break; }
      case 'set_conditions': { const n = need(op, i); if (!n) break; if (n.type !== 'multi_condition') { ctx.problem(where, `"${n.caption}" is not a condition node`); break; }
        n.conditions = (op.conditions ?? []).map((c) => ({ _oid: uuid(), filter: compileFilter(c.if, ctx, where), target: ctx.target(c.then, where) }));
        n.default_target = ctx.target(op.else, where); touch(n); break; }
      case 'set_delay': { const n = need(op, i); if (!n) break; if (n.type !== 'smart_delay') { ctx.problem(where, `"${n.caption}" is not a delay node`); break; }
        n.shift_time = { unit: op.unit ?? n.shift_time?.unit ?? 'minutes', value: Number(op.value) }; touch(n); break; }
      case 'set_split': { const n = need(op, i); if (!n) break; if (n.type !== 'split') { ctx.problem(where, `"${n.caption}" is not a split node`); break; }
        const colors = ['#5AB2FF', '#8DDF6D', '#FFC94F', '#FF8A65', '#B39DDB', '#4DD0E1'];
        n.variants = (op.variants ?? []).map((v, k) => ({ _oid: uuid(), type: 'variant', data: { color: colors[k % colors.length], title: v.title ?? String.fromCharCode(65 + k) }, percent: Number(v.percent), target: ctx.target(v.to, where) }));
        if (op.randomized != null) n.randomized = Boolean(op.randomized); touch(n); break; }
      case 'set_goto': { const n = need(op, i); if (!n) break; if (n.type !== 'goto') { ctx.problem(where, `"${n.caption}" is not a goto node`); break; }
        n.target = { flow_ns: op.flow }; touch(n); break; }
      case 'set_prompt': { const n = need(op, i); if (!n) break; if (n.type !== 'ai_node') { ctx.problem(where, `"${n.caption}" is not an AI node`); break; }
        n.prompt = ctx.tokens(op.prompt, where); touch(n); break; }
      case 'add_node': {
        const cap = String(op.node?.caption ?? '').trim();
        if (!cap) { ctx.problem(where, 'add_node needs a node spec with a caption'); break; }
        if (byCaption.has(cap)) { ctx.problem(where, `caption "${cap}" is already used`); break; }
        // Register the caption BEFORE compiling so a node may point at itself or at one added earlier.
        const placeholder = { _oid: uuid(), caption: cap, content_id: null };
        byCaption.set(cap, placeholder);
        const node = compileNode(op.node, ctx, placeholder._oid);
        if (!node) { byCaption.delete(cap); break; }
        byCaption.set(cap, node); contents.push(node); added.add(node._oid); break; }
      case 'remove_node': { const n = need(op, i); if (!n) break;
        const rewire = op.rewire === undefined ? undefined : op.rewire === null ? null : (byCaption.get(String(op.rewire)) ?? (ctx.problem(where, `rewire target "${op.rewire}" does not exist`), undefined));
        const isRef = (t) => t && ((t._content_oid && t._content_oid === n._oid) || (t.content_id != null && n.content_id != null && String(t.content_id) === String(n.content_id)));
        for (const other of contents) {
          if (other === n || other.removed) continue;
          for (const t of targetRefs(other)) if (isRef(t)) {
            if (rewire === undefined) ctx.problem(where, `"${other.caption}" still points at "${n.caption}"; pass rewire:"<caption>" or rewire:null`);
            else { const rep = rewire ? refTo(rewire) : null; for (const k of Object.keys(t)) delete t[k]; if (rep) Object.assign(t, rep); }
          }
        }
        if (String(root) === String(n._oid) || (n.content_id != null && String(root) === String(n.content_id))) ctx.problem(where, `"${n.caption}" is the root; set_root to another node first`);
        n.removed = true; byCaption.delete(String(n.caption)); removed.add(n.caption); break; }
      case 'set_root': { const n = need(op, i); if (!n) break; root = n.content_id ?? n._oid; changed.add(n.caption); break; }
      default: ctx.problem(where, `unknown op "${op?.op}"`);
    }
  });
  if (ctx.problems.length) throw new EditError(ctx.problems);
  // A null-target left behind by a rewired edge is a real null, not an empty object.
  for (const c of contents) for (const t of targetRefs(c)) { /* targetRefs skips empties already */ }
  return { contents, root, summary: { changed: [...changed], added: [...added].map((oid) => contents.find((c) => c._oid === oid)?.caption), removed: [...removed] } };
}

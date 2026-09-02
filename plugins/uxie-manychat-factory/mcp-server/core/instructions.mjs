// Server instructions — the routing rules that do not fit in a tool description. They ride the
// initialize result, so every agent reads them once per session.
export const INSTRUCTIONS = `ManyChat automation API — two rails in one local stdio server.

INTERNAL RAIL (app.manychat.com, the builder's own endpoints): everything the UI can do — flows,
nodes, publish, layout, comment triggers, DM keywords, tags, fields, bot fields. Authenticated by
a browser SESSION COOKIE + CSRF token captured by the uxie-manychat-factory:manychat-connect flow into
~/.uxie-manychat-mcp/session.json. There is no API token for this rail and sign-in sits behind a
CAPTCHA only a human can pass: on SESSION_MISSING / SESSION_EXPIRED, run the connect flow yourself
(scripts/connect.mjs) — it re-reads the browser profile's cookies with no login if the browser
session is still alive. ONE reconnect per failure; if it fails the same way, stop and report.
PUBLIC RAIL (api.manychat.com, 34 documented ops): contacts, tags, fields, sending. Bearer key
from MANYCHAT_API_KEY or captured at connect. It CANNOT build flows.

A TYPED TOOL ALWAYS WINS over raw_request. Typed tools carry the validation ledger (ManyChat's own
rules, server-vs-client marked), the multi-call dances (comment trigger = createWidget → setFlow →
setWidget → draft), fresh _oids, stat-key stripping, and a read-back on a separate request.
search_endpoints names the covering tool in coveredBy when one exists.

DRAFT-FIRST, NOTHING GOES LIVE BY ITSELF. Flows are PUBLISHED so links resolve, but a flow with
no active trigger sends nothing. create_comment_trigger and create_dm_keyword always end in
draft. set_trigger_status is the only door to active/live and needs confirm:true plus the user's
word in THIS session. send_flow (public rail) messages a real person: confirm:true, user's word.

THE COMMENT-REPLY RULES BITE. With a comment/story trigger attached, the ROOT node must be
private_reply:"private_reply", may NOT use "Next step" (target), and must be exactly ONE text
block with buttons or quick replies. So every comment-triggered flow opens with one message plus
a button ("Send it to me"); the email question goes on the next node. build_flow's spec has
private_reply:true for that node.

PUBLISH REPORTS ONE ERROR PER CALL. publish_flow runs the ledger first so you see every
server-enforced problem at once, keyed by caption. A 200 proves only what the server enforces —
client-only rules (marked C) pass the API and show up as broken nodes in the UI; the response
lists them as warnings.

SETDRAFT VALIDATES NOTHING and REPLACES the whole draft; patchDraft touches only the contents you
send; publish UPSERTS by _oid/content_id (unmentioned published nodes survive; removed:true
deletes). Never re-use _oids across batches — it corrupts the flow.

NEVER DELETE on the account. Probe objects are named TEST-CAP-* and listed by id at the end;
createWidget also mints a stray "Opt-In Message" flow per call — list it too.

IDS: flow ns = content{14 digits}_{6 digits}; tags/fields/widgets/keywords are integers; the
account id is the fb-prefixed page id in the URL. Field tokens in text: {{cuf_<id>}} (custom),
{{gaf_<id>}} (bot); condition items use the STRING "cuf_<id>".`;

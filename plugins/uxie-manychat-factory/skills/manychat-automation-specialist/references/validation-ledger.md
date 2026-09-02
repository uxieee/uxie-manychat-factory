# ManyChat's validation ledger

Every rule the tools enforce, ported once into `mcp-server/core/rules.mjs` and shared by
`check_flow`, `build_flow`, `publish_flow`, `set_flow_draft`, `create_comment_trigger` and
`create_dm_keyword`. `check_flow` with `rules:true` returns this table live.

**Layer** — where the rule lives: **S** the server enforces it on `flow/publish` and the quoted
string is what it returns; **C** only the builder UI enforces it and the API *accepts* the
violation; **S+C** both. **Blocks** — whether a finding stops the tool: every S rule blocks, and a
few C rules block by tool policy because the result cannot be activated in the UI.

Rules marked `serverEnforced: null` have not been probed on the server; they are reported as
warnings and say so.

That distinction is the whole point: a 200 from `flow/publish` proves only the S rules passed.

## Whole flow / batch

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `BATCH_ROOT_MISSING` | C | yes | Please choose next step. | root_content must name a node in the batch (its _oid) or an already-published content_id. The server accepted root_content:null when a prior root existed; the tool refuses it. |
| `DUPLICATE_OID` | S | yes | **`Something went wrong`** | Two contents sharing an _oid corrupt the flow (duplicate _oid per content_id); a later full republish fails with this string. Mint fresh _oids per node. |
| `TARGET_NOT_IN_BATCH` | S | yes | **`Content is linked to the wrong target node`** | A target {_content_oid} must name a node in the SAME batch (live-15/19). |
| `CONTENT_TYPE_UNKNOWN` | S | warn | — | setDraft stores an unknown type verbatim; the publish-side string was not captured. |

## Message node and blocks

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `NODE_NO_MESSAGE` | C | warn | Please create at least one message |  |
| `TEXT_REQUIRED` | S+C | yes | **`Text required`** |  |
| `TEXT_OVER_2000` | S | yes | **`Provided text is longer than 2000 symbols`** |  |
| `TEXT_OVER_1000` | C | warn | Text must be less than 1000 characters long | Instagram cap in the UI; the server accepted 1001 (live-08). |
| `BLOCKS_MAX_101` | C | warn | No more than 101 blocks in a message |  |
| `MESSAGE_TYPE_UNKNOWN` | S | warn | — |  |
| `DELAY_LAST` | C | warn | The Typing Delay cannot be the final element in the message |  |
| `DELAYS_IN_A_ROW` | C | warn | No more than 5 delays in a row |  |
| `QUESTION_TEXT_REQUIRED` | S+C | yes | **`You should set not empty value`** |  |
| `ANSWER_TYPE_UNSUPPORTED` | S | yes | **`Answer type {type} is unsupported`** |  |

## Buttons and quick replies

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `BUTTONS_MAX_3` | S+C | yes | **`Too many buttons`** |  |
| `BUTTON_CAPTION_REQUIRED` | S+C | yes | **`Button without caption`** |  |
| `BUTTON_CAPTION_OVER_20` | C | warn | Button title must be less than 20 characters long | server accepted 21 (live-08 publish_qrCaption21) |
| `BUTTON_URL_INVALID` | C | warn | Please enter a valid URL | server accepted "not a url" (live-08) |
| `BUTTON_TARGET_REQUIRED` | C | warn | Please select a next step for the button |  |
| `BUTTON_TYPE_UNKNOWN` | S | warn | — |  |
| `QR_MAX_13` | S | yes | **`You can add only 13 quick replies in total`** | the UI caps at 11 |
| `QR_OVER_11` | C | warn | You can add only 11 quick replies |  |
| `QR_AFTER_QUESTION` | S+C | yes | **`Quick reply can not be after question message`** |  |
| `QR_AFTER_TEXT_WITH_BUTTONS` | C | warn | Quick Replies can be added only after Text block without Buttons for the Instagram channel | server accepted (live-11) |

## Comment reply (private reply)

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `PRIVATE_REPLY_ROOT_REQUIRED` | S | yes | **`Mark this message as a "Private Reply" if you want to send it as a reply to a post, reel comment, a follow action or share to story reply.`** | key is <oid>.private_reply; applies when a comment/story trigger is attached |
| `PRIVATE_REPLY_NO_TARGET` | S | yes | **`Message reply to comment can’t be linked to Next step. Please use buttons or quick replies for that.`** |  |
| `PRIVATE_REPLY_ONE_BLOCK` | S | yes | **`Message reply to comment can contain only one block with buttons or quick replies.`** |  |

## Actions

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `ACTION_TYPE_UNSUPPORTED` | S | yes | **`Unsupported action type`** |  |
| `ACTION_NULL` | C | warn | Actions list contains null |  |
| `TAG_WRONG` | S+C | yes | **`Wrong tag`** | the tag must exist AND be a user tag; trigger auto-tags ("Post or Reel Comments #N") are refused |
| `FIELD_WRONG` | S+C | yes | **`Wrong field`** |  |
| `BOT_FIELD_UNKNOWN` | S | warn | — | change_global_field_value with an unknown field_id was not probed |
| `EXTERNAL_URL_REQUIRED` | S+C | yes | **`url cannot be empty`** |  |
| `EXTERNAL_URL_NOT_HTTPS` | C | warn | incorrect url | server accepted http:// (live-05 publish2_httpHook) |
| `EXTERNAL_PAYLOAD_JSON` | C | warn | Payload must be valid JSON |  |
| `EXTERNAL_MAPPING_INCOMPLETE` | C | warn | Mapping entries need a path and a field |  |

## Condition, split, delay, goto, note

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `CONDITION_FIELD_NOT_FOUND` | S | yes | **`Field item not found: {field}`** |  |
| `CONDITION_OPERATOR_UNSUPPORTED` | S | yes | **`Unsupported operator {op}`** |  |
| `CONDITION_CUF_FORMAT` | S | yes | **`Wrong field format: {field}`** | a custom field is the STRING cuf_<id> |
| `CONDITION_FIELD_MUST_BE_STRING` | S | yes | **`Field must be a string`** |  |
| `CONDITION_NO_TARGET` | C | warn | Please select at least one next step for condition | server accepted a condition with no targets (live-12) |
| `SPLIT_PERCENTS` | S+C | yes | **`Percents sum must be equal to 100`** |  |
| `SPLIT_VARIANTS_MIN` | C | warn | Please add at least 2 variations |  |
| `SPLIT_VARIANTS_MAX` | C | warn | Please keep maximum 6 variations |  |
| `DELAY_UNIT_INVALID` | S | yes | **`Invalid unit`** |  |
| `DELAY_VALUE_REQUIRED` | C | warn | Please enter a delay duration |  |
| `GOTO_FLOW_WRONG` | S | yes | **`Wrong content provided.`** |  |
| `GOTO_FLOW_REQUIRED` | C | warn | Please select Automation |  |
| `NOTE_FONT_SIZE` | S | yes | **`Wrong font size`** |  |
| `NOTE_SIZE` | S | yes | **`Wrong note size`** |  |
| `NOTE_COLOR` | S | yes | **`Wrong note color`** |  |
| `NOTE_TEXT_OVER_640` | C | warn | Note text must be less than 640 characters long | server accepted 641 (live-10) |

## Triggers

| Rule | Layer | Blocks | Message (S = the server's own string) | Note |
|---|---|---|---|---|
| `WIDGET_AREA_MISSING` | C | yes | Choose Specific Post or Reel to continue. | without post_covered_area the UI shows "specific Post" and refuses activation |
| `WIDGET_AREA_INVALID` | C | yes | post_covered_area must be all_posts, specific_post or next_post | server accepted "bogus" (live-06) but the UI then refuses to activate; the tool blocks it |
| `WIDGET_POST_REQUIRED` | S+C | yes | **`Please select a post to track comments`** |  |
| `WIDGET_KEYWORDS_REQUIRED` | C | warn | Create Keyword to continue. | server accepted empty keywords (live-06) |
| `WIDGET_REPLIES_MIN_3` | C | warn | Create at least 3 replies for sending randomly. | server accepted 1 (live-06) |
| `WIDGET_REPLIES_UNIQUE` | C | warn | Create 3 unique replies so they feel natural |  |
| `WIDGET_COMMENT_CONTAINS_INVALID` | C | yes | comment_contains must be specific_words or any_words |  |
| `KEYWORD_SYSTEM` | S | yes | **`Trying to rewrite system keyword rule`** |  |
| `KEYWORD_CONDITION_UNKNOWN` | S | yes | **`(HTTP 500 HTML — ManyChat crashes on an unknown condition)`** | live-04: condition:"regex" → 500 |
| `KEYWORD_REQUIRED` | C | warn | Please provide a keyword. | server accepted an empty list (live-04) |
| `KEYWORDS_MAX_12` | C | yes | No more than 12 keywords per rule | server accepted 13 (live-04) |
| `KEYWORD_RULES_MAX_5` | C | warn | No more than 5 rules per keyword trigger |  |
| `KEYWORD_CHANNEL_UNKNOWN` | C | yes | channel must be instagram, facebook, whatsapp, telegram, tiktok or sms |  |

## Proven against the live server

On 2026-09-03 twelve of these were re-proven by DIFFERENTIAL: each violation was sent straight to
`flow/publish` through `raw_request` (no validation) on a probe flow with a comment trigger
attached, and the server's `content_node_errors` string compared with the one quoted above. All
twelve matched exactly, and the flow was unchanged afterwards — a refused publish writes nothing:

`PRIVATE_REPLY_ROOT_REQUIRED` · `PRIVATE_REPLY_NO_TARGET` · `PRIVATE_REPLY_ONE_BLOCK` ·
`TEXT_REQUIRED` · `BUTTONS_MAX_3` · `BUTTON_CAPTION_REQUIRED` · `SPLIT_PERCENTS` ·
`DELAY_UNIT_INVALID` · `ANSWER_TYPE_UNSUPPORTED` · `TAG_WRONG` · `FIELD_WRONG` · `NOTE_COLOR`.

The server reports **one** `content_node_errors` entry per call, which is why the ledger runs
first: it names every server-enforced problem at once, keyed by caption.

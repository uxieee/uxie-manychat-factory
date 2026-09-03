// ManyChat's OWN validation rules, ported ONCE from the research corpus
// (manychat-internal-api-research/knowledge/corpus/flow-builder/40-rules.md, triggers/20-api.md),
// and shared by publish_flow, build_flow, set_flow_draft, create_comment_trigger and
// create_dm_keyword.
//
// Every rule carries WHERE it is enforced and the EXACT strings:
//   layer 'S'    the server enforces it on flow/publish (serverMessage = the content_node_errors text)
//   layer 'C'    only the builder UI enforces it; the API ACCEPTS the violation (clientMessage)
//   layer 'S+C'  both
// A server-enforced finding BLOCKS a publish (the call would fail anyway, one node per call); a
// client-only finding is a WARNING — the flow will publish, but the UI will show it as broken and
// a human editing it later hits the message. `serverEnforced: null` marks a rule the corpus has
// not probed on the server; it is reported as a warning and says so.
//
// The enums are verbatim from ManyChat's recovered source (bundle 490, 2026-09-02):
// common/builder/constants/BackendContentType|BackendMessageType|BackendButtonType,
// common/actions/models/Action/constants.ts, common/filter/models/AudienceFilter/constants.ts,
// apps/keywords/models/KeywordRule/constants.ts, subscribers/availableFields (live-13).

export const CONTENT_TYPES = ['default', 'form', 'persistent_menu', 'action_group', 'goto', 'multi_condition', 'conditional', 'split', 'smart_delay', 'note', 'sms', 'email_new', 'whatsapp', 'instagram', 'telegram', 'tiktok', 'agent', 'ai_node'];
export const CHANNEL_NODE_TYPES = ['default', 'instagram', 'whatsapp', 'telegram', 'tiktok', 'sms', 'email_new'];
export const MESSAGE_TYPES = ['text', 'attachment', 'cards', 'list', 'question', 'delay', 'dynamic', 'sms', 'context_cards', 'attachments', 'template', 'messenger_message_template', 'wa_list_message', 'wa_catalog_message'];
export const BUTTON_TYPES = ['content', 'location', 'url', 'cta_url', 'shop_url', 'call', 'share', 'answer', 'goto_content', 'continue_content', 'nested', 'buy', 'flow', 'otn_notify_me', 'wa_list_message_button', 'cross_channel_content'];
export const ACTION_TYPES = ['add_tag', 'fire_custom_event', 'delete_subscriber', 'send_lead_submitted_event', 'remove_tag', 'trigger_a_zap', 'add_to_sequence', 'remove_from_sequence', 'open_conversation', 'close_conversation', 'assign_conversation', 'notify_admin', 'start_flow', 'set_custom_field_value', 'unset_custom_field_value', 'change_global_field_value', 'subscribe_to_account', 'unsubscribe_from_account', 'global_unsubscribe_from_account', 'external_request', 'google_sheets', 'active_campaign', 'klaviyo', 'mailchimp', 'hubspot', 'convertkit', 'chatgpt', 'claude', 'deepseek', 'trigger_integromat', 'flodesk', 'custom_audience_user', 'custom_audience_ig_user', 'set_sms_optin', 'set_email_optin', 'set_sms_optout', 'set_email_optout', 'apps_request', 'set_user_level_menu', 'set_whatsapp_optout', 'set_instagram_optin', 'set_instagram_optout', 'set_telegram_optin', 'set_telegram_optout', 'set_tiktok_optin', 'set_tiktok_optout', 'pause_automation_forever', 'resume_automation', 'send_event_to_capi', 'pause_automations'];
export const OPERATORS = ['CASE', 'IS', 'IS_NOT', 'IN', 'NOT IN', 'CONTAINS', 'DOES_NOT_CONTAINS', 'BEGIN_WITH', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'AFTER', 'BEFORE', 'ON', 'TRUE', 'FALSE', 'HAS_VALUE', 'IS_UNKNOWN', 'DATETIME_INTERVAL_AFTER', 'DATETIME_INTERVAL_BEFORE', 'BETWEEN'];
export const ANSWER_TYPES = ['text', 'number', 'first_name', 'last_name', 'email', 'phone', 'phone_for_sms', 'url', 'file', 'image', 'location', 'mc_location', 'date', 'datetime'];
export const ANSWER_METHODS = ['input', 'reply', 'any', 'api'];
export const ADAPTERS = ['save_email_to_system_field', 'set_email_optin', 'save_first_name_to_system_field', 'save_last_name_to_system_field', 'save_phone_to_system_field', 'save_phone_to_wa_id_system_field', 'set_sms_optin', 'save_answer_to_custom_field'];
export const SYSTEM_FIELDS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'subscribed', 'user_id', 'locale', 'language', 'timezone', 'last_interaction', 'last_ig_interaction', 'ig_window_open_until', 'last_wa_interaction', 'last_tg_interaction', 'last_seen', 'last_ig_seen', 'last_wa_seen', 'messaging_window', 'ig_messaging_window', 'gender', 'ig_followers_count', 'tg_user_id', 'ig_username', 'tg_username', 'wa_id', 'phone_country_code', 'phone_us_state', 'optin_phone', 'optout_phone', 'optin_email', 'optout_email', 'messenger', 'is_eu_affected', 'optin_instagram', 'is_ig_account_follower', 'is_ig_verified_user', 'is_ig_account_follow_user', 'is_ig_window_open', 'optin_telegram', 'optin_whatsapp'];
export const STATIC_FIELDS = ['tag', 'widget', 'ads_growth_tool', 'opt_in_through_api', 'one_time_notification', 'one_time_notification_optin', 'sequence', 'system_current_datetime', 'smart_segment'];
export const DELAY_UNITS = ['minutes', 'hours', 'days'];
export const IG_ALLOWED_BLOCKS = ['text', 'attachment', 'quick_reply', 'question', 'delay', 'card', 'cards', 'dynamic', 'otn_request'];
// AttachmentBlockAttachmentType (common/builder/entityInterfaces.ts). `pdf` and `audio` are
// builder-side display types: the exporter downgrades pdf -> file, and the server stores an
// uploaded video as file too — the Parser re-derives VIDEO/PDF from data.mime on the way back.
// So the WIRE union is these five; `pdf`/`audio` are accepted by upload_attachment, not here.
export const ATTACHMENT_TYPES = ['image', 'video', 'file', 'gif', 'external_image'];
export const DYNAMIC_METHODS = ['get', 'post', 'put', 'delete'];
export const INTEGRATION_ACTIONS = ['hubspot', 'convertkit', 'chatgpt', 'claude', 'deepseek', 'google_sheets', 'active_campaign', 'klaviyo', 'mailchimp'];
export const NOTE_FONT_SIZES = ['small', 'large'];
export const NOTE_SIZES = ['small', 'medium', 'large'];
export const NOTE_COLORS = ['default', 'white', 'danger', 'success', 'info'];
export const KEYWORD_CONDITIONS = ['any_message', 'equals', 'contains', 'word_match', 'starts', 'thumbs_up', 'not_contains', 'group', 'is_about'];
export const SYSTEM_KEYWORDS = ['start', 'stop', 'subscribe', 'unsubscribe'];
export const POST_COVERED_AREAS = ['all_posts', 'specific_post', 'next_post'];
export const COMMENT_CONTAINS = ['specific_words', 'any_words'];
export const WIDGET_STATUSES = ['initial', 'draft', 'active', 'archived', 'trash'];
export const KEYWORD_STATUSES = ['draft', 'live', 'trash', 'deleted'];
export const COMMENT_TRIGGER_WIDGET_TYPES = ['feed_comment_trigger', 'instagram_story_reply', 'instagram_live_comment_reply', 'instagram_share_to_story_reply'];

// The ledger. `S` strings are the server's exact content_node_errors text (quoted from live probes);
// `C` strings are from common/builder/constants/Validation.ts and the trigger builders.
export const RULES = Object.freeze({
  BATCH_ROOT_MISSING: { layer: 'C', serverEnforced: false, clientMessage: 'Please choose next step.', note: 'root_content must name a node in the batch (its _oid) or an already-published content_id. The server accepted root_content:null when a prior root existed; the tool refuses it.', toolBlocks: true },
  DUPLICATE_OID: { layer: 'S', serverEnforced: true, serverMessage: 'Something went wrong', note: 'Two contents sharing an _oid corrupt the flow (duplicate _oid per content_id); a later full republish fails with this string. Mint fresh _oids per node.' },
  TARGET_NOT_IN_BATCH: { layer: 'S', serverEnforced: true, serverMessage: 'Content is linked to the wrong target node', note: 'A target {_content_oid} must name a node in the SAME batch (live-15/19).' },
  CONTENT_TYPE_UNKNOWN: { layer: 'S', serverEnforced: null, serverMessage: null, note: 'setDraft stores an unknown type verbatim; the publish-side string was not captured.' },
  NODE_NO_MESSAGE: { layer: 'C', serverEnforced: false, clientMessage: 'Please create at least one message' },
  TEXT_REQUIRED: { layer: 'S+C', serverEnforced: true, serverMessage: 'Text required', clientMessage: 'Please add text or remove the text block' },
  TEXT_OVER_2000: { layer: 'S', serverEnforced: true, serverMessage: 'Provided text is longer than 2000 symbols' },
  TEXT_OVER_1000: { layer: 'C', serverEnforced: false, clientMessage: 'Text must be less than 1000 characters long', note: 'Instagram cap in the UI; the server accepted 1001 (live-08).' },
  BUTTONS_MAX_3: { layer: 'S+C', serverEnforced: true, serverMessage: 'Too many buttons' },
  BUTTON_CAPTION_REQUIRED: { layer: 'S+C', serverEnforced: true, serverMessage: 'Button without caption', clientMessage: 'Please enter a button title' },
  BUTTON_CAPTION_OVER_20: { layer: 'C', serverEnforced: false, clientMessage: 'Button title must be less than 20 characters long', note: 'server accepted 21 (live-08 publish_qrCaption21)' },
  BUTTON_URL_INVALID: { layer: 'C', serverEnforced: false, clientMessage: 'Please enter a valid URL', note: 'server accepted "not a url" (live-08)' },
  BUTTON_TARGET_REQUIRED: { layer: 'C', serverEnforced: false, clientMessage: 'Please select a next step for the button' },
  BUTTON_TYPE_UNKNOWN: { layer: 'S', serverEnforced: null, serverMessage: null },
  QR_MAX_13: { layer: 'S', serverEnforced: true, serverMessage: 'You can add only 13 quick replies in total', note: 'the UI caps at 11' },
  QR_OVER_11: { layer: 'C', serverEnforced: false, clientMessage: 'You can add only 11 quick replies' },
  QR_AFTER_QUESTION: { layer: 'S+C', serverEnforced: true, serverMessage: 'Quick reply can not be after question message', clientMessage: 'Quick Replies cannot be added after User Input block' },
  QR_AFTER_TEXT_WITH_BUTTONS: { layer: 'C', serverEnforced: false, clientMessage: 'Quick Replies can be added only after Text block without Buttons for the Instagram channel', note: 'server accepted (live-11)' },
  QUESTION_TEXT_REQUIRED: { layer: 'S+C', serverEnforced: true, serverMessage: 'You should set not empty value', clientMessage: 'Please enter a question' },
  ANSWER_TYPE_UNSUPPORTED: { layer: 'S', serverEnforced: true, serverMessage: 'Answer type {type} is unsupported' },
  DELAY_LAST: { layer: 'C', serverEnforced: false, clientMessage: 'The Typing Delay cannot be the final element in the message' },
  DELAYS_IN_A_ROW: { layer: 'C', serverEnforced: false, clientMessage: 'No more than 5 delays in a row' },
  BLOCKS_MAX_101: { layer: 'C', serverEnforced: false, clientMessage: 'No more than 101 blocks in a message' },
  MESSAGE_TYPE_UNKNOWN: { layer: 'S', serverEnforced: null, serverMessage: null },
  PRIVATE_REPLY_ROOT_REQUIRED: { layer: 'S', serverEnforced: true, serverMessage: 'Mark this message as a "Private Reply" if you want to send it as a reply to a post, reel comment, a follow action or share to story reply.', note: 'key is <oid>.private_reply; applies when a comment/story trigger is attached' },
  PRIVATE_REPLY_NO_TARGET: { layer: 'S', serverEnforced: true, serverMessage: 'Message reply to comment can’t be linked to Next step. Please use buttons or quick replies for that.' },
  PRIVATE_REPLY_ONE_BLOCK: { layer: 'S', serverEnforced: true, serverMessage: 'Message reply to comment can contain only one block with buttons or quick replies.' },
  ACTION_TYPE_UNSUPPORTED: { layer: 'S', serverEnforced: true, serverMessage: 'Unsupported action type' },
  ACTION_NULL: { layer: 'C', serverEnforced: false, clientMessage: 'Actions list contains null' },
  TAG_WRONG: { layer: 'S+C', serverEnforced: true, serverMessage: 'Wrong tag', clientMessage: 'Please select or create a tag', note: 'the tag must exist AND be a user tag; trigger auto-tags ("Post or Reel Comments #N") are refused' },
  FIELD_WRONG: { layer: 'S+C', serverEnforced: true, serverMessage: 'Wrong field' },
  BOT_FIELD_UNKNOWN: { layer: 'S', serverEnforced: null, serverMessage: null, note: 'change_global_field_value with an unknown field_id was not probed' },
  EXTERNAL_URL_REQUIRED: { layer: 'S+C', serverEnforced: true, serverMessage: 'url cannot be empty', clientMessage: 'Please enter a URL' },
  EXTERNAL_URL_NOT_HTTPS: { layer: 'C', serverEnforced: false, clientMessage: 'incorrect url', note: 'server accepted http:// (live-05 publish2_httpHook)' },
  EXTERNAL_PAYLOAD_JSON: { layer: 'C', serverEnforced: false, clientMessage: 'Payload must be valid JSON' },
  EXTERNAL_MAPPING_INCOMPLETE: { layer: 'C', serverEnforced: false, clientMessage: 'Mapping entries need a path and a field' },
  CONDITION_FIELD_NOT_FOUND: { layer: 'S', serverEnforced: true, serverMessage: 'Field item not found: {field}' },
  CONDITION_OPERATOR_UNSUPPORTED: { layer: 'S', serverEnforced: true, serverMessage: 'Unsupported operator {op}' },
  CONDITION_CUF_FORMAT: { layer: 'S', serverEnforced: true, serverMessage: 'Wrong field format: {field}', note: 'a custom field is the STRING cuf_<id>' },
  CONDITION_FIELD_MUST_BE_STRING: { layer: 'S', serverEnforced: true, serverMessage: 'Field must be a string' },
  CONDITION_NO_TARGET: { layer: 'C', serverEnforced: false, clientMessage: 'Please select at least one next step for condition', note: 'server accepted a condition with no targets (live-12)' },
  SPLIT_PERCENTS: { layer: 'S+C', serverEnforced: true, serverMessage: 'Percents sum must be equal to 100', clientMessage: 'Paths must add up to 100%. Adjust your split.' },
  SPLIT_VARIANTS_MIN: { layer: 'C', serverEnforced: false, clientMessage: 'Please add at least 2 variations' },
  SPLIT_VARIANTS_MAX: { layer: 'C', serverEnforced: false, clientMessage: 'Please keep maximum 6 variations' },
  DELAY_UNIT_INVALID: { layer: 'S', serverEnforced: true, serverMessage: 'Invalid unit' },
  DELAY_VALUE_REQUIRED: { layer: 'C', serverEnforced: false, clientMessage: 'Please enter a delay duration' },
  GOTO_FLOW_WRONG: { layer: 'S', serverEnforced: true, serverMessage: 'Wrong content provided.' },
  GOTO_FLOW_REQUIRED: { layer: 'C', serverEnforced: false, clientMessage: 'Please select Automation' },
  NOTE_FONT_SIZE: { layer: 'S', serverEnforced: true, serverMessage: 'Wrong font size' },
  NOTE_SIZE: { layer: 'S', serverEnforced: true, serverMessage: 'Wrong note size' },
  NOTE_COLOR: { layer: 'S', serverEnforced: true, serverMessage: 'Wrong note color' },
  NOTE_TEXT_OVER_640: { layer: 'C', serverEnforced: false, clientMessage: 'Note text must be less than 640 characters long', note: 'server accepted 641 (live-10)' },

  // --- delivery and house conventions (0.6.0) ---------------------------------
  // Not ManyChat strings. These are OUR rules: the first is Meta's messaging
  // window, which the server never reports because the publish genuinely
  // succeeds; the rest are the operator's conventions, checked where objects
  // are created. All warn except the system-field collision, which has no
  // legitimate use and one obvious fix.
  DELAY_EXCEEDS_MESSAGING_WINDOW: { layer: 'C', serverEnforced: null, clientMessage: 'This delay puts the next send outside Meta\u2019s 24-hour messaging window, so it will publish and never deliver.', note: 'Cumulative delay from the flow root exceeds 24h. ManyChat blocks the send itself for a contact outside the window and reports nothing. WARNS rather than blocks: a contact who re-engages before the delay fires reopens the window, so the branch is dead for most contacts, not all. Long follow-up belongs in a CRM \u2014 see delivery-rules.md.' },
  TAG_NAME_NOT_NAMESPACED: { layer: 'C', serverEnforced: null, clientMessage: 'Tag names use namespace:value, lowercase, hyphens inside multi-word values.', note: 'ManyChat does not normalise tag case on write, so mixed schemes silently produce duplicate tags. House convention \u2014 see system-conventions.md.' },
  FIELD_SHADOWS_SYSTEM_FIELD: { layer: 'C', serverEnforced: null, toolBlocks: true, clientMessage: 'A ManyChat system field already holds this. Capture it with save_to and read it with the system merge tag instead of creating a custom field.', note: 'A custom field beside the system one is two sources of truth, and the question node and native integrations only write to the system field.' },
  OBJECT_NOT_IN_FOLDER: { layer: 'C', serverEnforced: null, clientMessage: 'Created at the account root. Pass path so it lands in a folder.', note: 'Folders are the only organisational primitive ManyChat has, and moving objects later is manual work in the UI.' },
  OBJECT_NAME_EMOJI: { layer: 'C', serverEnforced: null, clientMessage: 'No emoji in object names. Emoji in message copy is fine.', note: 'Emoji in a name breaks sorting and search. House convention.' },  // Triggers
  WIDGET_AREA_INVALID: { layer: 'C', serverEnforced: false, clientMessage: 'post_covered_area must be all_posts, specific_post or next_post', note: 'server accepted "bogus" (live-06) but the UI then refuses to activate; the tool blocks it', toolBlocks: true },
  WIDGET_AREA_MISSING: { layer: 'C', serverEnforced: false, clientMessage: 'Choose Specific Post or Reel to continue.', note: 'without post_covered_area the UI shows "specific Post" and refuses activation', toolBlocks: true },
  WIDGET_POST_REQUIRED: { layer: 'S+C', serverEnforced: true, serverMessage: 'Please select a post to track comments', clientMessage: 'Post is required' },
  WIDGET_KEYWORDS_REQUIRED: { layer: 'C', serverEnforced: false, clientMessage: 'Create Keyword to continue.', note: 'server accepted empty keywords (live-06)' },
  WIDGET_REPLIES_MIN_3: { layer: 'C', serverEnforced: false, clientMessage: 'Create at least 3 replies for sending randomly.', note: 'server accepted 1 (live-06)' },
  WIDGET_REPLIES_UNIQUE: { layer: 'C', serverEnforced: false, clientMessage: 'Create 3 unique replies so they feel natural' },
  WIDGET_COMMENT_CONTAINS_INVALID: { layer: 'C', serverEnforced: false, clientMessage: 'comment_contains must be specific_words or any_words', toolBlocks: true },
  KEYWORD_SYSTEM: { layer: 'S', serverEnforced: true, serverMessage: 'Trying to rewrite system keyword rule' },
  KEYWORD_CONDITION_UNKNOWN: { layer: 'S', serverEnforced: true, serverMessage: '(HTTP 500 HTML — ManyChat crashes on an unknown condition)', note: 'live-04: condition:"regex" → 500' },
  KEYWORD_REQUIRED: { layer: 'C', serverEnforced: false, clientMessage: 'Please provide a keyword.', note: 'server accepted an empty list (live-04)' },
  KEYWORDS_MAX_12: { layer: 'C', serverEnforced: false, clientMessage: 'No more than 12 keywords per rule', note: 'server accepted 13 (live-04)', toolBlocks: true },
  KEYWORD_RULES_MAX_5: { layer: 'C', serverEnforced: false, clientMessage: 'No more than 5 rules per keyword trigger' },
  KEYWORD_CHANNEL_UNKNOWN: { layer: 'C', serverEnforced: false, clientMessage: 'channel must be instagram, facebook, whatsapp, telegram, tiktok or sms', toolBlocks: true },
  // Actions — required fields, client strings from common/actions/constants/Validation.js. The
  // server side of these was not probed (an action missing its key was never published); the tool
  // blocks them anyway because an action without its subject cannot do anything.
  ACTION_TAG_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select or create a tag', toolBlocks: true },
  ACTION_SEQUENCE_WRONG: { layer: 'S', serverEnforced: true, serverMessage: 'Wrong sequence', note: 'PROVEN 2026-09-03: flow/publish rejects an add_to_sequence whose sequence_id does not exist on the account (probed with id 1). The server validates the id, so the ledger does not have to — but list_sequences is how you find a real one.' },
  ACTION_SEQUENCE_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select a sequence', toolBlocks: true },
  ACTION_FIELD_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select a custom user field to set', toolBlocks: true },
  ACTION_FIELD_VALUE_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please enter a value for the custom user field', toolBlocks: true, note: 'the UI string is a translation key; the server accepts an empty value (it stores it)' },
  ACTION_UNSET_FIELD_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select a custom user field to unset', toolBlocks: true },
  ACTION_START_FLOW_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select Automation', toolBlocks: true },
  ACTION_ASSIGN_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please choose a team member', toolBlocks: true },
  ACTION_MAIN_MENU_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select a Main Menu', toolBlocks: true },
  ACTION_PAUSE_DURATION_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please enter a pause duration', toolBlocks: true },
  ACTION_EVENT_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please enter a Conversion Event name', toolBlocks: true },
  ACTION_INTEGRATION_ACTION_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please select an integration action', toolBlocks: true, note: 'every integration action (hubspot, convertkit, chatgpt, claude, deepseek, google_sheets, active_campaign, klaviyo, mailchimp) carries `action` + `data`' },
  ACTION_CUSTOM_AUDIENCE_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please set up the custom audience action (ad account, audience, action)', toolBlocks: true },
  ACTION_NOTIFY_TEXT_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Notify admin needs a message text', toolBlocks: true },
  // Blocks
  IG_BLOCK_NOT_ALLOWED: { layer: 'C', serverEnforced: null, clientMessage: 'This block is not available on the Instagram channel', toolBlocks: true, note: 'InstagramNodeConfig allows text, attachment, quick_reply, question, delay, card, cards, dynamic, otn_request' },
  ATTACHMENT_TYPE_INVALID: { layer: 'C', serverEnforced: null, clientMessage: 'attachment content.type must be image, video, file, gif or external_image', toolBlocks: true },
  ATTACHMENT_NEEDS_CAID: { layer: 'S', serverEnforced: true, serverMessage: 'Attachment without caid', note: 'PROVEN 2026-09-03: an image ManyChat did not store is refused — the external_image shape its own exporter emits, a {type,url} object and a bare URL all fail. Upload it first (upload_attachment -> POST /content/upload) and pass the returned object, which carries caid.' },
  DYNAMIC_PAYLOAD_NOT_STRING: { layer: 'S', serverEnforced: true, serverMessage: 'Something went wrong', note: 'PROVEN 2026-09-03: a dynamic block whose payload is an OBJECT fails; a JSON STRING or null is accepted. Same rule as external_request.' },
  IG_PDF_NEEDS_PREVIEW: { layer: 'C', serverEnforced: false, clientMessage: 'This PDF was uploaded without a preview', toolBlocks: true, note: 'PROVEN 2026-09-03 by differential (same bytes, same field name, only `dest` varies): POST /content/upload returns a `preview` object ONLY when the multipart carries dest=pdf. Without it the builder logs PdfPreviewNotReceivedError for a PDF attachment on an Instagram node (Batch/Parser.js) and the block has no thumbnail. Upload with upload_attachment type:"pdf" node:"instagram", which sends dest=pdf.' },
  ATTACHMENT_URL_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please specify image URL', toolBlocks: true, note: 'external_image needs content.data.url; uploaded types need the object /content/upload returned' },
  CARDS_EMPTY: { layer: 'C', serverEnforced: null, clientMessage: 'Please create at least one card', toolBlocks: true },
  CARD_TITLE_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please enter a title', toolBlocks: true },
  CARD_TITLE_OVER_80: { layer: 'C', serverEnforced: null, clientMessage: 'Title must be less than 80 characters long' },
  CARD_SUBTITLE_OVER_80: { layer: 'C', serverEnforced: null, clientMessage: 'Subtitle must be less than 80 characters long' },
  CARDS_MAX_10: { layer: 'C', serverEnforced: null, clientMessage: 'You can add only 10 cards', toolBlocks: true },
  DYNAMIC_URL_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please enter a request URL', toolBlocks: true },
  DYNAMIC_METHOD_INVALID: { layer: 'C', serverEnforced: null, clientMessage: 'method must be get, post, put or delete', toolBlocks: true, note: 'RequestMethodSchema in shared/api/requests/content/schemas.ts' },
  AI_NODE_PROMPT_REQUIRED: { layer: 'C', serverEnforced: null, clientMessage: 'Please enter a prompt for the AI step', toolBlocks: true },
});

const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));

class Findings {
  constructor({ allowUiWarnings = false } = {}) { this.list = []; this.allowUiWarnings = allowUiWarnings; }
  add(ruleId, where = {}, vars = {}) {
    const r = RULES[ruleId];
    if (!r) throw new Error(`unknown rule ${ruleId}`);
    const serverMessage = r.serverMessage ? fill(r.serverMessage, vars) : null;
    const clientMessage = r.clientMessage ? fill(r.clientMessage, vars) : null;
    // POLICY (0.2.0): every rule whose string is KNOWN blocks — server-enforced (the publish would
    // fail anyway) AND client-only (the API accepts it, but the builder shows a broken node and the
    // channel may refuse it at send time: Instagram's DM cap is 1000 characters). Only rules the
    // corpus never probed on either side (serverEnforced === null) stay warnings, and say so.
    // `allowUiWarnings` demotes the client-only rows back to warnings for a caller who has decided
    // a UI-broken node is acceptable — an explicit choice, never the default.
    // Three independent reasons to block, in priority order:
    //   serverEnforced === true  the publish would fail with this exact string
    //   toolBlocks === true      the tool refuses by policy whatever the server does (an action with
    //                            no subject, a trigger the UI could never activate) — this holds for
    //                            unprobed rules too, which is why it is NOT nested under clientOnly
    //   clientOnly               the API accepts it but the builder marks the node broken; blocks
    //                            unless the caller opted into allowUiWarnings
    const clientOnly = r.serverEnforced === false;
    const blocking = r.serverEnforced === true || r.toolBlocks === true || (clientOnly && !this.allowUiWarnings);
    this.list.push({
      rule: ruleId,
      layer: r.layer,
      serverEnforced: r.serverEnforced,
      blocking,
      message: serverMessage ?? clientMessage ?? ruleId,
      serverMessage,
      clientMessage,
      ...(r.note ? { note: r.note } : {}),
      ...where,
      ...(vars.detail ? { detail: vars.detail } : {}),
    });
    return this;
  }
  result() {
    const blocking = this.list.filter((f) => f.blocking);
    const warnings = this.list.filter((f) => !f.blocking);
    return { ok: blocking.length === 0, blocking, warnings, count: this.list.length,
      meaning: blocking.length
        ? 'blocking = a rule with a KNOWN string failed: serverEnforced:true means the server would refuse the publish with exactly that message; serverEnforced:false means ManyChat\'s API accepts it but its builder marks the node broken (and the channel may refuse it at send time), so the tool refuses it too unless allowUiWarnings:true. Fix these before sending.'
        : warnings.length
          ? 'warnings = rules the corpus has not probed on the server (serverEnforced:null), or client-only rules you demoted with allowUiWarnings. The publish will go through; read them.'
          : 'clean against every rule in the ledger — a 200 from publish still only proves what the server enforces (see serverEnforced per rule).' };
  }
}

const isUrl = (s) => { try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };
const targetOid = (t) => (t && typeof t === 'object' ? t._content_oid ?? null : null);
const hasContentId = (t) => t && typeof t === 'object' && t.content_id != null;

// context: { commentTriggerAttached?: bool, userTagIds?: Set<number>, triggerTagIds?: Set<number>,
//            fieldIds?: Set<number>, botFieldIds?: Set<number>, knownFlowNs?: Set<string>|null, channel?: 'instagram' }
export function validateBatch({ contents, rootContent, context = {}, allowUiWarnings = false }) {
  const F = new Findings({ allowUiWarnings });
  const list = Array.isArray(contents) ? contents : [];
  const oids = new Map();
  for (const c of list) {
    if (!c?._oid) continue;
    oids.set(c._oid, (oids.get(c._oid) ?? 0) + 1);
  }
  for (const [oid, n] of oids) if (n > 1) F.add('DUPLICATE_OID', { oid, caption: list.find((c) => c._oid === oid)?.caption }, { detail: `_oid appears ${n} times` });
  const inBatch = (oid) => oids.has(oid);
  const rootOk = rootContent != null && (typeof rootContent === 'number' || inBatch(rootContent) || list.some((c) => c.content_id != null && String(c.content_id) === String(rootContent)));
  if (!rootOk) F.add('BATCH_ROOT_MISSING', { key: 'root_content' }, { detail: `root_content=${JSON.stringify(rootContent ?? null)}` });

  const checkTarget = (t, where) => {
    const oid = targetOid(t);
    if (oid && !inBatch(oid) && !hasContentId(t)) F.add('TARGET_NOT_IN_BATCH', where, { detail: `target _content_oid ${oid} is not in this batch` });
  };
  const checkButton = (b, where, textStyle = false) => {
    if (!b || typeof b !== 'object') return;
    const cap = String(b.caption ?? '').trim();
    if (!cap) F.add('BUTTON_CAPTION_REQUIRED', where);
    else if (cap.length > (textStyle ? 40 : 20)) F.add('BUTTON_CAPTION_OVER_20', where, { detail: `caption is ${cap.length} chars` });
    if (b.type && !BUTTON_TYPES.includes(b.type)) F.add('BUTTON_TYPE_UNKNOWN', where, { detail: `type "${b.type}"` });
    if (b.type === 'url' && !isUrl(b.url)) F.add('BUTTON_URL_INVALID', where, { detail: `url ${JSON.stringify(b.url ?? null)}` });
    if (b.type === 'content') {
      if (!b._content_oid && b.content_id == null) F.add('BUTTON_TARGET_REQUIRED', where);
      else checkTarget(b, where);
    }
  };

  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const where = { caption: c.caption ?? null, oid: c._oid ?? null, type: c.type ?? null };
    if (c.removed === true) continue;
    if (!CONTENT_TYPES.includes(c.type)) { F.add('CONTENT_TYPE_UNKNOWN', where, { detail: `type "${c.type}"` }); continue; }

    if (CHANNEL_NODE_TYPES.includes(c.type)) {
      const msgs = Array.isArray(c.messages) ? c.messages : [];
      if (!msgs.length) F.add('NODE_NO_MESSAGE', where);
      if (msgs.length > 101) F.add('BLOCKS_MAX_101', where, { detail: `${msgs.length} blocks` });
      let delayRun = 0;
      msgs.forEach((m, i) => {
        const mw = { ...where, block: i, blockType: m?.type ?? null };
        if (!m || !MESSAGE_TYPES.includes(m.type)) { F.add('MESSAGE_TYPE_UNKNOWN', mw, { detail: `block type "${m?.type}"` }); return; }
        if (c.type === 'instagram' && !IG_ALLOWED_BLOCKS.includes(m.type)) F.add('IG_BLOCK_NOT_ALLOWED', mw, { detail: `block type "${m.type}"` });
        if (m.type === 'attachment') {
          const t = m.content?.type;
          if (!ATTACHMENT_TYPES.includes(t)) F.add('ATTACHMENT_TYPE_INVALID', mw, { detail: `content.type "${t}"` });
          else if (!m.content?.data) F.add('ATTACHMENT_URL_REQUIRED', mw);
          else if (m.content.data.caid == null) F.add('ATTACHMENT_NEEDS_CAID', mw, { detail: t === 'external_image' ? 'external_image carries a url but no caid' : 'the attachment data has no caid' });
          // A PDF reaches the wire as type "file" + mime application/pdf. On an Instagram node the
          // builder expects data.preview, which only a dest=pdf upload produces.
          if ((c.type === 'instagram' || context.channel === 'instagram') && m.content?.data?.mime === 'application/pdf' && !m.content.data.preview) {
            F.add('IG_PDF_NEEDS_PREVIEW', mw, { detail: `"${m.content.data.title ?? 'the PDF'}" was uploaded without dest=pdf, so it has no preview` });
          }
          (m.keyboard ?? []).forEach((b, j) => checkButton(b, { ...mw, button: j }));
        }
        if (m.type === 'cards') {
          const els = Array.isArray(m.elements) ? m.elements : [];
          if (!els.length) F.add('CARDS_EMPTY', mw);
          if (els.length > 10) F.add('CARDS_MAX_10', mw, { detail: `${els.length} cards` });
          els.forEach((card, k) => {
            const cw = { ...mw, card: k };
            const title = String(card?.content?.title ?? '');
            if (!title.trim()) F.add('CARD_TITLE_REQUIRED', cw);
            else if (title.length > 80) F.add('CARD_TITLE_OVER_80', cw, { detail: `${title.length} chars` });
            if (String(card?.content?.subtitle ?? '').length > 80) F.add('CARD_SUBTITLE_OVER_80', cw);
            if (card?.content?.image && card.content.image.caid == null) F.add('ATTACHMENT_NEEDS_CAID', cw, { detail: 'a card image must be the object upload_attachment returned (it carries caid)' });
            const kb = Array.isArray(card?.keyboard) ? card.keyboard : [];
            if (kb.length > 3) F.add('BUTTONS_MAX_3', cw, { detail: `${kb.length} buttons` });
            kb.forEach((b, j) => checkButton(b, { ...cw, button: j }));
          });
        }
        if (m.type === 'dynamic') {
          if (!String(m.url ?? '').trim()) F.add('DYNAMIC_URL_REQUIRED', mw);
          if (!DYNAMIC_METHODS.includes(String(m.method ?? '').toLowerCase())) F.add('DYNAMIC_METHOD_INVALID', mw, { detail: `method "${m.method}"` });
          if (m.payload != null && typeof m.payload !== 'string') F.add('DYNAMIC_PAYLOAD_NOT_STRING', mw, { detail: `payload is a ${Array.isArray(m.payload) ? 'array' : typeof m.payload}` });
          if (m.fallback) checkTarget(m.fallback, { ...mw, key: 'fallback' });
        }
        if (m.type === 'delay') { delayRun++; if (delayRun > 5) F.add('DELAYS_IN_A_ROW', mw); if (i === msgs.length - 1) F.add('DELAY_LAST', mw); }
        else delayRun = 0;
        if (m.type === 'text') {
          const text = String(m.content?.text ?? '');
          if (!text.trim()) F.add('TEXT_REQUIRED', mw);
          else if (text.length > 2000) F.add('TEXT_OVER_2000', mw, { detail: `${text.length} chars` });
          else if (text.length > 1000 && (c.type === 'instagram' || context.channel === 'instagram')) F.add('TEXT_OVER_1000', mw, { detail: `${text.length} chars` });
          const kb = Array.isArray(m.keyboard) ? m.keyboard : [];
          if (kb.length > 3) F.add('BUTTONS_MAX_3', mw, { detail: `${kb.length} buttons` });
          kb.forEach((b, j) => checkButton(b, { ...mw, button: j }));
        }
        if (m.type === 'question') {
          if (!String(m.content?.text ?? '').trim()) F.add('QUESTION_TEXT_REQUIRED', mw);
          if (m.answer_type && !ANSWER_TYPES.includes(m.answer_type)) F.add('ANSWER_TYPE_UNSUPPORTED', mw, { type: m.answer_type });
          if (m.success_target) checkTarget(m.success_target, { ...mw, key: 'success_target' });
          if (m.timeout_target) checkTarget(m.timeout_target, { ...mw, key: 'timeout_target' });
          (m.answer_replies ?? []).forEach((b, j) => checkButton(b, { ...mw, button: j }));
        }
      });
      const qrs = Array.isArray(c.quick_replies?.buttons) ? c.quick_replies.buttons : [];
      if (qrs.length) {
        if (qrs.length > 13) F.add('QR_MAX_13', where, { detail: `${qrs.length} quick replies` });
        else if (qrs.length > 11) F.add('QR_OVER_11', where, { detail: `${qrs.length} quick replies` });
        const last = msgs[msgs.length - 1];
        if (last?.type === 'question') F.add('QR_AFTER_QUESTION', where);
        else if (last?.type === 'text' && (last.keyboard?.length ?? 0) > 0 && c.type === 'instagram') F.add('QR_AFTER_TEXT_WITH_BUTTONS', where);
        qrs.forEach((b, j) => checkButton(b, { ...where, quickReply: j }));
      }
      if (c.target) checkTarget(c.target, { ...where, key: 'target' });
      // Comment-reply (private reply) rules — only bite when a comment/story trigger is attached.
      const isRoot = c._oid != null && String(c._oid) === String(rootContent) || (c.content_id != null && String(c.content_id) === String(rootContent));
      if (context.commentTriggerAttached && isRoot && c.private_reply !== 'private_reply') {
        F.add('PRIVATE_REPLY_ROOT_REQUIRED', { ...where, key: `${c._oid ?? c.content_id}.private_reply` });
      }
      if (c.private_reply === 'private_reply' && context.commentTriggerAttached !== false) {
        if (c.target) F.add('PRIVATE_REPLY_NO_TARGET', { ...where, key: 'target' });
        const oneBlock = msgs.length === 1 && (
          ((msgs[0]?.keyboard?.length ?? 0) > 0) || qrs.length > 0);
        if (!oneBlock) F.add('PRIVATE_REPLY_ONE_BLOCK', where, { detail: `${msgs.length} block(s); needs exactly one text block with buttons or quick replies` });
      }
    }

    if (c.type === 'action_group') {
      if (c.target) checkTarget(c.target, { ...where, key: 'target' });
      (Array.isArray(c.actions) ? c.actions : []).forEach((a, i) => {
        const aw = { ...where, action: i, actionType: a?.type ?? null };
        if (a == null) { F.add('ACTION_NULL', aw); return; }
        if (!ACTION_TYPES.includes(a.type)) { F.add('ACTION_TYPE_UNSUPPORTED', aw, { detail: `type "${a.type}"` }); return; }
        // Required subject per action type (common/actions/models/Action/validation.js).
        if ((a.type === 'add_tag' || a.type === 'remove_tag') && !a.tag_id) F.add('ACTION_TAG_REQUIRED', aw);
        if ((a.type === 'add_to_sequence' || a.type === 'remove_from_sequence') && !a.sequence_id) F.add('ACTION_SEQUENCE_REQUIRED', aw);
        if ((a.type === 'set_custom_field_value' || a.type === 'change_global_field_value') && !a.field_id) F.add('ACTION_FIELD_REQUIRED', aw);
        if ((a.type === 'set_custom_field_value' || a.type === 'change_global_field_value') && a.field_id && (a.value === undefined || a.value === null || a.value === '')) F.add('ACTION_FIELD_VALUE_REQUIRED', aw);
        if (a.type === 'unset_custom_field_value' && !a.field_id) F.add('ACTION_UNSET_FIELD_REQUIRED', aw);
        if (a.type === 'start_flow' && !a.flow_ns) F.add('ACTION_START_FLOW_REQUIRED', aw);
        if (a.type === 'assign_conversation' && !a.user_id && !a.group_id) F.add('ACTION_ASSIGN_REQUIRED', aw);
        if (a.type === 'set_user_level_menu' && !a.main_menu_flow_ns) F.add('ACTION_MAIN_MENU_REQUIRED', aw);
        if (a.type === 'pause_automations' && !a.pause_duration) F.add('ACTION_PAUSE_DURATION_REQUIRED', aw);
        if (a.type === 'fire_custom_event' && !a.event_id) F.add('ACTION_EVENT_REQUIRED', aw);
        if (INTEGRATION_ACTIONS.includes(a.type) && !a.action) F.add('ACTION_INTEGRATION_ACTION_REQUIRED', aw, { detail: `${a.type} without \`action\`` });
        if ((a.type === 'custom_audience_user' || a.type === 'custom_audience_ig_user') && !(a.ad_account_id && a.custom_audience_id && a.action)) F.add('ACTION_CUSTOM_AUDIENCE_REQUIRED', aw);
        if (a.type === 'notify_admin' && !String(a.text ?? '').trim()) F.add('ACTION_NOTIFY_TEXT_REQUIRED', aw);
        if (a.type === 'add_tag' || a.type === 'remove_tag') {
          const id = Number(a.tag_id);
          if (context.triggerTagIds?.has(id)) F.add('TAG_WRONG', aw, { detail: `tag ${id} is a trigger auto-tag` });
          else if (context.userTagIds && !context.userTagIds.has(id)) F.add('TAG_WRONG', aw, { detail: `tag_id ${a.tag_id} is not a user tag on this account` });
        }
        if (a.type === 'set_custom_field_value' || a.type === 'unset_custom_field_value') {
          if (context.fieldIds && !context.fieldIds.has(Number(a.field_id))) F.add('FIELD_WRONG', aw, { detail: `field_id ${a.field_id} not on this account` });
        }
        if (a.type === 'change_global_field_value') {
          if (context.botFieldIds && !context.botFieldIds.has(Number(a.field_id))) F.add('BOT_FIELD_UNKNOWN', aw, { detail: `bot field_id ${a.field_id} not on this account` });
        }
        if (a.type === 'external_request') {
          const url = String(a.url ?? '');
          if (!url.trim()) F.add('EXTERNAL_URL_REQUIRED', aw);
          else if (!/^https:\/\//i.test(url) && !/^\{\{/.test(url)) F.add('EXTERNAL_URL_NOT_HTTPS', aw, { detail: url.slice(0, 60) });
          if (typeof a.payload === 'string' && a.payload.trim() && !/\{\{/.test(a.payload)) { try { JSON.parse(a.payload); } catch { F.add('EXTERNAL_PAYLOAD_JSON', aw); } }
          for (const m of a.mapping ?? []) if (!m?.path || m?.field_id == null) { F.add('EXTERNAL_MAPPING_INCOMPLETE', aw); break; }
        }
      });
    }

    if (c.type === 'multi_condition') {
      const conds = Array.isArray(c.conditions) ? c.conditions : [];
      const anyTarget = conds.some((x) => x?.target) || Boolean(c.default_target);
      if (!anyTarget) F.add('CONDITION_NO_TARGET', where);
      conds.forEach((cond, i) => {
        if (cond?.target) checkTarget(cond.target, { ...where, condition: i });
        for (const g of cond?.filter?.groups ?? []) for (const it of g?.items ?? []) {
          const iw = { ...where, condition: i, item: it?.field ?? null };
          if (!it) continue;
          if (it.operator && !OPERATORS.includes(it.operator)) F.add('CONDITION_OPERATOR_UNSUPPORTED', iw, { op: it.operator });
          if (it.type === 'suf') {
            if (!SYSTEM_FIELDS.includes(it.field) && !STATIC_FIELDS.includes(it.field)) F.add('CONDITION_FIELD_NOT_FOUND', iw, { field: it.field });
          } else if (it.type === 'cuf') {
            if (typeof it.field !== 'string') F.add('CONDITION_FIELD_MUST_BE_STRING', iw);
            else if (!/^cuf_\d+$/.test(it.field)) F.add('CONDITION_CUF_FORMAT', iw, { field: it.field });
            else if (context.fieldIds && !context.fieldIds.has(Number(it.field.slice(4)))) F.add('CONDITION_FIELD_NOT_FOUND', iw, { field: it.field });
          } else if (it.type === 'tag') {
            const id = Number(it.value);
            if (context.userTagIds && !context.userTagIds.has(id) && !context.triggerTagIds?.has(id)) F.add('TAG_WRONG', iw, { detail: `tag ${it.value} not on this account` });
          }
        }
      });
      if (c.default_target) checkTarget(c.default_target, { ...where, key: 'default_target' });
    }

    if (c.type === 'split') {
      const vs = Array.isArray(c.variants) ? c.variants : [];
      if (vs.length < 2) F.add('SPLIT_VARIANTS_MIN', where);
      if (vs.length > 6) F.add('SPLIT_VARIANTS_MAX', where);
      const sum = vs.reduce((s, v) => s + Number(v?.percent ?? 0), 0);
      if (sum !== 100) F.add('SPLIT_PERCENTS', where, { detail: `percents sum to ${sum}` });
      vs.forEach((v, i) => v?.target && checkTarget(v.target, { ...where, variant: i }));
    }

    if (c.type === 'smart_delay') {
      const unit = c.shift_time?.unit;
      if (c.shift_time && !DELAY_UNITS.includes(unit)) F.add('DELAY_UNIT_INVALID', where, { detail: `unit "${unit}"` });
      if (c.shift_time && !(Number(c.shift_time.value) > 0)) F.add('DELAY_VALUE_REQUIRED', where);
      if (c.target) checkTarget(c.target, { ...where, key: 'target' });
    }

    if (c.type === 'goto') {
      const ns = c.target?.flow_ns;
      if (!ns) F.add('GOTO_FLOW_REQUIRED', where);
      else if (context.knownFlowNs && !context.knownFlowNs.has(ns)) F.add('GOTO_FLOW_WRONG', where, { detail: `flow ${ns} is not on this account` });
    }

    if (c.type === 'ai_node') {
      if (!String(c.prompt ?? '').trim()) F.add('AI_NODE_PROMPT_REQUIRED', where);
      if (c.default_target) checkTarget(c.default_target, { ...where, key: 'default_target' });
    }

    if (c.type === 'note') {
      const n = c.note ?? {};
      if (n.font_size != null && !NOTE_FONT_SIZES.includes(n.font_size)) F.add('NOTE_FONT_SIZE', where, { detail: n.font_size });
      if (n.note_size != null && !NOTE_SIZES.includes(n.note_size)) F.add('NOTE_SIZE', where, { detail: n.note_size });
      if (n.color != null && !NOTE_COLORS.includes(n.color)) F.add('NOTE_COLOR', where, { detail: n.color });
      if (String(n.text ?? '').length > 640) F.add('NOTE_TEXT_OVER_640', where);
    }
  }

  // --- cumulative delay from the root ----------------------------------------
  // Every edge in this shape is an object carrying _content_oid, so a deep scan
  // finds them all without enumerating node types.
  const outgoing = (node) => {
    const out = [];
    const seen = new Set();
    const scan = (v) => {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { for (const x of v) scan(x); return; }
      if (v._content_oid != null) out.push(v._content_oid);
      for (const k of Object.keys(v)) scan(v[k]);
    };
    scan(node);
    return out;
  };
  const byOid = new Map(list.filter((c) => c?._oid).map((c) => [c._oid, c]));
  const HOURS = { minutes: 1 / 60, hours: 1, days: 24 };
  const delayHours = (c) => {
    if (c?.type !== 'smart_delay') return 0;
    const u = c.shift_time?.unit;
    const v = Number(c.shift_time?.value);
    return HOURS[u] != null && Number.isFinite(v) && v > 0 ? HOURS[u] * v : 0;
  };
  if (rootContent != null && byOid.has(rootContent)) {
    const reported = new Set();
    const best = new Map(); // oid -> smallest cumulative hours seen, so we walk each node once per improvement
    const stack = [[rootContent, 0]];
    while (stack.length) {
      const [oid, before] = stack.pop();
      const node = byOid.get(oid);
      if (!node) continue;
      const after = before + delayHours(node);
      const prev = best.get(oid);
      if (prev != null && prev <= before) continue;
      best.set(oid, before);
      if (node.type === 'smart_delay' && before <= 24 && after > 24 && !reported.has(oid)) {
        reported.add(oid);
        F.add('DELAY_EXCEEDS_MESSAGING_WINDOW', { oid, caption: node.caption }, { detail: `${Math.round(after * 10) / 10}h from the contact's last interaction` });
      }
      for (const next of outgoing(node)) if (next !== oid) stack.push([next, after]);
    }
  }

  return F.result();
}

// Comment-trigger widget `data` (feed_comment_trigger, Instagram).
export function validateWidgetData(data = {}, { allowUiWarnings = false } = {}) {
  const F = new Findings({ allowUiWarnings });
  const s = data.feed_comment_settings ?? {};
  const w = data.feed_comment_welcome ?? {};
  if (s.post_covered_area == null) F.add('WIDGET_AREA_MISSING', { key: 'feed_comment_settings.post_covered_area' });
  else if (!POST_COVERED_AREAS.includes(s.post_covered_area)) F.add('WIDGET_AREA_INVALID', { key: 'feed_comment_settings.post_covered_area' }, { detail: String(s.post_covered_area) });
  if (s.post_covered_area === 'specific_post' && !s.post_id) F.add('WIDGET_POST_REQUIRED', { key: 'feed_comment_settings.post_id' });
  if (s.comment_contains != null && !COMMENT_CONTAINS.includes(s.comment_contains)) F.add('WIDGET_COMMENT_CONTAINS_INVALID', { key: 'feed_comment_settings.comment_contains' }, { detail: String(s.comment_contains) });
  const kws = s.include_keywords_array ?? [];
  const rules = s.keyword_rules ?? null;
  if ((s.comment_contains ?? 'specific_words') === 'specific_words' && !kws.length && !(rules && rules.length)) F.add('WIDGET_KEYWORDS_REQUIRED', { key: 'feed_comment_settings.include_keywords_array' });
  const replies = (w.public_reply_messages ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (replies.length < 3) F.add('WIDGET_REPLIES_MIN_3', { key: 'feed_comment_welcome.public_reply_messages' }, { detail: `${replies.length} reply/replies` });
  if (new Set(replies.map((r) => r.toLowerCase())).size < replies.length) F.add('WIDGET_REPLIES_UNIQUE', { key: 'feed_comment_welcome.public_reply_messages' });
  return F.result();
}

// DM keyword trigger rules.
export function validateKeywordRules({ keyword_rules, channel, allowUiWarnings = false }) {
  const F = new Findings({ allowUiWarnings });
  const rules = Array.isArray(keyword_rules) ? keyword_rules : [];
  if (channel && !['instagram', 'facebook', 'whatsapp', 'telegram', 'tiktok', 'sms'].includes(channel)) F.add('KEYWORD_CHANNEL_UNKNOWN', { key: 'channel' }, { detail: String(channel) });
  if (rules.length > 5) F.add('KEYWORD_RULES_MAX_5', { key: 'keyword_rules' }, { detail: `${rules.length} rules` });
  rules.forEach((r, i) => {
    const where = { ruleIndex: i, condition: r?.condition ?? null };
    if (!KEYWORD_CONDITIONS.includes(r?.condition)) F.add('KEYWORD_CONDITION_UNKNOWN', where, { detail: `condition "${r?.condition}"` });
    const kws = (r?.keywords ?? []).map((k) => String(k ?? '').trim());
    if (!['any_message', 'thumbs_up'].includes(r?.condition) && !kws.filter(Boolean).length) F.add('KEYWORD_REQUIRED', where);
    if (kws.length > 12) F.add('KEYWORDS_MAX_12', where, { detail: `${kws.length} keywords` });
    for (const k of kws) if (SYSTEM_KEYWORDS.includes(k.toLowerCase())) F.add('KEYWORD_SYSTEM', where, { detail: `"${k}" is a system keyword` });
  });
  return F.result();
}

// The ledger as data, for describe-style output.
export const ruleTable = () => Object.entries(RULES).map(([id, r]) => ({ id, ...r }));

// ---------------------------------------------------------------------------
// House conventions, checked where an object is created.
//
// These are the operator's rules, not ManyChat's — the API accepts any caption.
// They live here so the check runs at the point of creation, in the tool result
// the caller actually reads, rather than in a document the caller may not open.
// ---------------------------------------------------------------------------

// A ManyChat system field already holds these. Matched on the WHOLE normalised
// caption, so "Work Email Verified At" is a legitimate custom field and
// "Email Address" is not.
const SYSTEM_FIELD_SYNONYMS = new Map(Object.entries({
  email: 'email', 'e mail': 'email', 'email address': 'email', 'e mail address': 'email', 'lead email': 'email',
  phone: 'phone', 'phone number': 'phone', telephone: 'phone', mobile: 'phone', 'mobile number': 'phone',
  'first name': 'first_name', firstname: 'first_name',
  'last name': 'last_name', lastname: 'last_name', surname: 'last_name',
  'full name': 'full_name', fullname: 'full_name', name: 'full_name',
  'instagram username': 'ig_username', 'ig username': 'ig_username',
}));

const TAG_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;
const normalizeCaption = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slugSegment = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Suggest a namespace:value form. "Lead: PDF Requested" -> "lead:pdf-requested";
// with no colon the first word becomes the namespace.
const suggestTagName = (caption) => {
  const raw = String(caption ?? '');
  const i = raw.indexOf(':');
  const [ns, rest] = i >= 0 ? [raw.slice(0, i), raw.slice(i + 1)] : [raw.trim().split(/\s+/)[0] ?? '', raw.trim().split(/\s+/).slice(1).join(' ')];
  const a = slugSegment(ns);
  const b = slugSegment(rest);
  return a && b ? `${a}:${b}` : null;
};

/**
 * Check one object's name (and folder) against the house conventions.
 * Returns the same shape as validateBatch: { ok, blocking, warnings, count, meaning }.
 *
 * @param {object} o
 * @param {'tag'|'field'|'bot_field'|'flow'} o.kind
 * @param {string} o.caption
 * @param {string} [o.path]  the folder path the object is being created in ('/' is the root)
 */
export function validateObjectName({ kind, caption, path } = {}) {
  const F = new Findings({});
  const where = { kind, caption };

  if (HAS_EMOJI.test(String(caption ?? ''))) F.add('OBJECT_NAME_EMOJI', where);

  if (kind === 'tag' && !TAG_NAME_RE.test(String(caption ?? ''))) {
    const suggestion = suggestTagName(caption);
    F.add('TAG_NAME_NOT_NAMESPACED', where, { detail: suggestion ? `try ${suggestion}` : 'use namespace:value, lowercase' });
  }

  if (kind === 'field') {
    const hit = SYSTEM_FIELD_SYNONYMS.get(normalizeCaption(caption));
    if (hit) F.add('FIELD_SHADOWS_SYSTEM_FIELD', where, { detail: `${hit} is a system field — capture with save_to:"${hit}" and read it as {{${hit}}}` });
  }

  if (path != null && String(path).trim() === '/') F.add('OBJECT_NOT_IN_FOLDER', where);

  return F.result();
}

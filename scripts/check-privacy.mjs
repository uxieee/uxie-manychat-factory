#!/usr/bin/env node
// Privacy gate for a repo that is built by working on LIVE ManyChat accounts.
//
// The whole server was developed against a real client account, so client identifiers get copied
// verbatim into examples, fixtures, catalogue notes and docs. The sibling GoHighLevel repo has
// leaked client data five times; this is the same backstop, with the identifier SHAPES ManyChat
// uses instead of GHL's.
//
//   node scripts/check-privacy.mjs            # scan tracked files, exit 1 on a hit
//   node scripts/check-privacy.mjs --staged   # scan only staged files (pre-commit)
//   node scripts/check-privacy.mjs --hash "Some Client"   # print a hash to add below
//
// Adding a legitimate exception: put it in ALLOW with a reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Known client / person names and social handles, stored as SHA-256 HASHES — never plaintext.
// A denylist of client names committed to a public repo is itself the disclosure it exists to
// prevent, so the repo carries only hashes: the check still works and reveals nothing.
//
// To add one:  node scripts/check-privacy.mjs --hash "Some Client"
const NAME_HASHES = new Set([
  '6322994f1a45a4bb6be70aac157d3f90d6eb9ac5cdbc6085ec75585b62ada2e4',
  '034a85ade0d41d12a48323120ac45c02a7003723ec394102959d442cc1dea6c1',
  '739103c7a0e4608b9370e4493c41c3f77553fe05ec60acc6827d1992b3c479b3',
  '2f8ef233688fbb8c88a7bba957f9fd5db219a90f443dd59bb17183db59541fd6',
  '5172d78d1b03b901f59ca509435bb501f969da5a9eacb21336fcb7c69d36e743',
  '87d968253934dd7e138c324e4b42c5e9f576f6c6b2231a70dd415a083f3e897f',
  'b8e7c8ef6a2fb24c3b9d3208f013ab7b6bbeb4be7319f1341f225b87f39d9ad1',
  '89847fd8a6136490c589bc54b0ca562bebef22ceb1c2b2e43fa6feaa9d7468ca',
  '35b24f76ed4716be19309a13d1af68a2e6cfc36755472a303a8ddccc6416c5b5',
  '9b80960fc20873aabedc60da10c234c9bd78d59d03274553ab1a31b661d2528b',
  'bbc31cb5c93507e4bfbe1b98a531678b1bba76de50e6b8b4d0f7bde197f4ab66',
  'f4e84b010041170abbad72ca0d88448a5163e7184ce647d737187f3d1f9f5502',
  '9405c87cab48a3e132788af460dbfe80fe1a23ac9862b45188fa7475acb4a4eb',
  'cf5ff1a6a6c9ff2cf816962347936a5a8d2fe4988a5fa423afac2bea0e6d9ee0',
  '5dfd46e27a5e3e8e06fcb92817b0955f7fd28048f5003bfd4e5be8e67bf417db',
  'fcb1d1c298887a6ffcd3f5f6eb28504c1ffa84f79984040683b0c74452b2245f',
  '6e8bfe2ae1abb91f367c8c9ecbef24cddbedbc0686ae0f1ea9584116ad4ffd98',
  '73f91b8e33fa0f6931d3872a012785b54373c1c3712dad952a11d631d873c569',
  // 2026-08-31 roster sweep: a task review noticed an (untracked) design doc naming a client the
  // gate did not know. Hashing the active roster against this list found TEN names missing, not
  // one — the 18 above date from the earlier scrubs and never tracked the roster as it grew.
  '91fd465dae01a9a169703b165d1d64acc4890754e792b52c7d4105ee1b40df4c',
  '4004a99ad5bcc81a99b32429d1830496a891abfc2c2fcfcdef1b57e8c61ba396',
  'd7aa31064c1df93fd9d981b97fe2927474956d497d3d3a988885a6a55fc20688',
  '4a813e2dd7276ce07313c62fbd0fcd3c92adc274dac762a03d9bb2927f56b829',
  '792d3c8b8c2e74ee9429f726d9e7c7aba29c0549b3e17ed7f0c4896743a301f7',
  '0c60ce0631ed9a6e8f92cd96292c6e7f04cfc62826d6085e63cd60ec13bcc1bc',
  'b637471b996f6ed120c5084b69bd8754e082333b511305c655ca47134450f821',
  'a7a81f0dbbe295f1069931133d696a0473175e7695b85cfc03985e9d2314e2ef',
  '345aa0743f7662db7d2fc2861d1650f58df0f7091f0548127079d9b33a4a7fd6',
  'adf6a4a4af14f65e86cef064eb19b54015bc9467bafefc1579c7e1cd96b8f4a3',
  // Added 2026-09-03 for the ManyChat work: the account this server was live-proven against
  // (business name and Instagram handle). The client's personal name is already covered by the
  // roster hashes above, which are shared with the sibling GoHighLevel repo.
  '3366160bd215e025293c626048cfd45c27a41cd34c1ae9c31c555dc68e0e7c3a',
  'b84fb2492edd0c76a13fce18cf2868abf16fe3eb68b84a81eed8f70b9e259a3f',
]);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sha = (s) => createHash('sha256').update(norm(s)).digest('hex');

if (process.argv.includes('--hash')) {
  const value = process.argv[process.argv.indexOf('--hash') + 1];
  if (!value) { console.error('usage: --hash "Client Name"'); process.exit(2); }
  console.log(`${sha(value)}  // ${norm(value).replace(/\S/g, '*')}`);
  process.exit(0);
}

const staged = process.argv.includes('--staged');
const listCmd = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'] : ['ls-files', '-z'];
// The committed bundle is GENERATED third-party code (minified deps carry arbitrary long numeric
// constants that read as opaque ids). Its INPUTS are tracked and scanned as source, so nothing that
// could actually leak is skipped.
const SKIP_PATHS = [/(^|\/)mcp-server\/dist\//, /(^|\/)node_modules\//];
const files = execFileSync('git', listCmd, { encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter((f) => !SKIP_PATHS.some((re) => re.test(f)));

// Substrings that are FINE — placeholders, reserved domains, our own identifiers.
const ALLOW = [
  'example.com', 'example.org', 'example.net',        // RFC 2606 reserved
  'REPLACE-ME.example',
  '@{', '{{',                                          // ManyChat merge tags
  'me@mail.com',                                       // ManyChat's own UI sample (email retry copy)
  'gromdigital.com', 'xanderroque.com',                // ours, deliberate
  '+15551234567', '+61400000000', '+1234567890',       // placeholder numbers
  // Documented placeholder ids used throughout the docs and the flow-spec reference. They are
  // shape-valid on purpose so the examples read realistically; none addresses a real object.
  'content20260101010101_123456',
  'content20000101000000_000001', 'content20000101000000_000009',
  'widget20000101000000_000001', 'keyword20000101000000_000001',
  '<pageId>:<token>', 'fb<pageId>',
  // ManyChat's OWN published swagger samples in catalog/public-api-swagger.json — their
  // documentation's example contact, not anybody's data. Scrubbing them would corrupt the spec.
  'test@manychat.com', '+15400000000', '1543835812530302162',
  // Deliberately fake Stripe key in test/errors.test.mjs, proving the scrub catches that shape.
  // The rule caught it on its first run, which is the behaviour it exists to have.
  'pk_live_ABCDEFGHIJKLMNOP',
];

const RULES = [
  { name: 'email address',      re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'E.164 phone number', re: /\+\d{7,15}\b/g },
  // A ManyChat flow / widget / keyword namespace is `content20260101010101_123456` — a timestamp
  // plus six digits. Shape-specific, so unlike a bare id rule it has almost no false positives:
  // anything matching that is a real object on a real account unless it is an ALLOWed placeholder.
  { name: 'ManyChat object namespace', re: /\b(?:content|widget|keyword|flow)\d{14}_\d{6}\b/g },
  // The account prefix in every app URL: fb + the page id. Test fixtures use fb1/fb42 (<6 digits).
  { name: 'ManyChat account id', re: /\bfb\d{6,}\b/g },
  // A ManyChat public API key: <pageId>:<40+ chars>.
  { name: 'ManyChat API key', re: /\b\d{5,}:[A-Za-z0-9]{40,}\b/g },
  { name: 'long opaque account id', re: /\b\d{18,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Stripe publishable keys ride in ManyChat's own bootstrap payload.
  { name: 'Stripe key', re: /\bpk_(?:live|test)_[A-Za-z0-9]{10,}\b/g },
];


// 1..3-word n-grams, plus the de-spaced join so a run-together handle is caught alongside the
// spaced form.
function nameHits(line) {
  const words = norm(line).split(' ').filter(Boolean);
  const found = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(' ');
      for (const cand of new Set([gram, gram.replace(/ /g, '')])) if (NAME_HASHES.has(sha(cand))) found.push(gram);
    }
  }
  return found;
}

const allowed = (s) => ALLOW.some((a) => s.includes(a));
const hits = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  text.split('\n').forEach((line, i) => {
    for (const { name, re } of RULES) for (const m of line.match(re) ?? []) if (!allowed(m)) hits.push({ file, line: i + 1, kind: name, value: m });
    for (const n of new Set(nameHits(line))) hits.push({ file, line: i + 1, kind: 'client name', value: n });
  });
}

if (!hits.length) { console.log(`privacy check: clean (${files.length} files scanned)`); process.exit(0); }
console.error(`\nprivacy check FAILED — ${hits.length} potential leak(s):\n`);
for (const h of hits.slice(0, 40)) console.error(`  ${h.file}:${h.line}  [${h.kind}]  ${h.value}`);
if (hits.length > 40) console.error(`  … and ${hits.length - 40} more`);
console.error(`\nThis repo is PUBLIC and is built from live ManyChat account work.`);
console.error(`Replace with a placeholder, or add a documented exception to ALLOW in scripts/check-privacy.mjs.\n`);
process.exit(1);

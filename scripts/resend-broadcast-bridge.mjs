// AXOM Resend Broadcast bridge. Draft creation/update only: there is intentionally no send or schedule action.
// Run against approved, category-specific opt-in Segments; do not use for private report/Pulse data.
// Local ledger is ignored by Git, preventing ambiguous retries and duplicate provider Broadcasts.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BROADCAST_SENDERS = Object.freeze({
  essays_from_jafar: 'AXOM_EMAIL_FROM_EDITORIAL',
  product_updates: 'AXOM_EMAIL_FROM_REPORTS',
  research_news: 'AXOM_EMAIL_FROM_REPORTS',
  marketing: 'AXOM_EMAIL_FROM_REPORTS',
});
export const RESEND_UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}';
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function parseMap(value, label) {
  let data;
  try { data = JSON.parse(value || ''); } catch { throw new Error(label + ' must be a JSON object.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(label + ' must be a JSON object.');
  return data;
}

function senderDomain(sender) {
  if (typeof sender !== 'string' || /[\r\n]/.test(sender)) throw new Error('A valid configured sender is required.');
  const match = sender.match(/<([^<>]+)>$/);
  const address = match ? match[1] : sender;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new Error('A valid configured sender is required.');
  return address.split('@')[1].toLowerCase();
}

export function planResendDraft(exported, { campaignId, env }) {
  if (!uuid(campaignId)) throw new Error('A canonical AXOM campaign UUID is required.');
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) throw new Error('Export a canonical AXOM email first.');
  if (!Object.hasOwn(BROADCAST_SENDERS, exported.category)) throw new Error('This is not an eligible public broadcast category. Personal reports, Pulse, security and auth mail must stay out of Broadcasts.');
  const { category, subject, html, text } = exported;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 180 || /[\r\n]/.test(subject)) throw new Error('Use a valid broadcast subject.');
  if (typeof html !== 'string' || !html.trim() || html.length > 1024 * 1024
      || typeof text !== 'string' || !text.trim() || text.length > 1024 * 1024) throw new Error('Both bounded HTML and plain-text bodies are required.');
  if (!html.includes(RESEND_UNSUBSCRIBE) || !text.includes(RESEND_UNSUBSCRIBE)) throw new Error('Both bodies require the Resend unsubscribe token.');
  const withoutToken = (html + text).split(RESEND_UNSUBSCRIBE).join('');
  if (/axom\.invalid|<\s*(script|iframe|object|form)\b|https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(withoutToken)
      || /\{\{[\s\S]*?\}\}/.test(withoutToken)) throw new Error('Unsafe or unresolved broadcast content.');
  const segments = parseMap(env.AXOM_RESEND_BROADCAST_SEGMENTS, 'AXOM_RESEND_BROADCAST_SEGMENTS');
  const topics = parseMap(env.RESEND_TOPIC_IDS, 'RESEND_TOPIC_IDS');
  const segmentId = segments[category];
  const topicId = topics[category];
  if (!uuid(segmentId)) throw new Error('A category-specific opt-in Resend Segment ID is required; never use All Contacts.');
  if (!uuid(topicId)) throw new Error('A matching Resend Topic ID is required.');
  if (segmentId === topicId) throw new Error('The segment and topic must be separate provider resources.');
  const from = env[BROADCAST_SENDERS[category]];
  const domain = senderDomain(from);
  // Resend's Broadcast API accepts a Segment, not a Topic ID. Topic opt-out alone
  // does not prove segment membership. Verify the category-specific Segment separately.
  const payload = { name: 'AXOM ' + campaignId + ' | ' + category, segment_id: segmentId, from, subject: subject.trim(), html, text };
  return { category, campaignId, segmentId, topicId, senderDomain: domain, payload, payloadHash: sha256(JSON.stringify(payload)) };
}

async function requestResend(env, fetcher, method, path, data) {
  if (!env.RESEND_API_KEY || typeof env.RESEND_API_KEY !== 'string') throw new Error('RESEND_API_KEY must be configured on the operator machine.');
  let response;
  try {
    response = await fetcher('https://api.resend.com' + path, {
      method,
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error('Resend request was interrupted. Reconcile its status before retrying.'); }
  if (!response.ok) throw new Error('Resend returned HTTP ' + response.status + '. Inspect the provider before retrying.');
  try { return await response.json(); } catch { throw new Error('Resend returned an unparseable acknowledgement. Reconcile before retrying.'); }
}

async function verifyProviderDraftPrerequisites(plan, env, fetcher) {
  const domains = await requestResend(env, fetcher, 'GET', '/domains');
  if (!Array.isArray(domains.data) || !domains.data.some(d => d.name?.toLowerCase() === plan.senderDomain && d.status === 'verified')) {
    throw new Error('The configured Resend sender domain is not verified.');
  }
  const segment = await requestResend(env, fetcher, 'GET', '/segments/' + encodeURIComponent(plan.segmentId));
  if (segment.id !== plan.segmentId) throw new Error('The configured Resend Segment is unavailable.');
}

function ledgerPath(ledgerDir, campaignId) {
  if (!uuid(campaignId)) throw new Error('A canonical campaign UUID is required.');
  return join(resolve(ledgerDir), campaignId + '.json');
}
async function saveLedger(file, value) {
  const temp = file + '.next';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
async function loadLedger(ledgerDir, campaignId) {
  let row;
  try { row = JSON.parse(await readFile(ledgerPath(ledgerDir, campaignId), 'utf8')); }
  catch { throw new Error('No local provider ledger exists. Do not guess or recreate a remote Broadcast.'); }
  if (row.campaignId !== campaignId) throw new Error('The ledger campaign identity does not match.');
  return row;
}
function ledgerRecord(plan) {
  return { campaignId: plan.campaignId, category: plan.category, segmentId: plan.segmentId, topicId: plan.topicId, from: plan.payload.from, payloadHash: plan.payloadHash, providerId: null, state: 'preflight', updatedAt: new Date().toISOString() };
}

export async function createResendDraft(exported, opts) {
  const { campaignId, env, ledgerDir, fetcher = fetch, apply = false, consentAttested = false } = opts;
  const plan = planResendDraft(exported, { campaignId, env });
  if (!apply) return { state: 'preview', category: plan.category, topicId: plan.topicId, segmentId: plan.segmentId, payloadHash: plan.payloadHash, willSend: false };
  if (!consentAttested) throw new Error('Explicit consent-segment audit is required; no Broadcast has been created.');
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is missing.');
  const file = ledgerPath(ledgerDir, campaignId);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) { if (error?.code === 'EEXIST') throw new Error('A ledger already exists. Inspect or reconcile it; automatic duplicate creation is forbidden.'); throw error; }
  const row = ledgerRecord(plan);
  try { await handle.writeFile(JSON.stringify(row, null, 2) + '\n'); } finally { await handle.close(); }

  try {
    await verifyProviderDraftPrerequisites(plan, env, fetcher);
  } catch (error) {
    await saveLedger(file, { ...row, state: 'blocked-preflight', updatedAt: new Date().toISOString() });
    throw error;
  }
  // At this boundary a remote POST may succeed even if its response is lost.
  // Record uncertainty BEFORE the HTTP call; never repeat this POST automatically.
  await saveLedger(file, { ...row, state: 'creation-uncertain', updatedAt: new Date().toISOString() });
  let created;
  try { created = await requestResend(env, fetcher, 'POST', '/broadcasts', plan.payload); }
  catch { throw new Error('Broadcast creation requires reconciliation. Inspect Resend by internal name ' + plan.payload.name + ' before attempting any replacement.'); }
  if (!uuid(created.id)) throw new Error('Broadcast creation requires reconciliation; provider ID was not confirmed.');
  await saveLedger(file, { ...row, providerId: created.id, state: 'draft', updatedAt: new Date().toISOString() });
  return { state: 'draft', providerId: created.id, category: plan.category, topicId: plan.topicId, willSend: false };
}

export async function inspectResendDraft({ campaignId, env, ledgerDir, fetcher = fetch }) {
  const ledger = await loadLedger(ledgerDir, campaignId);
  if (!uuid(ledger.providerId)) throw new Error('Provider creation needs manual reconciliation; no recorded ID can be queried.');
  const remote = await requestResend(env, fetcher, 'GET', '/broadcasts/' + encodeURIComponent(ledger.providerId));
  if (remote.id !== ledger.providerId) throw new Error('Provider Broadcast identity mismatch.');
  return { campaignId, providerId: ledger.providerId, localState: ledger.state, status: remote.status ?? 'unknown', segmentId: remote.segment_id ?? null, category: ledger.category };
}

export async function updateResendDraft(exported, opts) {
  const { campaignId, env, ledgerDir, fetcher = fetch, apply = false, consentAttested = false } = opts;
  const plan = planResendDraft(exported, { campaignId, env });
  const file = ledgerPath(ledgerDir, campaignId);
  const ledger = await loadLedger(ledgerDir, campaignId);
  if (ledger.state !== 'draft' || !uuid(ledger.providerId)) throw new Error('A draft with no ambiguous provider operation is required for update.');
  if (ledger.category !== plan.category || ledger.segmentId !== plan.segmentId || ledger.topicId !== plan.topicId || ledger.from !== plan.payload.from) throw new Error('Audience or sender changed; reconcile the Broadcast separately.');
  if (ledger.payloadHash === plan.payloadHash) return { state: 'draft', providerId: ledger.providerId, unchanged: true, willSend: false };
  if (!apply) return { state: 'preview', providerId: ledger.providerId, willSend: false };
  if (!consentAttested) throw new Error('Explicit consent-segment audit is required for an update.');
  await verifyProviderDraftPrerequisites(plan, env, fetcher);
  const remote = await requestResend(env, fetcher, 'GET', '/broadcasts/' + encodeURIComponent(ledger.providerId));
  if (remote.id !== ledger.providerId || remote.status !== 'draft' || remote.segment_id !== plan.segmentId) throw new Error('Remote Broadcast is not a draft with the expected segment. Changes are blocked.');
  await saveLedger(file, { ...ledger, state: 'update-uncertain', updatedAt: new Date().toISOString() });
  try {
    // No send, schedule or recipient fields. The provider must stay in draft state.
    await requestResend(env, fetcher, 'PATCH', '/broadcasts/' + encodeURIComponent(ledger.providerId), {
      name: plan.payload.name, from: plan.payload.from, subject: plan.payload.subject, html: plan.payload.html, text: plan.payload.text,
    });
  } catch { throw new Error('Draft update requires reconciliation in Resend; do not retry until reviewed.'); }
  await saveLedger(file, { ...ledger, payloadHash: plan.payloadHash, state: 'draft', updatedAt: new Date().toISOString() });
  return { state: 'draft', providerId: ledger.providerId, willSend: false };
}

async function cli(argv, env = process.env) {
  const command = argv[0] || 'help';
  if (command === 'help' || argv.includes('--help')) {
    process.stdout.write('AXOM Resend Broadcast bridge (never sends or schedules)\n'
      + '  node scripts/resend-broadcast-bridge.mjs preview --file <AXOM export.json> --campaign <uuid>\n'
      + '  node scripts/resend-broadcast-bridge.mjs create-draft --file <export.json> --campaign <uuid> --consent-attested --apply\n'
      + '  node scripts/resend-broadcast-bridge.mjs update-draft --file <export.json> --campaign <uuid> --consent-attested --apply\n'
      + '  node scripts/resend-broadcast-bridge.mjs inspect --campaign <uuid>\n'
      + 'Operator secrets: RESEND_API_KEY, RESEND_TOPIC_IDS, AXOM_RESEND_BROADCAST_SEGMENTS, AXOM_EMAIL_FROM_REPORTS / AXOM_EMAIL_FROM_EDITORIAL.\n');
    return;
  }
  const flag = name => { const index = argv.indexOf('--' + name); return index < 0 ? undefined : argv[index + 1]; };
  const campaignId = flag('campaign');
  const ledgerDir = flag('ledger-dir') || 'artifacts/communications/resend-broadcast-ledger';
  const file = flag('file');
  const opts = { campaignId, env, ledgerDir, apply: argv.includes('--apply'), consentAttested: argv.includes('--consent-attested') };
  if (command === 'inspect') {
    process.stdout.write(JSON.stringify(await inspectResendDraft(opts), null, 2) + '\n');
    return;
  }
  if (!['preview', 'create-draft', 'update-draft'].includes(command) || !file) throw new Error('Choose a supported command and an AXOM export JSON file. Run help.');
  const exported = JSON.parse(await readFile(file, 'utf8'));
  const result = command === 'update-draft' ? await updateResendDraft(exported, opts) : await createResendDraft(exported, { ...opts, apply: command === 'create-draft' && opts.apply });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).catch(error => {
    process.stderr.write('AXOM Resend bridge: ' + (error instanceof Error ? error.message : 'Operation failed.') + '\n');
    process.exitCode = 1;
  });
}

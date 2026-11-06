import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResendDraft, inspectResendDraft, planResendDraft, updateResendDraft } from './resend-broadcast-bridge.mjs';

const campaignId = '00000000-0000-4000-8000-000000000067';
const segmentId = '10000000-0000-4000-8000-000000000001';
const topicId = '20000000-0000-4000-8000-000000000002';
const token = '{{{RESEND_UNSUBSCRIBE_URL}}}';
const source = () => ({
  category: 'product_updates',
  subject: 'AXOM — a clearer place for the work',
  html: '<!doctype html><html><body><h1>What changed</h1><p>Source-backed updates.</p><a href="https://axom.info/">Open AXOM</a><a href="' + token + '">Unsubscribe</a></body></html>',
  text: 'What changed. Source-backed updates. https://axom.info/ Unsubscribe: ' + token,
});
const env = () => ({
  RESEND_API_KEY: 're_test_never_send',
  RESEND_TOPIC_IDS: JSON.stringify({ product_updates: topicId }),
  AXOM_RESEND_BROADCAST_SEGMENTS: JSON.stringify({ product_updates: segmentId }),
  AXOM_EMAIL_FROM_REPORTS: 'AXOM Reports <reports@mail.axom.info>',
});

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function fakeProvider() {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path === '/domains') return json({ data: [{ id: 'd1', name: 'mail.axom.info', status: 'verified' }] });
    if (path === '/segments/' + segmentId) return json({ id: segmentId, name: 'AXOM Product Update opt-ins' });
    if (path === '/broadcasts' && init.method === 'POST') return json({ id: '30000000-0000-4000-8000-000000000003' }, 201);
    if (path === '/broadcasts/30000000-0000-4000-8000-000000000003' && (!init.method || init.method === 'GET')) return json({ id: '30000000-0000-4000-8000-000000000003', status: 'draft', segment_id: segmentId });
    if (path === '/broadcasts/30000000-0000-4000-8000-000000000003' && init.method === 'PATCH') return json({ id: '30000000-0000-4000-8000-000000000003' });
    throw new Error('Unexpected fake provider call: ' + path + ' ' + init.method);
  };
  return { calls, fetcher };
}
async function withLedger(fn) {
  const ledgerDir = await mkdtemp(join(tmpdir(), 'axom-resend-'));
  try { return await fn(ledgerDir); } finally { await rm(ledgerDir, { recursive: true, force: true }); }
}

test('provider draft plan is category-scoped and has no send or schedule fields', () => {
  const plan = planResendDraft(source(), { campaignId, env: env() });
  assert.equal(plan.category, 'product_updates');
  assert.equal(plan.topicId, topicId);
  assert.equal(plan.payload.segment_id, segmentId);
  assert.equal(plan.payload.from, env().AXOM_EMAIL_FROM_REPORTS);
  assert.equal(plan.payload.send, undefined);
  assert.equal(plan.payload.scheduled_at, undefined);
  assert.ok(plan.payload.html.includes(token));
  assert.ok(plan.payload.text.includes(token));
});

test('refuses private learning content, unsubscribed-unsafe drafts and an all-contacts segment', () => {
  assert.throws(() => planResendDraft({ ...source(), category: 'annual_pulse' }, { campaignId, env: env() }), /broadcast category/i);
  assert.throws(() => planResendDraft({ ...source(), html: '<h1>No unsubscribe</h1>' }, { campaignId, env: env() }), /unsubscribe/i);
  assert.throws(() => planResendDraft(source(), { campaignId, env: { ...env(), AXOM_RESEND_BROADCAST_SEGMENTS: JSON.stringify({ product_updates: 'all' }) } }), /segment/i);
  assert.throws(() => planResendDraft({ ...source(), html: source().html + '<script>bad()</script>' }, { campaignId, env: env() }), /unsafe/i);
});

test('preview is read-only, without provider requests or a ledger', async () => withLedger(async ledgerDir => {
  const provider = fakeProvider();
  const result = await createResendDraft(source(), { campaignId, env: env(), ledgerDir, fetcher: provider.fetcher });
  assert.equal(result.state, 'preview');
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(await readdir(ledgerDir), []);
}));

test('creating a draft requires explicit apply and audience attestation', async () => withLedger(async ledgerDir => {
  const provider = fakeProvider();
  await assert.rejects(() => createResendDraft(source(), { campaignId, env: env(), ledgerDir, fetcher: provider.fetcher, apply: true }), /consent/i);
  assert.equal(provider.calls.length, 0);
}));

test('provider create is draft-only, checks a verified sender, and refuses duplicate creation', async () => withLedger(async ledgerDir => {
  const provider = fakeProvider();
  const opts = { campaignId, env: env(), ledgerDir, fetcher: provider.fetcher, apply: true, consentAttested: true };
  const first = await createResendDraft(source(), opts);
  assert.equal(first.state, 'draft');
  assert.equal(first.providerId, '30000000-0000-4000-8000-000000000003');
  const posted = provider.calls.filter(c => c.method === 'POST');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].path, '/broadcasts');
  assert.equal(posted[0].body.send, undefined);
  assert.equal(posted[0].body.scheduled_at, undefined);
  assert.equal(posted[0].body.to, undefined);
  const ledger = JSON.parse(await readFile(join(ledgerDir, campaignId + '.json'), 'utf8'));
  assert.equal(ledger.providerId, first.providerId);
  await assert.rejects(() => createResendDraft(source(), opts), /already exists|reconciliation/i);
  assert.equal(provider.calls.filter(c => c.method === 'POST').length, 1);
}));

test('unverified sender rejects creation before POST, leaving a reconciliation ledger', async () => withLedger(async ledgerDir => {
  const provider = fakeProvider();
  const fetcher = async (url, init) => {
    if (new URL(url).pathname === '/domains') return json({ data: [{ name: 'mail.axom.info', status: 'pending' }] });
    return provider.fetcher(url, init);
  };
  await assert.rejects(() => createResendDraft(source(), { campaignId, env: env(), ledgerDir, fetcher, apply: true, consentAttested: true }), /verified/i);
  assert.equal(provider.calls.filter(c => c.method === 'POST').length, 0);
}));

test('ambiguous create failure is never retried automatically', async () => withLedger(async ledgerDir => {
  const provider = fakeProvider();
  const fetcher = async (url, init) => {
    if (new URL(url).pathname === '/broadcasts' && init.method === 'POST') throw new Error('network reset after upstream may have accepted');
    return provider.fetcher(url, init);
  };
  const opts = { campaignId, env: env(), ledgerDir, fetcher, apply: true, consentAttested: true };
  await assert.rejects(() => createResendDraft(source(), opts), /reconciliation/i);
  const ledger = JSON.parse(await readFile(join(ledgerDir, campaignId + '.json'), 'utf8'));
  assert.equal(ledger.state, 'creation-uncertain');
  await assert.rejects(() => createResendDraft(source(), opts), /already exists|reconciliation/i);
}));

test('update only edits an existing remote draft and refuses sent or scheduled broadcasts', async () => withLedger(async ledgerDir => {
  const provider = fakeProvider();
  const opts = { campaignId, env: env(), ledgerDir, fetcher: provider.fetcher, apply: true, consentAttested: true };
  await createResendDraft(source(), opts);
  const changed = { ...source(), subject: 'AXOM — Release notes, revised' };
  const result = await updateResendDraft(changed, opts);
  assert.equal(result.state, 'draft');
  assert.equal(provider.calls.filter(c => c.method === 'PATCH').length, 1);
  const remote = await inspectResendDraft({ campaignId, env: env(), ledgerDir, fetcher: provider.fetcher });
  assert.equal(remote.status, 'draft');
  const blocked = async (url, init) => new URL(url).pathname.startsWith('/broadcasts/') && (!init.method || init.method === 'GET')
    ? json({ id: '30000000-0000-4000-8000-000000000003', status: 'scheduled', segment_id: segmentId })
    : provider.fetcher(url, init);
  await assert.rejects(() => updateResendDraft({ ...changed, subject: 'Another edit' }, { ...opts, fetcher: blocked }), /not a draft/i);
  assert.equal(provider.calls.filter(c => c.method === 'PATCH').length, 1);
}));

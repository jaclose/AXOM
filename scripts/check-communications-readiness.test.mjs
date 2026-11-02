import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommunicationsReadiness, formatCommunicationsReadiness, TOPIC_CATEGORIES } from './check-communications-readiness.mjs';

const configured = {
  AXOM_EMAIL_MODE: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'private-service-role-sentinel',
  RESEND_API_KEY: 'private-resend-sentinel',
  AXOM_EMAIL_FROM_ACCOUNT: 'AXOM <account@mail.example.org>',
  AXOM_EMAIL_FROM_REPORTS: 'AXOM Reports <reports@mail.example.org>',
  AXOM_EMAIL_FROM_EDITORIAL: 'AXOM Notes <notes@mail.example.org>',
  AXOM_EMAIL_REPLY_TO: 'support@example.org',
  AXOM_PUBLIC_URL: 'https://example.org',
  AXOM_ALLOWED_ORIGINS: 'https://example.org,http://127.0.0.1:5173',
  AXOM_EMAIL_TEST_RECIPIENTS: 'reader@example.org',
  AXOM_COMMUNICATIONS_CRON_SECRET: 'cron-sentinel-0123456789-0123456789',
  AXOM_COMMUNICATIONS_TOKEN_SECRET: 'token-sentinel-0123456789-0123456789',
  RESEND_WEBHOOK_SECRET: 'private-webhook-sentinel',
  AXOM_COMMUNICATIONS_ADMINS: 'f4b8bd23-3333-4333-8333-d12ad31ca322',
  RESEND_TOPIC_IDS: JSON.stringify(Object.fromEntries(TOPIC_CATEGORIES.map((category, index) => [category, `topic-${index}`]))),
};

test('a complete local test configuration still calls for external acceptance', () => {
  assert.equal(TOPIC_CATEGORIES.length, 10);
  const report = checkCommunicationsReadiness(configured);
  assert.equal(report.configurationComplete, true);
  assert.ok(report.external.length >= 5);
  const output = formatCommunicationsReadiness(report);
  for (const secret of ['private-service-role-sentinel', 'private-resend-sentinel', 'private-webhook-sentinel']) assert.ok(!output.includes(secret));
  assert.ok(!JSON.stringify(report).includes('reader@example.org'));
});

test('disabled mode and malformed Topics cannot be mistaken for readiness', () => {
  const report = checkCommunicationsReadiness({ ...configured, AXOM_EMAIL_MODE: 'disabled', RESEND_TOPIC_IDS: '{' });
  assert.equal(report.configurationComplete, false);
  assert.equal(report.checks.find(check => check.name === 'AXOM_EMAIL_MODE')?.status, 'action');
  assert.equal(report.checks.find(check => check.name === 'RESEND_TOPIC_IDS')?.status, 'action');
});

test('live mode rejects local origins and unverified address syntax without disclosing values', () => {
  const report = checkCommunicationsReadiness({ ...configured, AXOM_EMAIL_MODE: 'live', AXOM_EMAIL_FROM_ACCOUNT: 'Header\nInjection <account@example.org>' });
  assert.equal(report.configurationComplete, false);
  assert.equal(report.checks.find(check => check.name === 'AXOM_ALLOWED_ORIGINS')?.status, 'action');
  assert.equal(report.checks.find(check => check.name === 'AXOM_EMAIL_FROM_ACCOUNT')?.status, 'action');
  assert.ok(!JSON.stringify(report).includes('Header'));
});

test('project URLs must be origins and worker tokens must be independent', () => {
  const report = checkCommunicationsReadiness({
    ...configured,
    SUPABASE_URL: 'https://example.supabase.co/functions/v1',
    AXOM_PUBLIC_URL: 'https://example.org/app',
    AXOM_COMMUNICATIONS_TOKEN_SECRET: configured.AXOM_COMMUNICATIONS_CRON_SECRET,
  });
  assert.equal(report.configurationComplete, false);
  for (const name of ['SUPABASE_URL', 'AXOM_PUBLIC_URL', 'AXOM_COMMUNICATIONS_TOKEN_SECRET']) {
    assert.equal(report.checks.find(check => check.name === name)?.status, 'action');
  }
});

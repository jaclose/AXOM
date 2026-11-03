// Local configuration audit only. It never calls Resend, Supabase or an inbox.
import { pathToFileURL } from 'node:url';
import { TEMPLATE_CATEGORY } from '../supabase/functions/communications/service.js';

const essential = new Set(['account', 'auth', 'security', 'privacy', 'data_export', 'account_deletion']);
export const TOPIC_CATEGORIES = [...new Set(Object.values(TEMPLATE_CATEGORY))].filter(category => !essential.has(category)).sort();

function isAddress(value) {
  if (!value || /[\r\n]/.test(value)) return false;
  const address = value.includes('<') ? value.match(/<([^<>]+)>\s*$/)?.[1] : value.trim();
  return Boolean(address && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address));
}

function isExactOrigin(value, testMode) {
  try {
    const url = new URL(value);
    const local = testMode && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return (url.protocol === 'https:' || local) && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

export function checkCommunicationsReadiness(env) {
  const checks = [];
  const add = (name, valid, need) => checks.push({ name, status: valid ? 'pass' : 'action', detail: valid ? 'Configured locally.' : need });
  const present = name => Boolean(env[name]?.trim());
  const requestedMode = env.AXOM_EMAIL_MODE?.trim() || 'disabled';
  const mode = ['disabled', 'test', 'live'].includes(requestedMode) ? requestedMode : 'invalid';
  const testMode = mode === 'test';

  add('AXOM_EMAIL_MODE', ['test', 'live'].includes(mode), mode === 'disabled' ? 'Delivery is disabled.' : 'Use disabled, test or live.');
  add('SUPABASE_URL', isExactOrigin(env.SUPABASE_URL, false), 'Set the exact HTTPS project URL in the function environment.');
  add('SUPABASE_SERVICE_ROLE_KEY', present('SUPABASE_SERVICE_ROLE_KEY'), 'Set the server-only Supabase credential.');
  add('RESEND_API_KEY', present('RESEND_API_KEY'), 'Set a server-only key with sending and Contacts/Topics access.');
  for (const name of ['AXOM_EMAIL_FROM_ACCOUNT', 'AXOM_EMAIL_FROM_REPORTS', 'AXOM_EMAIL_FROM_EDITORIAL', 'AXOM_EMAIL_REPLY_TO']) {
    add(name, isAddress(env[name]), 'Set a valid address on a verified sending domain.');
  }
  add('AXOM_PUBLIC_URL', isExactOrigin(env.AXOM_PUBLIC_URL, false), 'Set the public HTTPS app origin.');
  const origins = (env.AXOM_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  add('AXOM_ALLOWED_ORIGINS', origins.length > 0 && origins.every(origin => isExactOrigin(origin, testMode)), 'Set exact allowed origins; live mode requires HTTPS.');
  const recipients = (env.AXOM_EMAIL_TEST_RECIPIENTS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  add('AXOM_EMAIL_TEST_RECIPIENTS', recipients.length > 0 && recipients.every(isAddress), 'Add at least one explicit allowlisted test recipient.');
  const cronSecret = env.AXOM_COMMUNICATIONS_CRON_SECRET;
  const tokenSecret = env.AXOM_COMMUNICATIONS_TOKEN_SECRET;
  add('AXOM_COMMUNICATIONS_CRON_SECRET', (cronSecret?.length ?? 0) >= 32, 'Set a separate random secret of at least 32 characters.');
  add('AXOM_COMMUNICATIONS_TOKEN_SECRET', (tokenSecret?.length ?? 0) >= 32 && tokenSecret !== cronSecret, 'Set a stable random secret of at least 32 characters, distinct from the worker secret.');
  add('RESEND_WEBHOOK_SECRET', present('RESEND_WEBHOOK_SECRET'), 'Set the signing secret of the registered Resend webhook.');
  const adminIds = (env.AXOM_COMMUNICATIONS_ADMINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  add('AXOM_COMMUNICATIONS_ADMINS', adminIds.length > 0 && adminIds.every(value => /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)), 'Set at least one exact Supabase user UUID for the studio.');

  let topicIds;
  try { topicIds = JSON.parse(env.RESEND_TOPIC_IDS ?? ''); } catch { topicIds = null; }
  const validTopics = topicIds && !Array.isArray(topicIds) && typeof topicIds === 'object'
    && TOPIC_CATEGORIES.every(category => typeof topicIds[category] === 'string' && topicIds[category].trim())
    && new Set(TOPIC_CATEGORIES.map(category => topicIds[category])).size === TOPIC_CATEGORIES.length;
  add('RESEND_TOPIC_IDS', Boolean(validTopics), `Map all ${TOPIC_CATEGORIES.length} optional categories to distinct Topic IDs.`);

  const external = [
    'Confirm sending-domain DNS, From identities and a monitored Reply-To in Resend.',
    'Confirm the intended Supabase migration, function secrets, deployed function and effective delivery mode.',
    'Register and replay a signed webhook; check idempotency and bounce suppression.',
    'Configure Supabase Auth SMTP and install the generated auth templates.',
    'Schedule the protected worker and inspect queue, failures and consent readback.',
    'Send one explicitly approved allowlisted test and inspect real Gmail, Apple Mail and Outlook rendering.',
  ];
  return { mode, configurationComplete: checks.every(check => check.status === 'pass'), checks, external };
}

export function formatCommunicationsReadiness(report) {
  const lines = [`AXOM communications local configuration: ${report.configurationComplete ? 'COMPLETE' : 'INCOMPLETE'}`, `Delivery mode: ${report.mode}`, ''];
  for (const check of report.checks) lines.push(`${check.status === 'pass' ? 'PASS' : 'ACTION'} ${check.name}: ${check.detail}`);
  lines.push('', 'External acceptance remains unverified by this local check:');
  for (const item of report.external) lines.push(`VERIFY ${item}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = checkCommunicationsReadiness(process.env);
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : `${formatCommunicationsReadiness(report)}\n`);
  if (process.argv.includes('--strict') && !report.configurationComplete) process.exitCode = 1;
}

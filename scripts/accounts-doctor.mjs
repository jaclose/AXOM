#!/usr/bin/env node
// Read-only live check of the AXOM account stack: the Supabase project the app
// is built against, auth email delivery (custom SMTP, normally Resend), the
// database migrations, the ai-proxy Edge Function, Resend itself and, when
// given, the deployed site. It never writes to a service or prints a key.
//
//   npm run accounts:doctor [-- --site https://your-production-origin]
//
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or the legacy
// VITE_SUPABASE_ANON_KEY) from the environment, web/.env.local or .env.local.
// Optional credentials for deeper checks (keep them in your shell):
//   SUPABASE_ACCESS_TOKEN  personal access token (sbp_…) for the Management API
//   RESEND_API_KEY         full-access Resend key, to confirm the sender domain
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGEMENT_API = 'https://api.supabase.com/v1';
const RESEND_API = 'https://api.resend.com';
// Supabase's default once custom SMTP is on; below it, a few sign-ups in an
// hour exhaust the project-wide allowance ("email rate limit exceeded").
const MIN_EMAILS_PER_HOUR = 30;
const MIGRATED_TABLES = ['workspaces', 'workspace_revisions', 'account_devices', 'ai_usage'];
const SMTP_FIX = 'Resend → Integrations → Supabase connects it in one step. Or Supabase → Authentication → Emails → SMTP: host smtp.resend.com, port 465, user resend, password = a Resend API key, sender on a domain verified in Resend.';

export function parseEnvFile(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const raw = match[2];
    env[match[1]] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, '');
  }
  return env;
}

/** Shell values win over web/.env.local, which wins over a root .env.local (vercel env pull). */
export function loadDoctorEnv(root, processEnv = process.env) {
  const files = [join(root, '.env.local'), join(root, 'web/.env'), join(root, 'web/.env.local')];
  const fromFiles = Object.assign({}, ...files.filter(existsSync).map((file) => parseEnvFile(readFileSync(file, 'utf8'))));
  const env = { ...fromFiles };
  for (const [key, value] of Object.entries(processEnv)) if (value) env[key] = value;
  return env;
}

export function projectRefFrom(url) {
  try {
    return new URL(url).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Classifies a client key without ever exposing it. */
export function classifyKey(key) {
  if (!key) return 'missing';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  if (key.startsWith('sb_secret_')) return 'secret';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role;
      if (role === 'anon') return 'anon';
      if (role === 'service_role') return 'secret';
    } catch { /* not a JWT */ }
  }
  return 'unknown';
}

const result = (status) => (id, label, detail, fix) => ({ id, label, status, detail, ...(fix ? { fix } : {}) });
const pass = result('pass');
const fail = result('fail');
const warn = result('warn');
const skip = result('skip');

async function request(fetchImpl, url, init = {}) {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
    return { status: response.status, headers: response.headers, text, json };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

const unreachable = (response) => (response.status === 0 ? `unreachable (${response.error})` : `HTTP ${response.status}`);

async function checkProject(url, key, fetchImpl, results) {
  const headers = { apikey: key };
  const health = await request(fetchImpl, `${url}/auth/v1/health`, { headers });
  if (health.status !== 200) {
    results.push(fail('auth.health', 'Supabase Auth', `Auth health check failed: ${unreachable(health)}.`, 'Check the project URL and key, and that the project is not paused (Supabase pauses idle free projects).'));
    return false;
  }
  results.push(pass('auth.health', 'Supabase Auth', `Reachable${health.json?.version ? ` (GoTrue ${health.json.version})` : ''}.`));

  const settings = await request(fetchImpl, `${url}/auth/v1/settings`, { headers });
  const auth = settings.json;
  if (settings.status !== 200 || !auth) {
    results.push(warn('auth.settings', 'Email sign-in', `Could not read auth settings: ${unreachable(settings)}.`));
  } else if (auth.external?.email !== true) {
    results.push(fail('auth.settings', 'Email sign-in', 'The Email provider is disabled, so nobody can sign in or create an account.', 'Supabase → Authentication → Sign In / Providers → enable Email.'));
  } else if (auth.disable_signup === true) {
    results.push(warn('auth.settings', 'Email sign-in', 'Email sign-in is on, but new sign-ups are disabled.', 'Supabase → Authentication → Sign In / Providers → allow new users to sign up.'));
  } else if (auth.mailer_autoconfirm === true) {
    results.push(warn('auth.settings', 'Email sign-in', 'Sign-ups are confirmed automatically, so anyone can claim any address.', 'Supabase → Authentication → Sign In / Providers → Email → turn on Confirm email.'));
  } else {
    results.push(pass('auth.settings', 'Email sign-in', 'Email sign-in and sign-up are on, with email confirmation.'));
  }

  const missing = [];
  for (const table of MIGRATED_TABLES) {
    const probe = await request(fetchImpl, `${url}/rest/v1/${table}?select=*&limit=0`, { headers });
    if (probe.status === 404 || probe.status === 0) missing.push(table);
  }
  const rpc = await request(fetchImpl, `${url}/rest/v1/rpc/consume_ai_quota`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
  if (rpc.status === 404 || rpc.status === 0) missing.push('consume_ai_quota()');
  results.push(missing.length
    ? fail('db.migrations', 'Database migrations', `Missing from the API: ${missing.join(', ')}.`, 'npx supabase link --project-ref <ref> && npx supabase db push (never the legacy db/migrations).')
    : pass('db.migrations', 'Database migrations', 'Account, sync and Cloud AI quota objects exist.'));

  // Browsers preflight without a JWT, so the function itself answers OPTIONS.
  const preflight = await request(fetchImpl, `${url}/functions/v1/ai-proxy`, { method: 'OPTIONS', headers: { ...headers, Origin: 'https://doctor.axom.invalid', 'Access-Control-Request-Method': 'POST' } });
  if (preflight.status === 404) {
    results.push(fail('functions.ai-proxy', 'Cloud AI function', 'ai-proxy is not deployed, so AXOM Cloud AI cannot answer.', 'npx supabase functions deploy ai-proxy'));
  } else if (preflight.status >= 200 && preflight.status < 300) {
    results.push(pass('functions.ai-proxy', 'Cloud AI function', 'ai-proxy answers.'));
  } else {
    results.push(warn('functions.ai-proxy', 'Cloud AI function', `ai-proxy preflight returned ${unreachable(preflight)}. Set SUPABASE_ACCESS_TOKEN to check it directly.`));
  }
  return true;
}

async function checkManagement(ref, token, fetchImpl, results) {
  const headers = { Authorization: `Bearer ${token}` };
  const config = await request(fetchImpl, `${MANAGEMENT_API}/projects/${ref}/config/auth`, { headers });
  if (config.status === 401 || config.status === 403) {
    results.push(fail('mgmt.token', 'Management API', 'SUPABASE_ACCESS_TOKEN was rejected for this project.', 'Create a token under Supabase → Account → Access Tokens with access to this project.'));
    return {};
  }
  if (config.status !== 200 || !config.json) {
    results.push(warn('mgmt.token', 'Management API', `Could not read the auth config: ${unreachable(config)}.`));
    return {};
  }
  const auth = config.json;
  const sender = auth.smtp_admin_email || '';
  if (!auth.smtp_host) {
    results.push(fail('email.smtp', 'Auth email delivery', "Custom SMTP is off. Supabase's built-in mailer only sends to your project team, a few emails an hour, so real sign-ups never get their code.", SMTP_FIX));
  } else {
    const via = /resend/i.test(auth.smtp_host) ? 'Resend SMTP' : 'Custom SMTP';
    results.push(pass('email.smtp', 'Auth email delivery', `${via} ${auth.smtp_host}:${auth.smtp_port ?? '?'}, from ${auth.smtp_sender_name ? `${auth.smtp_sender_name} ` : ''}<${sender || 'no sender set'}>.`));
    const rate = Number(auth.rate_limit_email_sent);
    if (Number.isFinite(rate) && rate < MIN_EMAILS_PER_HOUR) {
      results.push(warn('email.rate', 'Email rate limit', `Only ${rate} auth emails per hour project-wide.`, `Supabase → Authentication → Rate limits → raise emails sent to ${MIN_EMAILS_PER_HOUR} or more.`));
    } else if (Number.isFinite(rate)) {
      results.push(pass('email.rate', 'Email rate limit', `${rate} auth emails per hour.`));
    }
  }
  const site = auth.site_url || '';
  const allow = String(auth.uri_allow_list || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!/^https:\/\//.test(site) || /localhost|127\.0\.0\.1/.test(site)) {
    results.push(warn('auth.urls', 'Redirect URLs', `Site URL is ${site || 'unset'}. Email links fall back to it, so they would open a dev server.`, 'Supabase → Authentication → URL Configuration → set Site URL to the production origin and allow-list preview and local URLs (docs/ACCOUNTS-SETUP.md step 4).'));
  } else {
    results.push(pass('auth.urls', 'Redirect URLs', `Site URL ${site}; ${allow.length} additional redirect URL${allow.length === 1 ? '' : 's'}.`));
  }

  const secrets = await request(fetchImpl, `${MANAGEMENT_API}/projects/${ref}/secrets`, { headers });
  if (secrets.status === 200 && Array.isArray(secrets.json)) {
    results.push(secrets.json.some((secret) => secret?.name === 'ANTHROPIC_API_KEY')
      ? pass('functions.secret', 'Cloud AI key', 'ANTHROPIC_API_KEY is set as an Edge Function secret.')
      : fail('functions.secret', 'Cloud AI key', 'ANTHROPIC_API_KEY is not set, so Cloud AI answers "not configured".', 'npx supabase secrets set ANTHROPIC_API_KEY=… (never in the app or a VITE_ variable).'));
  }
  const functions = await request(fetchImpl, `${MANAGEMENT_API}/projects/${ref}/functions`, { headers });
  if (functions.status === 200 && Array.isArray(functions.json)) {
    const proxy = functions.json.find((fn) => fn?.slug === 'ai-proxy');
    if (!proxy) results.push(fail('functions.deployed', 'Cloud AI deployment', 'ai-proxy is not deployed.', 'npx supabase functions deploy ai-proxy'));
    else if (proxy.status !== 'ACTIVE') results.push(warn('functions.deployed', 'Cloud AI deployment', `ai-proxy status is ${proxy.status}.`));
    else if (proxy.verify_jwt === false) results.push(warn('functions.deployed', 'Cloud AI deployment', 'ai-proxy is deployed without gateway JWT verification.', 'Redeploy from this repo; supabase/config.toml sets verify_jwt = true.'));
    else results.push(pass('functions.deployed', 'Cloud AI deployment', `ai-proxy v${proxy.version ?? '?'} is active with JWT verification.`));
  }
  return { sender };
}

async function checkResend(key, sender, feedbackFrom, fetchImpl, results) {
  const domains = await request(fetchImpl, `${RESEND_API}/domains`, { headers: { Authorization: `Bearer ${key}` } });
  if (domains.json?.name === 'restricted_api_key') {
    results.push(skip('resend.domains', 'Resend domain', 'This key can only send email (fine for SMTP). Use a full-access key here to confirm the sender domain.'));
    return;
  }
  if (domains.status !== 200 || !Array.isArray(domains.json?.data)) {
    results.push(fail('resend.domains', 'Resend domain', `Could not list Resend domains: ${unreachable(domains)}.`, 'Check RESEND_API_KEY in resend.com → API Keys.'));
    return;
  }
  const verified = domains.json.data.filter((domain) => domain?.status === 'verified').map((domain) => domain.name);
  const addresses = [...new Set([sender, feedbackFrom].map((value) => value?.match(/[^<\s@]+@([^>\s]+)/)?.[1]).filter(Boolean))];
  if (!addresses.length) {
    results.push(verified.length
      ? pass('resend.domains', 'Resend domain', `Verified: ${verified.join(', ')}.`)
      : fail('resend.domains', 'Resend domain', 'No verified sending domain, so Resend only delivers to your own account address.', 'resend.com → Domains → add your domain and publish its DNS records.'));
    return;
  }
  for (const domain of addresses) {
    // Resend verifies each sending domain separately, subdomains included.
    const ok = verified.includes(domain);
    results.push(ok
      ? pass('resend.domains', 'Resend domain', `${domain} is verified.`)
      : fail('resend.domains', 'Resend domain', `${domain} is not a verified Resend domain${domain === 'resend.dev' ? ' (resend.dev only delivers to your own account address)' : ''}.`, 'resend.com → Domains → verify it, or send from a domain that is verified.'));
  }
}

async function checkSite(site, fetchImpl, results) {
  const origin = site.replace(/\/+$/, '');
  const response = await request(fetchImpl, `${origin}/version.json?doctor=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (response.status !== 200 || !response.json) {
    results.push(fail('site.build', 'Deployed build', `${origin}/version.json: ${unreachable(response)}.`, 'Check the latest deployment in Vercel → Deployments.'));
  } else if (response.json.accountsConfigured === true) {
    results.push(pass('site.build', 'Deployed build', `v${response.json.version} (${response.json.commit ?? 'unknown commit'}) was built with the Supabase config.`));
  } else if (response.json.accountsConfigured === false) {
    results.push(fail('site.build', 'Deployed build', `v${response.json.version} was built without VITE_SUPABASE_URL and a publishable key, so accounts are off there.`, 'Vercel → Settings → Environment Variables: add both for Production and Preview, then redeploy.'));
  } else {
    results.push(warn('site.build', 'Deployed build', `v${response.json.version} predates this check; deploy the current main to confirm.`));
  }
}

export async function runDoctor({ env, site, fetchImpl = fetch }) {
  const results = [];
  const url = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url) results.push(fail('env.url', 'Supabase URL', 'VITE_SUPABASE_URL is not set.', 'Copy web/.env.example to web/.env.local and fill it in; set the same variables in Vercel.'));
  else if (!/^https:\/\//.test(url)) results.push(fail('env.url', 'Supabase URL', `${url} is not an https URL.`, 'Use the Project URL from Supabase → Project Settings → API.'));
  else results.push(pass('env.url', 'Supabase URL', url));

  const kind = classifyKey(key);
  if (kind === 'missing') results.push(fail('env.key', 'Client key', 'VITE_SUPABASE_PUBLISHABLE_KEY is not set.', 'Supabase → Project Settings → API Keys → copy the publishable key (sb_publishable_…).'));
  else if (kind === 'secret') results.push(fail('env.key', 'Client key', 'The configured client key is a secret (service-role) key. Every VITE_ value ships inside the app bundle.', 'Replace it with the publishable key now and rotate the secret key in Supabase → Project Settings → API Keys.'));
  else if (kind === 'unknown') results.push(warn('env.key', 'Client key', 'The client key is neither a publishable key nor a legacy anon key.'));
  else results.push(pass('env.key', 'Client key', kind === 'publishable' ? 'Publishable key.' : 'Legacy anon key (the publishable key is preferred).'));

  const ready = /^https:\/\//.test(url) && (kind === 'publishable' || kind === 'anon' || kind === 'unknown');
  const reachable = ready && await checkProject(url, key, fetchImpl, results);

  const ref = projectRefFrom(url);
  let sender = '';
  if (!env.SUPABASE_ACCESS_TOKEN) {
    results.push(skip('mgmt.token', 'Management API', 'Set SUPABASE_ACCESS_TOKEN to check SMTP, email rate limits, redirect URLs and the Cloud AI secret.'));
  } else if (!ref) {
    results.push(skip('mgmt.token', 'Management API', 'The URL is not a <ref>.supabase.co address, so the project ref is unknown.'));
  } else if (reachable) {
    ({ sender = '' } = await checkManagement(ref, env.SUPABASE_ACCESS_TOKEN, fetchImpl, results));
  }

  if (env.RESEND_API_KEY) await checkResend(env.RESEND_API_KEY, sender, env.FEEDBACK_FROM, fetchImpl, results);
  else results.push(skip('resend.domains', 'Resend domain', 'Set RESEND_API_KEY to confirm the sender domain is verified.'));
  if (/@resend\.dev\b/i.test(env.FEEDBACK_FROM ?? '')) {
    results.push(warn('feedback.from', 'Feedback email', 'FEEDBACK_FROM uses resend.dev, which only delivers to your own Resend account address.', 'Set FEEDBACK_FROM in Vercel to an address on your verified domain.'));
  }

  if (site) await checkSite(site, fetchImpl, results);
  else results.push(skip('site.build', 'Deployed build', 'Pass --site https://<production origin> to confirm the live build has accounts turned on.'));
  return results;
}

const ICON = { pass: '✓', fail: '✗', warn: '!', skip: '–' };

export function formatReport(results) {
  const width = Math.max(...results.map((entry) => entry.label.length));
  const lines = results.map((entry) => {
    const line = `  ${ICON[entry.status]} ${entry.label.padEnd(width)}  ${entry.detail}`;
    return entry.fix && entry.status !== 'pass' ? `${line}\n      Fix: ${entry.fix}` : line;
  });
  const failed = results.filter((entry) => entry.status === 'fail').length;
  const warned = results.filter((entry) => entry.status === 'warn').length;
  const summary = failed ? `${failed} check${failed === 1 ? '' : 's'} failed${warned ? `, ${warned} warning${warned === 1 ? '' : 's'}` : ''}.` : warned ? `No failures, ${warned} warning${warned === 1 ? '' : 's'}.` : 'Everything checked out.';
  return `${lines.join('\n')}\n\n${summary}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const siteIndex = process.argv.indexOf('--site');
  const site = siteIndex > -1 ? process.argv[siteIndex + 1] : process.env.AXOM_SITE_URL;
  const env = loadDoctorEnv(root);
  console.log(`AXOM accounts doctor${env.VITE_SUPABASE_URL ? ` · ${env.VITE_SUPABASE_URL}` : ''}\n`);
  const results = await runDoctor({ env, site });
  console.log(formatReport(results));
  process.exitCode = results.some((entry) => entry.status === 'fail') ? 1 : 0;
}

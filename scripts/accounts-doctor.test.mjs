import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKey, formatReport, parseEnvFile, projectRefFrom, runDoctor } from './accounts-doctor.mjs';

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const jwt = (payload) => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

/** Routes "METHOD url-prefix" to [status, body]; anything unrouted is a 404. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers ?? {} });
    const key = Object.keys(routes).find((route) => {
      const [m, prefix] = route.split(' ');
      return m === method && String(url).startsWith(prefix);
    });
    const [status, body] = key ? routes[key] : [404, { message: 'not found' }];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

const healthyProject = {
  [`GET ${URL_}/auth/v1/health`]: [200, { version: 'v2.180.0' }],
  [`GET ${URL_}/auth/v1/settings`]: [200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: false }],
  [`GET ${URL_}/rest/v1/`]: [200, []],
  [`POST ${URL_}/rest/v1/rpc/consume_ai_quota`]: [401, { code: '42501', message: 'permission denied for function consume_ai_quota' }],
  [`OPTIONS ${URL_}/functions/v1/ai-proxy`]: [200, 'ok'],
};

const statusOf = (results, id) => results.filter((entry) => entry.id === id).map((entry) => entry.status);

test('parses env files, derives the project ref and classifies keys without exposing them', () => {
  assert.deepEqual(parseEnvFile('# c\nexport A="x y"\nB=z # note\nC=\'q\'\nnot a line'), { A: 'x y', B: 'z', C: 'q' });
  assert.equal(projectRefFrom(URL_), 'abcdefghijklmnopqrst');
  assert.equal(projectRefFrom('https://auth.example.com'), null);
  assert.equal(classifyKey('sb_publishable_abc'), 'publishable');
  assert.equal(classifyKey('sb_secret_abc'), 'secret');
  assert.equal(classifyKey(jwt({ role: 'anon' })), 'anon');
  assert.equal(classifyKey(jwt({ role: 'service_role' })), 'secret');
  assert.equal(classifyKey(''), 'missing');
});

test('refuses to probe with a secret key and never prints it', async () => {
  const secret = 'sb_secret_do_not_print';
  const { fetchImpl, calls } = fakeFetch({});
  const results = await runDoctor({ env: { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_PUBLISHABLE_KEY: secret }, fetchImpl });
  assert.deepEqual(statusOf(results, 'env.key'), ['fail']);
  assert.equal(calls.length, 0);
  assert.doesNotMatch(formatReport(results), /do_not_print/);
});

test('passes a healthy project and skips the checks that need credentials', async () => {
  const { fetchImpl } = fakeFetch(healthyProject);
  const results = await runDoctor({ env: { VITE_SUPABASE_URL: `${URL_}/`, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }, fetchImpl });
  for (const id of ['env.url', 'env.key', 'auth.health', 'auth.settings', 'db.migrations', 'functions.ai-proxy']) {
    assert.deepEqual(statusOf(results, id), ['pass'], id);
  }
  assert.deepEqual(statusOf(results, 'mgmt.token'), ['skip']);
  assert.deepEqual(statusOf(results, 'resend.domains'), ['skip']);
  assert.match(formatReport(results), /Everything checked out/);
});

test('flags missing migrations, an undeployed function and disabled email sign-in', async () => {
  const { fetchImpl } = fakeFetch({
    ...healthyProject,
    [`GET ${URL_}/auth/v1/settings`]: [200, { external: { email: false } }],
    [`GET ${URL_}/rest/v1/`]: [404, { code: 'PGRST205' }],
    [`POST ${URL_}/rest/v1/rpc/consume_ai_quota`]: [404, { code: 'PGRST202' }],
    [`OPTIONS ${URL_}/functions/v1/ai-proxy`]: [404, { code: 'NOT_FOUND' }],
  });
  const results = await runDoctor({ env: { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) }, fetchImpl });
  assert.deepEqual(statusOf(results, 'auth.settings'), ['fail']);
  assert.deepEqual(statusOf(results, 'db.migrations'), ['fail']);
  assert.match(results.find((entry) => entry.id === 'db.migrations').detail, /workspaces.*consume_ai_quota/);
  assert.deepEqual(statusOf(results, 'functions.ai-proxy'), ['fail']);
  assert.match(formatReport(results), /3 checks failed/);
});

test('reports the built-in mailer, a low rate limit, dev redirect URLs and a missing AI secret', async () => {
  const mgmt = 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst';
  const withoutSmtp = fakeFetch({
    ...healthyProject,
    [`GET ${mgmt}/config/auth`]: [200, { smtp_host: null, site_url: 'http://127.0.0.1:5187', uri_allow_list: '' }],
    [`GET ${mgmt}/secrets`]: [200, [{ name: 'SUPABASE_URL' }]],
    [`GET ${mgmt}/functions`]: [200, [{ slug: 'ai-proxy', status: 'ACTIVE', verify_jwt: true, version: 3 }]],
  });
  const env = { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', SUPABASE_ACCESS_TOKEN: 'sbp_x' };
  let results = await runDoctor({ env, fetchImpl: withoutSmtp.fetchImpl });
  assert.deepEqual(statusOf(results, 'email.smtp'), ['fail']);
  assert.match(results.find((entry) => entry.id === 'email.smtp').fix, /smtp\.resend\.com/);
  assert.deepEqual(statusOf(results, 'auth.urls'), ['warn']);
  assert.deepEqual(statusOf(results, 'functions.secret'), ['fail']);
  assert.deepEqual(statusOf(results, 'functions.deployed'), ['pass']);
  assert.ok(withoutSmtp.calls.every((call) => !call.url.startsWith('https://api.supabase.com') || call.headers.Authorization === 'Bearer sbp_x'));

  const withResend = fakeFetch({
    ...healthyProject,
    [`GET ${mgmt}/config/auth`]: [200, { smtp_host: 'smtp.resend.com', smtp_port: 465, smtp_admin_email: 'auth@axom.info', smtp_sender_name: 'AXOM', rate_limit_email_sent: 2, site_url: 'https://axom.info', uri_allow_list: 'https://axom.info/**,http://localhost:5173/**' }],
    [`GET ${mgmt}/secrets`]: [200, [{ name: 'ANTHROPIC_API_KEY' }]],
    [`GET ${mgmt}/functions`]: [200, []],
    'GET https://api.resend.com/domains': [200, { data: [{ name: 'axom.info', status: 'verified' }, { name: 'other.dev', status: 'pending' }] }],
  });
  results = await runDoctor({ env: { ...env, RESEND_API_KEY: 're_x', FEEDBACK_FROM: 'AXOM <feedback@other.dev>' }, fetchImpl: withResend.fetchImpl });
  assert.deepEqual(statusOf(results, 'email.smtp'), ['pass']);
  assert.deepEqual(statusOf(results, 'email.rate'), ['warn']);
  assert.deepEqual(statusOf(results, 'auth.urls'), ['pass']);
  assert.deepEqual(statusOf(results, 'functions.secret'), ['pass']);
  assert.deepEqual(statusOf(results, 'functions.deployed'), ['fail']);
  // The SMTP sender's domain is verified; the feedback sender's is not.
  assert.deepEqual(statusOf(results, 'resend.domains'), ['pass', 'fail']);
});

test('treats a sending-only Resend key as a skip and warns about resend.dev feedback senders', async () => {
  const { fetchImpl } = fakeFetch({
    ...healthyProject,
    'GET https://api.resend.com/domains': [401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }],
  });
  const results = await runDoctor({ env: { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', RESEND_API_KEY: 're_send_only', FEEDBACK_FROM: 'AXOM <onboarding@resend.dev>' }, fetchImpl });
  assert.deepEqual(statusOf(results, 'resend.domains'), ['skip']);
  assert.deepEqual(statusOf(results, 'feedback.from'), ['warn']);
});

test('reads the deployed build flag from version.json', async () => {
  const site = 'https://axom.example';
  const check = async (body) => {
    const { fetchImpl } = fakeFetch({ ...healthyProject, [`GET ${site}/version.json`]: [200, body] });
    const results = await runDoctor({ env: { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }, site: `${site}/`, fetchImpl });
    return statusOf(results, 'site.build')[0];
  };
  assert.equal(await check({ version: '0.0.2', commit: 'abc', accountsConfigured: true }), 'pass');
  assert.equal(await check({ version: '0.0.2', accountsConfigured: false }), 'fail');
  assert.equal(await check({ version: '0.0.1' }), 'warn');
});

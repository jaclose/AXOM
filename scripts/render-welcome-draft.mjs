// Reproducible, synthetic inbox draft from the Edge-function email renderer.
// This script writes local files only; it never creates a delivery job.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderAxomEmail } from '../supabase/functions/communications/service.js';

const root = new URL('../', import.meta.url);
const defaultOutput = new URL('../artifacts/communications/welcome-draft/', import.meta.url);
const orbUrl = 'https://axom.info/icons/axom-orb-512.png';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function verifyRenderer() {
  const manifest = JSON.parse(await readFile(new URL('supabase/functions/communications/source-manifest.json', root), 'utf8'));
  for (const [path, expected] of Object.entries({ ...manifest.sources, [manifest.bundle.path]: manifest.bundle.sha256 })) {
    const actual = digest(await readFile(new URL(path, root)));
    if (actual !== expected) throw new Error(`Communications source drift: ${path}. Rebuild and review the generated function before making draft assets.`);
  }
  return manifest.bundle.sha256;
}

const reviewPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AXOM / welcome email draft</title><link rel="icon" href="orb.png" type="image/png">
<style>
:root{color-scheme:dark;font-family:Arial,Helvetica,sans-serif;background:#0d0d0e;color:#e6e2d6}*{box-sizing:border-box}body{margin:0}header{padding:52px max(24px,5vw) 38px;border-bottom:1px solid #353438;background:radial-gradient(circle at 88% 20%,#c8a96a20,transparent 40%)}.brand{display:flex;align-items:center;gap:14px;letter-spacing:.2em;font-size:13px}.brand img{width:44px;height:44px}.eyebrow{margin-top:42px;color:#c8a96a;font:11px 'Courier New',monospace;letter-spacing:.12em}h1{max-width:13ch;margin:14px 0;font-size:clamp(38px,6vw,72px);line-height:1.04;letter-spacing:-.05em;font-weight:400}p{max-width:68ch;color:#b2afa8;line-height:1.6}.badge{display:inline-block;margin-top:20px;padding:8px 12px;border:1px solid #7d6944;border-radius:99px;color:#d4b879;font:11px 'Courier New',monospace}.views{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:36px max(24px,5vw) 70px}.view{min-width:0}.view h2{font-size:15px;letter-spacing:.05em;font-weight:400}.view a,footer a{color:#e6e2d6;text-decoration-color:#c8a96a;text-underline-offset:4px}.frame{padding:10px;border:1px solid #353438;border-radius:22px;background:#151516}.frame iframe{display:block;width:100%;height:900px;border:0;border-radius:15px;background:#fff}footer{padding:24px max(24px,5vw) 40px;border-top:1px solid #353438;font-size:12px;color:#aaa69e}a:focus-visible{outline:2px solid #c8a96a;outline-offset:4px}@media(max-width:900px){.views{grid-template-columns:1fr}.frame iframe{height:780px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><header><div class="brand"><img src="orb.png" alt="AXOM Orb" width="44" height="44"><span>AXOM</span></div><div class="eyebrow">COMMUNICATIONS / ACCOUNT / 01</div><h1>A place of your own.</h1><p>A review of the real welcome-email renderer. Alex Morgan is a fictional fixture. The email uses AXOM’s Orb, clear first steps, and a static fallback if an inbox does not play its brief sheen.</p><span class="badge">LOCAL DRAFT · NO EMAIL SENT</span></header><main class="views"><section class="view"><h2>01 / DARK</h2><p><a href="welcome-dark.html">Open the email HTML</a></p><div class="frame"><iframe title="Dark welcome email draft" src="welcome-dark.html"></iframe></div></section><section class="view"><h2>02 / LIGHT</h2><p><a href="welcome-light.html">Open the email HTML</a></p><div class="frame"><iframe title="Light welcome email draft" src="welcome-light.html"></iframe></div></section></main><footer><a href="welcome.txt">Read the plain-text alternative</a> · These files are local visual drafts, not proof of inbox delivery or domain configuration.</footer></body></html>`;

export async function renderWelcomeDraft(output = defaultOutput) {
  const bundleHash = await verifyRenderer();
  await mkdir(output, { recursive: true });
  await copyFile(new URL('web/public/icons/axom-orb-512.png', root), new URL('orb.png', output));
  let plainText;
  let subject;
  for (const theme of ['dark', 'light']) {
    const rendered = renderAxomEmail({
      type: 'welcome',
      context: { displayName: 'Alex Morgan', accent: '#c8a96a', theme, locale: 'en', timezone: 'America/Grenada', orbUrl },
      baseUrl: 'https://axom.info',
    });
    if (!rendered.html.startsWith('<!doctype html>') || /<script\b/i.test(rendered.html)) throw new Error('Welcome draft is not static email HTML.');
    subject = rendered.subject;
    plainText ??= rendered.text;
    await writeFile(new URL(`welcome-${theme}.html`, output), rendered.html.replaceAll(orbUrl, 'orb.png'));
  }
  const resendDraft = renderAxomEmail({
    type: 'welcome',
    context: { displayName: 'there', accent: '#c8a96a', theme: 'dark', locale: 'en', timezone: 'America/Grenada', orbUrl },
    baseUrl: 'https://axom.info',
  });
  await writeFile(new URL('welcome-resend-draft.html', output), resendDraft.html);
  await writeFile(new URL('welcome.txt', output), `${plainText}\n`);
  await writeFile(new URL('index.html', output), reviewPage);
  await writeFile(new URL('README.md', output), `# AXOM welcome email draft\n\nLocal visual review only. No email was sent. Alex Morgan is fictional.\n\nSubject: ${subject}\n\nOpen \`index.html\` for dark and light views. \`welcome.txt\` is the plain-text alternative. \`welcome-resend-draft.html\` is the generic, hosted-Orb version for the Resend draft editor; its greeting is not personalized. All HTML comes from the canonical \`renderAxomEmail\` renderer in the generated communications bundle; its SHA-256 was \`${bundleHash}\`. The local Orb file replaces the hosted image URL only in the review copies. Re-run \`node scripts/render-welcome-draft.mjs\` after any renderer change. Inbox acceptance remains separate.\n`);
  return { path: fileURLToPath(output), subject, bundleHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await renderWelcomeDraft();
  process.stdout.write(`Welcome draft: ${result.path}index.html\n`);
}

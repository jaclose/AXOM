// Local review assets for a proposed product-update email. No delivery API is called.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderAxomEmail } from '../supabase/functions/communications/service.js';

const root = new URL('../', import.meta.url);
const output = new URL('../artifacts/communications/product-update-0.0.3-prebeta/', import.meta.url);
const orbUrl = 'https://axom.info/icons/axom-orb-512.png';
const release = '0.0.3-prebeta';

const editorial = {
  title: 'A clearer place for the work.',
  subject: 'AXOM 0.0.3-prebeta · A clearer place for the work',
  preview: 'Patch Notes, a calmer dashboard, Midnight, and direct course weeks.',
  excerpt: 'AXOM 0.0.3-prebeta is being prepared. Patch Notes will make changes easy to trace. A calmer dashboard and the Midnight palette give your study day more room to breathe, while course weeks open directly in the Question Bank. Community sharing will follow only after its live checks; your private study history stays yours.',
  cta: 'Read the change record',
  url: 'https://axom.info/#patch-notes',
};

const reviewPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AXOM / product update draft</title><link rel="icon" href="orb.png" type="image/png">
<style>
:root{color-scheme:dark;font-family:Arial,Helvetica,sans-serif;background:#0d0d0e;color:#e6e2d6}*{box-sizing:border-box}body{margin:0}header{padding:52px max(24px,5vw) 38px;border-bottom:1px solid #353438;background:radial-gradient(circle at 88% 20%,#c8a96a20,transparent 40%)}.brand{display:flex;align-items:center;gap:14px;letter-spacing:.2em;font-size:13px}.brand img{width:44px;height:44px}.eyebrow{margin-top:42px;color:#c8a96a;font:11px 'Courier New',monospace;letter-spacing:.12em}h1{max-width:15ch;margin:14px 0;font-size:clamp(38px,6vw,72px);line-height:1.04;letter-spacing:-.05em;font-weight:400}p{max-width:68ch;color:#b2afa8;line-height:1.6}.badge{display:inline-block;margin-top:20px;padding:8px 12px;border:1px solid #7d6944;border-radius:99px;color:#d4b879;font:11px 'Courier New',monospace}.views{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:36px max(24px,5vw) 70px}.view{min-width:0}.view h2{font-size:15px;letter-spacing:.05em;font-weight:400}.view a,footer a{color:#e6e2d6;text-decoration-color:#c8a96a;text-underline-offset:4px}.frame{padding:10px;border:1px solid #353438;border-radius:22px;background:#151516}.frame iframe{display:block;width:100%;height:850px;border:0;border-radius:15px;background:#fff}footer{padding:24px max(24px,5vw) 40px;border-top:1px solid #353438;font-size:12px;color:#aaa69e}a:focus-visible{outline:2px solid #c8a96a;outline-offset:4px}@media(max-width:900px){.views{grid-template-columns:1fr}.frame iframe{height:750px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><header><div class="brand"><img src="orb.png" alt="AXOM Orb" width="44" height="44"><span>AXOM</span></div><div class="eyebrow">COMMUNICATIONS / PRODUCT UPDATE / 01</div><h1>A clearer place for the work.</h1><p>A proposed early update for AXOM 0.0.3-prebeta, rendered from the same template as the app. This is local review material. The release and live delivery checks are still pending.</p><span class="badge">LOCAL DRAFT · NO EMAIL SENT</span></header><main class="views"><section class="view"><h2>01 / DARK</h2><p><a href="product-update-dark.html">Open the email HTML</a></p><div class="frame"><iframe title="Dark product update email draft" src="product-update-dark.html"></iframe></div></section><section class="view"><h2>02 / LIGHT</h2><p><a href="product-update-light.html">Open the email HTML</a></p><div class="frame"><iframe title="Light product update email draft" src="product-update-light.html"></iframe></div></section></main><footer><a href="product-update.txt">Read the plain-text alternative</a> · The hosted Orb and links in the Resend draft require release-day review. Consent, unsubscribe, and inbox acceptance remain separate checks.</footer></body></html>`;

async function verifyInputs() {
  const changelog = await readFile(new URL('CHANGELOG.md', root), 'utf8');
  if (!changelog.includes(`## ${release} —`) || !changelog.includes('**Patch Notes**') || !changelog.includes('**Question Bank**')) {
    throw new Error('Release notes changed; review the broadcast copy before rendering.');
  }
  const manifest = JSON.parse(await readFile(new URL('supabase/functions/communications/source-manifest.json', root), 'utf8'));
  for (const [path, expected] of Object.entries({ ...manifest.sources, [manifest.bundle.path]: manifest.bundle.sha256 })) {
    const actual = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    if (actual !== expected) throw new Error(`Communications source drift: ${path}. Rebuild and review the generated function.`);
  }
  return manifest.bundle.sha256;
}

export async function renderProductUpdateDraft() {
  const bundleHash = await verifyInputs();
  await mkdir(output, { recursive: true });
  await copyFile(new URL('web/public/icons/axom-orb-512.png', root), new URL('orb.png', output));
  let plainText;
  for (const theme of ['dark', 'light']) {
    const rendered = renderAxomEmail({
      type: 'product_update', editorial,
      context: { displayName: '', accent: '#c8a96a', theme, locale: 'en', timezone: 'America/Grenada', orbUrl },
      baseUrl: 'https://axom.info',
    });
    if (rendered.category !== 'product_updates' || rendered.subject !== editorial.subject ||
        !rendered.html.startsWith('<!doctype html>') || /<script\b/i.test(rendered.html) ||
        !rendered.html.includes('Manage preferences') || !rendered.html.includes('Unsubscribe')) {
      throw new Error('Product-update email failed its local safety checks.');
    }
    plainText ??= rendered.text;
    await writeFile(new URL(`product-update-${theme}.html`, output), rendered.html.replaceAll(orbUrl, 'orb.png'));
    if (theme === 'dark') await writeFile(new URL('product-update-resend-draft.html', output), rendered.html);
  }
  await writeFile(new URL('product-update.txt', output), `${plainText}\n`);
  await writeFile(new URL('index.html', output), reviewPage);
  await writeFile(new URL('README.md', output), `# AXOM product-update email draft\n\nLocal visual review only. No email was sent and no audience or campaign was created. This copy describes an in-progress pre-beta; review against the shipped release before any publication.\n\nSubject: ${editorial.subject}\nPreview: ${editorial.preview}\n\nOpen \`index.html\` for dark and light views. \`product-update.txt\` is the renderer's plain-text alternative. \`product-update-resend-draft.html\` retains hosted images and links for a later Resend draft. All email HTML comes from the canonical \`renderAxomEmail\` generated bundle, SHA-256 \`${bundleHash}\`. Local review copies use a local Orb image. Re-run \`node scripts/render-product-update-draft.mjs\` after changing release notes or the renderer. Before sending, verify the release is live, links, consent, unsubscribe handling, provider configuration, and inbox rendering.\n`);
  return { path: fileURLToPath(output), subject: editorial.subject, bundleHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await renderProductUpdateDraft();
  process.stdout.write(`Product-update draft: ${result.path}index.html\n`);
}

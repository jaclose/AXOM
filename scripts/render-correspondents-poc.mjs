// Generate all 25 AXOM Correspondents POCs from the canonical, testable renderer.
// No provider calls, no secrets and no account/journal data.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AXOM_CORRESPONDENTS, matchCorrespondent, renderCorrespondentIntroduction } from "../web/src/lib/communications/correspondents.ts";
const out = fileURLToPath(new URL("../artifacts/communications/correspondents/", import.meta.url));
await mkdir(out, { recursive: true });
const samples = [];
for (const card of AXOM_CORRESPONDENTS) {
  const match = matchCorrespondent({ userKey: "synthetic-demo-" + card.id, preferredId: card.id });
  const email = renderCorrespondentIntroduction(match, { displayName: "Alex", useCase: "welcome", poc: true });
  await writeFile(out + card.id + ".html", email.html);
  await writeFile(out + card.id + ".txt", email.text);
  samples.push({ id: card.id, name: card.name, description: card.description, html: card.id + ".html", text: card.id + ".txt", subject: email.subject });
}
const matched = matchCorrespondent({ userKey: "synthetic-visual-sample", selectedAccent: "#3D77B8", declaredStyles: ["visual", "systems"], journalOptIn: false });
const matchedEmail = renderCorrespondentIntroduction(matched, { displayName: "Alex", useCase: "welcome", poc: true });
await writeFile(out + "evidence-based-match.html", matchedEmail.html);
await writeFile(out + "evidence-based-match.txt", matchedEmail.text);
const esc = x => String(x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cards = samples.map(s => '<a class="person" href="' + esc(s.html) + '" target="preview"><strong>' + esc(s.name) + '</strong><small>' + esc(s.description) + '</small></a>').join("\n");
const gallery = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AXOM · 25 Correspondents</title><style>body{background:#0D0D0E;color:#E6E2D6;font:15px Arial,sans-serif;margin:0}header{padding:26px 32px;border-bottom:1px solid #363538}h1{font:normal 44px Georgia,serif;margin:4px 0 10px}p{color:#BBB6AD;line-height:1.6}main{display:grid;grid-template-columns:minmax(300px,410px) minmax(450px,1fr);gap:20px;padding:20px}nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:80vh;overflow:auto}.person{display:block;padding:14px;border:1px solid #353437;background:#1C1C1E;color:#E6E2D6;text-decoration:none}.person:hover,.person:focus{outline:1px solid #C8A96A}.person small{display:block;font-size:11px;color:#AAA69E;line-height:1.5;margin-top:8px}iframe{width:100%;height:80vh;border:1px solid #48433C;background:#0D0D0E}a.control{color:#C8A96A}@media(max-width:850px){main{display:block}nav{max-height:350px;margin-bottom:20px}iframe{height:70vh}}</style><header><div style="font-size:10px;color:#C8A96A;letter-spacing:3px">AXOM / CORRESPONDENCE ATLAS</div><h1>Twenty-five identities. One AXOM.</h1><p>Choose an identity to inspect the accessible email POC. These are synthetic, unsent visual proofs, not personality assessments. No Journal content was used.</p><a class="control" href="evidence-based-match.html" target="preview">Inspect evidence-based example</a></header><main><nav aria-label="25 correspondent previews">' + cards + '</nav><iframe name="preview" title="AXOM correspondent email preview" src="evidence-based-match.html"></iframe></main></html>';
await writeFile(out + "index.html", gallery);
await writeFile(out + "manifest.json", JSON.stringify({ status: "unsent-synthetic-poc", count: samples.length, design: "AXOM Identity Atlas v3", example: { id: matched.id, basis: matched.basis, reasons: matched.reasons }, samples }, null, 2) + "\n");
console.log("Rendered " + samples.length + " unsent AXOM Correspondents email POCs and one evidence-based example.");

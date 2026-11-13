import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { chromium } from "@playwright/test";

const zipPath = process.env.AXOM_BSCE_LOCAL_ZIP;
if (!zipPath) throw new Error("AXOM_BSCE_LOCAL_ZIP required");
const zip = await JSZip.loadAsync(readFileSync(zipPath));
const questionFile = Object.keys(zip.files).find(name => name.endsWith("/questions.json"));
if (!questionFile) throw new Error("Missing BSCE questions.json");
const body = JSON.parse(await zip.file(questionFile).async("string"));
const prefix = questionFile.slice(0, -("questions.json".length));
const assets = body.questions.flatMap(q => q.assets.map(a => ({ number: q.source.questionNumber, ...a })));
if (body.questions.length !== 49 || assets.length !== 12) throw new Error("Unexpected corpus count");
const candidates = [];
for (const asset of assets) {
  const file = zip.file(prefix + "assets/" + asset.filename);
  if (!file) throw new Error("Missing " + asset.filename);
  const bytes = await file.async("nodebuffer");
  const hash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  if (hash !== asset.checksum || bytes.length !== asset.byteSize) throw new Error("Checksum/size mismatch " + asset.filename);
  candidates.push({ name: asset.filename, number: asset.number, width: asset.width, height: asset.height, base64: bytes.toString("base64") });
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const decoded = await page.evaluate(async (images) => {
    const checks = [];
    for (const image of images) {
      const raw = atob(image.base64);
      const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      const actual = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (actual.width !== image.width || actual.height !== image.height) throw new Error("Bitmap size mismatch " + image.name);
      const url = URL.createObjectURL(blob);
      try {
        const element = new Image();
        element.src = url;
        await element.decode();
        if (element.naturalWidth !== image.width || element.naturalHeight !== image.height) throw new Error("HTMLImageElement size mismatch " + image.name);
      } finally { URL.revokeObjectURL(url); }
      checks.push({ q: image.number, name: image.name, ...actual });
    }
    return checks;
  }, candidates);
  if (decoded.length !== 12) throw new Error("Wrong decoded image count");
  process.stdout.write(JSON.stringify({ ok: true, images: decoded }, null, 2) + "\n");
} finally {
  await browser.close();
}

// Run with Node 22: node src/lib/question-content/operations/pptxSlides.verify.mjs
// Synthetic-only self-test; never imports private medical content.
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createServer } from "vite";
import { pptxSlideText, extractPptxSlides } from "./pptxSlides.mjs";

const para = text => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;
const slide = [
  para("Which clinical measurement best fits this vignette?"),
  para("a."), para("Serum sodium 140"),
  para("b."), para("Serum potassium 3.2"),
  para("c."), para("Serum calcium 9.0"),
].join("");
const text = pptxSlideText(slide);
assert.match(text, /^Which clinical measurement/);
assert.match(text, /^A\. Serum sodium 140$/m);
assert.match(text, /^B\. Serum potassium 3\.2$/m);
assert.match(text, /^C\. Serum calcium 9\.0$/m);
assert.equal(pptxSlideText(para("Only title slide")), "Only title slide");
assert.match(pptxSlideText(para("A &amp; B; clinically &lt; 2")), /A & B; clinically < 2/);
const nineChoices = [..."ABCDEFGHI"].map(label => `${para(`${label}.`)}${para(`Sample choice ${label}`)}`).join("");
assert.equal(pptxSlideText(para("Choose the supplied sample.") + nineChoices),
  ["Choose the supplied sample.", ...[..."ABCDEFGHI"].map(label => `${label}. Sample choice ${label}`)].join("\n"));

const archive = new JSZip();
archive.file("ppt/slides/slide1.xml", slide);
archive.file("ppt/slides/slide2.xml", para("Title of the next slide"));
archive.file("ppt/notesSlides/notesSlide1.xml", para("Explanatory speaker note; not accepted as an answer key."));
archive.file("ppt/media/figure.png", new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]));
const bytes = new Uint8Array(await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
const vite = await createServer({ server: {middlewareMode:true, hmr:false}, appType: "custom" });
try {
  const { indexLibraryZip } = await vite.ssrLoadModule("/src/lib/privateLibrary/zipIndex.ts");
  const { readZipEntry } = await vite.ssrLoadModule("/src/lib/privateLibrary/fileInput.ts");
  const result = await extractPptxSlides(bytes, { indexLibraryZip, readZipEntry });
  assert.equal(result.slides, 2);
  assert.equal(result.embeddedMediaFiles, 1);
  assert.equal(result.noteSlidesWithText, 1);
  assert.ok(result.pages[0].text.includes("B. Serum potassium 3.2"));
  assert.equal(result.pages[1].text, "Title of the next slide");
  console.log("PPTX_SELFTEST_PASS", JSON.stringify({
    slides: result.slides, linkedMediaStillInOriginal: result.embeddedMediaFiles,
    speakerNotesHeld: result.noteSlidesWithText, testUsesSyntheticDataOnly: true,
  }));
} finally {
  await vite.close();
}

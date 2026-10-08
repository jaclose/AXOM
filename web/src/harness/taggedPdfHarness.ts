// Development only. Builds a small tagged PDF from invented content, takes it
// through the browser import, and writes what came out where a test can read
// it. It proves the one thing a unit test cannot: that the pictures a
// question names are really drawn from the page.
import { inventedQuestionPdf } from "../lib/question-content/pdf/buildTaggedPdf.testing";
import { taggedPdfFileToQuestions } from "../lib/question-content/pdf/taggedPdfInBrowser";

const out = document.getElementById("result")!;

/** A picture's size as the browser decodes it, and how many of its pixels are dark. */
async function measure(file: File): Promise<{ name: string; bytes: number; width: number; height: number; inked: number }> {
  const image = new Image();
  image.alt = file.name;
  image.src = URL.createObjectURL(file);
  await image.decode();
  document.body.append(image);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let inked = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] > 0 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 384) inked += 1;
  }
  return { name: file.name, bytes: file.size, width: image.naturalWidth, height: image.naturalHeight, inked };
}

async function run(): Promise<void> {
  const bytes = inventedQuestionPdf();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await taggedPdfFileToQuestions(buffer, { bankId: "invented-bank", sourceFilename: "invented.pdf" });
  if (!result.tagged) {
    out.textContent = JSON.stringify({ tagged: false });
    out.dataset.done = "true";
    return;
  }
  const pictures = [];
  for (const file of result.files) pictures.push(await measure(file));
  out.textContent = JSON.stringify({
    tagged: true,
    slides: result.slides,
    creator: result.creator,
    questions: result.questions.map((question) => ({
      id: question.id,
      stem: question.stem.map((block) => block.type),
      choices: question.choices.length,
      key: question.correctAnswer?.labels,
      assets: question.assets.map((asset) => ({ filename: asset.filename, role: asset.role, mimeType: asset.mimeType, width: asset.width, height: asset.height, byteSize: asset.byteSize, hasChecksum: Boolean(asset.checksum) })),
    })),
    pictures,
    warnings: result.warnings,
  }, null, 1);
  out.dataset.done = "true";
}

run().catch((error: unknown) => {
  out.textContent = `failed: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`;
  out.dataset.done = "error";
});

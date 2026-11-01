// Strict read-only PowerPoint/Show archive inspection for local academic
// triage. XML shape order is not necessarily visual order: no answer evidence
// is accepted and full source/notes/figures require manual review.
import JSZip from "jszip";

const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_SLIDES = 500;
const MAX_TEXT = 8_000_000;
const decodeXmlEntities = value => value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos);/gi, (_whole, key) => {
  if (key === "amp") return "&";
  if (key === "lt") return "<";
  if (key === "gt") return ">";
  if (key === "quot") return '"';
  if (key === "apos") return "'";
  if (key.startsWith("#")) {
    const hex = key[1].toLowerCase() === "x";
    const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff &&
        (code < 0xd800 || code > 0xdfff)) return String.fromCodePoint(code);
  }
  return "\uFFFD";
});
export function pptxSlideText(xml) {
  // Preserve real OpenXML paragraph boundaries while joining runs in one
  // paragraph. A fragmented Greek or medical word must not become new lines.
  const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
    .map(match => [...match[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map(piece => decodeXmlEntities(piece[1])).join("").trim());
  const lines = (paragraphs.length ? paragraphs : [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map(match => decodeXmlEntities(match[1]).trim())).filter(Boolean);
  const options = lines.filter(line => /^\s*\(?[A-Ia-i]\)?[.):]\s*(?:\S|$)/.test(line)).length;
  if (options < 2) return lines.join("\n");
  const collected = [];
  let choice = null;
  for (const line of lines) {
    const label = /^\s*\(?([A-Ia-i])\)?[.):]\s*(.*)$/.exec(line);
    if (label) {
      if (choice) collected.push(choice);
      choice = label[1].toUpperCase() + ". " + label[2].trim();
    } else if (choice) {
      choice += (choice.endsWith(". ") || (line.startsWith("-") && /[\p{L}\p{N}]$/u.test(choice)) ? "" : " ") + line;
    } else collected.push(line);
  }
  if (choice) collected.push(choice);
  return collected.join("\n").replace(/\n{4,}/g, "\n\n").trim();
}

export async function extractPptxSlides(buffer, services) {
  // Existing indexed ZIP parser validates central/local headers, CRC claims,
  // duplicate/case-colliding/traversal paths and per-entry declared length.
  const entries = services.indexLibraryZip(buffer, { allowRaw: true });
  const expanded = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  if (expanded > MAX_EXPANDED) throw new Error("PowerPoint expands beyond the local 256 MB memory budget. Split slides or export a smaller PDF.");
  const slides = entries.filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.path))
    .sort((a, b) => Number(a.path.match(/slide(\d+)/)[1]) - Number(b.path.match(/slide(\d+)/)[1]));
  if (!slides.length || slides.length > MAX_SLIDES) {
    throw new Error(`PowerPoint has ${slides.length} readable slides; expected 1–${MAX_SLIDES}. Preserve the original and convert in smaller sections.`);
  }
  const notes = entries.filter(entry => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.path));
  const images = entries.filter(entry => /^ppt\/media\//.test(entry.path));
  const zip = await JSZip.loadAsync(buffer);
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  let processedBytes = 0;
  const read = async path => {
    const entry = byPath.get(path);
    if (!entry) return "";
    const item = zip.file(entry.archivePath);
    if (!item || (item.unsafeOriginalName ?? item.name) !== entry.archivePath)
      throw new Error("PowerPoint entry path changed after validation.");
    const source = await services.readZipEntry(item, entry.byteSize, entry.crc32, count => {
      processedBytes += count;
      if (processedBytes > MAX_EXPANDED) throw new Error("PowerPoint decompression budget exceeded.");
    });
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  };
  const pages = [];
  let totalText = 0, notesWithText = 0;
  for (const slide of slides) {
    const number = Number(slide.path.match(/slide(\d+)/)[1]);
    const text = pptxSlideText(await read(slide.path));
    totalText += text.length;
    if (totalText > MAX_TEXT) throw new Error("Slide text exceeds the safe 8 million character limit.");
    const notesText = pptxSlideText(await read(`ppt/notesSlides/notesSlide${number}.xml`));
    if (notesText.trim()) notesWithText++;
    pages.push({ number, text, notesPresent: Boolean(notesText.trim()) });
  }
  return {
    pages,
    slides: pages.length,
    embeddedMediaFiles: images.length,
    noteSlides: notes.length,
    noteSlidesWithText: notesWithText,
    warnings: [
      "PowerPoint slide text was extracted from source OOXML but shape reading order is not visually verified.",
      images.length ? `${images.length} original PowerPoint media files remain within the preserved source. They have not been mapped to question/answer figures.` : "",
      notesWithText ? `${notesWithText} speaker-note slides contain text (possible answers). Notes remain in the original and were not trusted as question keys.` : "",
      "An original PPTX/PPSX should be visually checked against each extracted question before finalization.",
    ].filter(Boolean),
  };
}

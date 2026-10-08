#!/usr/bin/env node
// Builds the files of the question bank import work that are not written by
// hand: the DOCX import template and the pictures of the invented bank.
//
//   node scripts/qbank/build-fixtures.mjs
//
// Everything drawn or written here is invented. No course material is read.
// The committed files are the reference: run this only to change them, then
// update the checksums in fixtures/qbank/synthetic/multimodal-shapes/questions.json
// (the script prints them).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JSZip = createRequire(join(root, "web", "package.json"))("jszip");

// --- a small PNG writer -------------------------------------------------------

const INK = [28, 32, 44];
const PAPER = [255, 255, 255];
const BLUE = [38, 98, 196];
const RED = [196, 58, 48];
const GREY = [150, 156, 168];
const MARK = [255, 221, 87];

class Canvas {
  constructor(width, height, background = PAPER) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
    this.rect(0, 0, width, height, background);
  }
  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = (Math.round(y) * this.width + Math.round(x)) * 3;
    this.pixels[at] = r;
    this.pixels[at + 1] = g;
    this.pixels[at + 2] = b;
  }
  rect(x, y, width, height, colour) {
    for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) this.set(column, row, colour);
  }
  line(x0, y0, x1, y1, colour, weight = 2) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = x0 + ((x1 - x0) * step) / steps;
      const y = y0 + ((y1 - y0) * step) / steps;
      this.rect(Math.round(x), Math.round(y), weight, weight, colour);
    }
  }
  curve(points, colour, weight = 3) {
    for (let index = 1; index < points.length; index += 1) this.line(...points[index - 1], ...points[index], colour, weight);
  }
  disc(cx, cy, radius, colour, keep = () => true) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= radius * radius && keep(x, y)) this.set(cx + x, cy + y, colour);
    }
  }
  ring(cx, cy, radius, colour, weight = 3) {
    this.disc(cx, cy, radius, colour, (x, y) => x * x + y * y >= (radius - weight) * (radius - weight));
  }
  png() {
    const stride = this.width * 3 + 1;
    const raw = Buffer.alloc(stride * this.height);
    for (let row = 0; row < this.height; row += 1) this.pixels.copy(raw, row * stride + 1, row * this.width * 3, (row + 1) * this.width * 3);
    const chunk = (type, data) => {
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const check = Buffer.alloc(4);
      check.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([length, body, check]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

// --- the invented pictures ----------------------------------------------------

function graph({ reveal }) {
  const canvas = new Canvas(480, 320);
  const falling = Array.from({ length: 40 }, (_, step) => [70 + step * 9, Math.round(60 + 190 * (1 - Math.exp(-step / 9)))]);
  const flat = Array.from({ length: 40 }, (_, step) => [70 + step * 9, Math.round(250 - 150 * (1 - Math.exp(-step / 5)))]);
  // The answer-marked copy differs from the clean one by this highlight only.
  if (reveal) canvas.rect(330, 84, 110, 44, MARK);
  canvas.line(60, 30, 60, 262, INK);
  canvas.line(60, 262, 450, 262, INK);
  for (let tick = 0; tick < 6; tick += 1) canvas.line(60 + tick * 72, 262, 60 + tick * 72, 270, INK);
  canvas.curve(falling, BLUE);
  canvas.curve(flat, RED);
  canvas.disc(352, 106, 7, RED);
  canvas.disc(352, 222, 7, BLUE);
  return canvas;
}

function micrograph() {
  const canvas = new Canvas(400, 300, [244, 226, 236]);
  let seed = 20261008;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let cell = 0; cell < 90; cell += 1) {
    const x = Math.round(next() * 400);
    const y = Math.round(next() * 300);
    const size = 8 + Math.round(next() * 14);
    canvas.disc(x, y, size, [222, 150, 190]);
    canvas.disc(x + 2, y - 1, Math.max(3, Math.round(size / 3)), [92, 46, 130]);
  }
  return canvas;
}

function field({ shaded }) {
  const canvas = new Canvas(240, 240);
  canvas.disc(120, 120, 96, GREY, (x) => (shaded === "left" ? x < 0 : x >= 0));
  canvas.ring(120, 120, 98, INK);
  canvas.line(120, 22, 120, 218, INK, 1);
  canvas.line(22, 120, 218, 120, INK, 1);
  return canvas;
}

const pictures = {
  "syn-q03-curves.png": graph({ reveal: false }),
  "syn-q03-curves-answer.png": graph({ reveal: true }),
  "syn-q04-micrograph.png": micrograph(),
  "syn-q07-field-left.png": field({ shaded: "left" }),
  "syn-q07-field-right.png": field({ shaded: "right" }),
};

// --- the DOCX template --------------------------------------------------------

const escapeXml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const paragraph = (text, { bold = false, size = 22, shade = false } = {}) =>
  `<w:p>${shade ? '<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="EEF1F6"/></w:pPr>' : ""}<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

const marker = (name) => paragraph(`[${name}]`, { bold: true, shade: true });

const border = (side) => `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="7A8194"/>`;

const table = (rows) => {
  const width = Math.floor(8400 / rows[0].length);
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="8400" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${rows[0].map(() => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows.map((row) => `<w:tr>${row.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;
};

const picture = (relationship, id, description, width, height) => {
  const cx = width * 6350; // 1 px at 150 px per inch, in EMU
  const cy = height * 6350;
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${escapeXml(description)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(description)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
};

const meta = ["Course: GOER", "Term: 5", "Week: 2", "Bank: Example bank", "Discipline: Example discipline", "Topic: Example topic", "Source: example-source.pdf"];

const body = [
  paragraph("AXOM question bank import template", { bold: true, size: 36 }),
  paragraph("Write one question after another. AXOM reads the words in square brackets and the order of what follows them. It does not read fonts, colours or heading styles, so the page can look however you like."),
  paragraph("How to fill it in", { bold: true, size: 26 }),
  paragraph("1. Put each marker alone on its own line, written as it is here, with its capitals and brackets."),
  paragraph("2. Tables must be real Word tables. Pictures must be placed in the document, not linked to."),
  paragraph("3. Type the choice letters yourself (A. B. C.). Do not use Word's automatic lettering: those letters are not in the text."),
  paragraph("4. Keep the wording, units and numbers of the source as they are. If the source looks wrong, leave it and say so under the FLAGS marker."),
  paragraph("5. The TABLE and IMAGE markers say that a table or a picture comes next. AXOM tells you when it does not."),
  paragraph("6. A copy of a picture with the answer marked on it goes under the marker written as IMAGE: answer reveal, in brackets. AXOM keeps it out of sight until the question has been answered."),
  paragraph("7. Anything outside a question, such as this page, is ignored."),
  paragraph("Example 1: text, a table, a picture, then the prompt", { bold: true, size: 26 }),
  paragraph("QUESTION 1", { bold: true }),
  marker("AXOM META"),
  ...meta.map((line) => paragraph(line)),
  marker("STEM"),
  paragraph("A research team gives a new compound to 6 healthy volunteers and measures its level in plasma at set times."),
  marker("TABLE"),
  table([["Time after dose (h)", "Plasma level (mg/L)"], ["1", "8.0"], ["2", "4.0"], ["3", "2.0"]]),
  marker("STEM CONTINUED"),
  paragraph("The curves below show the level over time for this compound and for a second one."),
  marker("IMAGE"),
  picture("rId1", 1, "Two curves of plasma level against time", 480, 320),
  marker("STEM CONTINUED"),
  paragraph("Which of the following is the half-life of the compound in the table?"),
  marker("CHOICES"),
  ...["A. 0.5 h", "B. 1 h", "C. 2 h", "D. 4 h", "E. 8 h"].map((line) => paragraph(line)),
  marker("ANSWER"),
  paragraph("B"),
  marker("EXPLANATION"),
  paragraph("The level halves every hour: 8.0, then 4.0, then 2.0 mg/L."),
  marker("SOURCE"),
  paragraph("File: example-source.pdf"),
  paragraph("Page: 3"),
  marker("FLAGS"),
  paragraph("source_inconsistency: The stem says 6 volunteers and the answer page of the source says 8. Left as written."),
  marker("END QUESTION"),
  paragraph("Example 2: the answer choices are a table", { bold: true, size: 26 }),
  paragraph("QUESTION 2", { bold: true }),
  marker("AXOM META"),
  ...meta.map((line) => paragraph(line)),
  marker("STEM"),
  paragraph("A gland stops responding to the signal from the pituitary. Which row shows the pattern that follows?"),
  marker("CHOICES"),
  marker("TABLE"),
  table([["", "Pituitary signal", "Gland hormone"], ["A", "↑", "↑"], ["B", "↑", "↓"], ["C", "↓", "↑"], ["D", "↓", "↓"]]),
  marker("ANSWER"),
  paragraph("B"),
  marker("EXPLANATION"),
  paragraph("The gland makes less hormone, so the pituitary signal rises."),
  marker("SOURCE"),
  paragraph("File: example-source.pdf"),
  paragraph("Page: 4"),
  marker("END QUESTION"),
];

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;

// --- write --------------------------------------------------------------------

const assetsDirectory = join(root, "fixtures", "qbank", "synthetic", "multimodal-shapes", "assets");
mkdirSync(assetsDirectory, { recursive: true });
for (const [name, canvas] of Object.entries(pictures)) {
  const bytes = canvas.png();
  writeFileSync(join(assetsDirectory, name), bytes);
  console.log(`${name}  ${canvas.width}x${canvas.height}  ${bytes.length} bytes  sha256:${createHash("sha256").update(bytes).digest("hex")}`);
}

const zip = new JSZip();
const fixed = { date: new Date("2026-10-08T00:00:00Z") }; // so a rebuild does not change the file for no reason
zip.file("[Content_Types].xml", contentTypes, fixed);
zip.file("_rels/.rels", packageRels, fixed);
zip.file("word/document.xml", documentXml, fixed);
zip.file("word/_rels/document.xml.rels", documentRels, fixed);
zip.file("word/media/image1.png", pictures["syn-q03-curves.png"].png(), fixed);
const templatePath = join(root, "docs", "templates", "AXOM_QBANK_IMPORT_TEMPLATE.docx");
mkdirSync(dirname(templatePath), { recursive: true });
writeFileSync(templatePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
console.log(`template  ${templatePath}`);

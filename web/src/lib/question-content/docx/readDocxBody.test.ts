import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx, cell, drawing, imageRelationship, p, paragraph, row, run, table, TINY_PNG } from "./buildDocx.testing";
import type { DocxBodyElement } from "./markers";
import { readEquation } from "./omml";
import { readDocxBody } from "./readDocxBody";
import { parseXml } from "./xml";
import { crc32, openZip, ZipError } from "./zip";

// vitest runs from the web/ package root.
const repository = join(process.cwd(), "..");
const fixture = (name: string): Uint8Array => readFileSync(join(repository, "fixtures", "qbank", "synthetic", "docx", name));
const template = (): Uint8Array => readFileSync(join(repository, "docs", "templates", "AXOM_QBANK_IMPORT_TEMPLATE.docx"));

const read = async (body: string, parts = {}) => readDocxBody(await buildDocx(body, parts));
const texts = (elements: readonly DocxBodyElement[]): string[] => elements.flatMap((element) => (element.kind === "paragraph" && element.text.trim() ? [element.text] : []));
const kinds = (elements: readonly DocxBodyElement[]): string => elements.filter((element) => element.kind !== "paragraph" || element.text.trim()).map((element) => element.kind[0]).join("");
const codes = (issues: { severity: string; code: string }[]): string[] => issues.map((issue) => `${issue.severity}:${issue.code}`);

describe("reading the ZIP container", () => {
  it("returns every file exactly as a mature ZIP library does", async () => {
    for (const bytes of [template(), fixture("word-saved-template.docx"), fixture("pandoc-marked.docx")]) {
      const ours = await openZip(bytes);
      const theirs = await JSZip.loadAsync(bytes);
      const names = Object.values(theirs.files).filter((file) => !file.dir).map((file) => file.name).sort();
      expect(ours.entries.map((entry) => entry.name).filter((name) => !name.endsWith("/")).sort()).toEqual(names);
      for (const name of names) expect(await ours.bytes(name), name).toEqual(await theirs.file(name)!.async("uint8array"));
    }
  });

  it("reads files that are stored without compression", async () => {
    const zip = new JSZip();
    zip.file("a.txt", "plain", { compression: "STORE" });
    const archive = await openZip(await zip.generateAsync({ type: "uint8array" }));
    expect(await archive.text("a.txt")).toBe("plain");
    expect(await archive.bytes("missing.txt")).toBeUndefined();
  });

  it("refuses what is not a ZIP, and reports damage instead of returning wrong bytes", async () => {
    await expect(openZip(new TextEncoder().encode("this is not a document at all, just some words"))).rejects.toMatchObject({ reason: "not-a-zip" });
    const bytes = template().slice();
    const archive = await openZip(bytes);
    const victim = archive.entries.find((entry) => entry.name === "word/document.xml")!;
    // Flip a byte in the middle of the packed document.
    const at = bytes.indexOf(0x50, 0) + 60 + Math.floor(victim.compressedSize / 2);
    bytes[at] ^= 0xff;
    await expect((await openZip(bytes)).bytes("word/document.xml")).rejects.toBeInstanceOf(Error);
  });

  it("will not inflate a file past the size its entry declares", async () => {
    const zip = new JSZip();
    zip.file("big.txt", "x".repeat(200_000));
    const archive = await openZip(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), { maxEntryBytes: 1000 });
    await expect(archive.bytes("big.txt")).rejects.toMatchObject({ reason: "too-large" });
    expect(new ZipError("corrupt", "x")).toBeInstanceOf(Error);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("reading XML", () => {
  it("matches elements by namespace, whatever prefix the writer chose", () => {
    const root = parseXml('<?xml version="1.0"?><x:doc xmlns:x="urn:one" xmlns="urn:default"><x:a x:v="1" plain="2">t &amp; &#x3bc; &lt;</x:a><b/><!-- c --></x:doc>');
    expect(root).toMatchObject({ ns: "urn:one", name: "doc" });
    const [a, b] = root.children.filter((node) => typeof node !== "string");
    expect(a).toMatchObject({ ns: "urn:one", name: "a", children: ["t & μ <"] });
    expect([...(a as { attributes: Map<string, string> }).attributes]).toEqual([["urn:one|v", "1"], ["|plain", "2"]]);
    expect(b).toMatchObject({ ns: "urn:default", name: "b" });
  });

  it("refuses a DTD and damaged markup", () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toThrow(/DTD/);
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(() => parseXml("<a>")).toThrow();
  });
});

describe("reading Word equations", () => {
  const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
  const equation = (inner: string) => readEquation(parseXml(`<m:oMath ${M}>${inner}</m:oMath>`));
  const r = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;

  it("writes fractions, powers, indices, roots, sums and brackets as LaTeX and as plain text", () => {
    expect(equation(`${r("RR=")}<m:f><m:num>${r("40/200")}</m:num><m:den>${r("30/300")}</m:den></m:f>`)).toEqual({ latex: "RR=\\frac{40/200}{30/300}", plainText: "RR=(40/200)/(30/300)" });
    expect(equation(`<m:sSup><m:e>${r("x")}</m:e><m:sup>${r("2")}</m:sup></m:sSup>`)).toEqual({ latex: "{x}^{2}", plainText: "x^2" });
    expect(equation(`<m:sSub><m:e>${r("t")}</m:e><m:sub>${r("1/2")}</m:sub></m:sSub>`)).toEqual({ latex: "{t}_{1/2}", plainText: "t_(1/2)" });
    expect(equation(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r("4")}</m:e></m:rad>`)).toEqual({ latex: "\\sqrt{4}", plainText: "√(4)" });
    expect(equation(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r("i=1")}</m:sub><m:sup>${r("n")}</m:sup><m:e>${r("x")}</m:e></m:nary>`))
      .toEqual({ latex: "\\sum_{i=1}^{n}{x}", plainText: "∑_(i=1)^n x" });
    expect(equation(`<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${r("a")}</m:e></m:d>`)).toEqual({ latex: "\\left[a\\right]", plainText: "[a]" });
  });

  it("keeps the text of a construct it has no rule for", () => {
    expect(equation(`<m:phant><m:e>${r("kept")}</m:e></m:phant>${r(" 50%")}`)).toEqual({ latex: "kept 50\\%", plainText: "kept 50%" });
  });
});

describe("walking a document that real producers wrote", () => {
  it("reads the template the same way whether AXOM built the file or Word saved it", async () => {
    const built = await readDocxBody(template());
    const saved = await readDocxBody(fixture("word-saved-template.docx"));
    expect(built.issues).toEqual([]);
    expect(saved.issues).toEqual([]);
    expect(texts(saved.elements)).toEqual(texts(built.elements));
    expect(saved.elements.filter((element) => element.kind === "table")).toEqual(built.elements.filter((element) => element.kind === "table"));
    expect(kinds(saved.elements)).toBe(kinds(built.elements));
    expect([...saved.media.values()].map((bytes) => bytes.length)).toEqual([...built.media.values()].map((bytes) => bytes.length));
  });

  it("keeps a table and a picture where the document has them", async () => {
    const { elements, media } = await readDocxBody(template());
    const from = elements.findIndex((element) => element.kind === "paragraph" && element.text === "[STEM]");
    const until = elements.findIndex((element) => element.kind === "paragraph" && element.text === "[CHOICES]");
    expect(kinds(elements.slice(from, until))).toBe("ppptpppipp");
    expect(elements.find((element) => element.kind === "table")).toEqual({ kind: "table", rows: [["Time after dose (h)", "Plasma level (mg/L)"], ["1", "8.0"], ["2", "4.0"], ["3", "2.0"]] });
    const picture = elements.find((element) => element.kind === "image")!;
    expect(picture).toEqual({ kind: "image", target: "word/media/image1.png", alt: "Two curves of plasma level against time", width: 320, height: 213 });
    expect([...media.get("word/media/image1.png")!.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it("reads what pandoc wrote: Word's own lettering, sub and superscripts, merged cells, equations", async () => {
    const { elements, issues } = await readDocxBody(fixture("pandoc-marked.docx"));
    expect(issues).toEqual([]);
    expect(elements).toContainEqual({
      kind: "paragraph",
      text: "A volunteer’s Na+ and HCO3− are measured. The half-life is t_(1/2) and not the clearance.",
      html: "A volunteer’s Na<sup>+</sup> and HCO<sub>3</sub><sup>−</sup> are measured. The half-life is t_(1/2) and <b>not</b> the clearance.",
    });
    expect(elements).toContainEqual({
      kind: "table",
      rows: [["Test", "Result", ""], ["Marker A", "12.0", "mg/dL"], ["Marker B", "0.2 μU/mL", ""]],
      headerRows: 1,
      merges: [{ row: 0, column: 1, rowSpan: 1, columnSpan: 2 }, { row: 2, column: 1, rowSpan: 1, columnSpan: 2 }],
    });
    expect(elements).toContainEqual({ kind: "equation", plainText: "RR=(40/200)/(30/300)=2.0", latex: "RR=\\frac{40/200}{30/300}=2.0" });
    // The letters A, B, C are Word's automatic lettering: they are in no run of text.
    expect(elements.filter((element) => element.kind === "paragraph" && element.listLabel)).toEqual([
      { kind: "paragraph", text: "0.5", listLabel: "A.", listKind: "ordered" },
      { kind: "paragraph", text: "2.0", emphasis: { bold: true }, listLabel: "B.", listKind: "ordered" },
      { kind: "paragraph", text: "4.0 ↑", listLabel: "C.", listKind: "ordered" },
    ]);
    expect(elements.filter((element) => element.kind === "paragraph" && element.caption).map((element) => (element as { text: string }).text))
      .toEqual(["Two curves of level against time", "The same curves with one marked"]);
  });
});

describe("walking the constructs a faculty file can hold", () => {
  it("reads tracked changes as accepted and says so", async () => {
    const { elements, issues } = await read(paragraph(`${run("kept ")}<w:ins>${run("added")}</w:ins><w:del><w:r><w:delText>gone</w:delText></w:r></w:del>`));
    expect(texts(elements)).toEqual(["kept added"]);
    expect(codes(issues)).toEqual(["info:tracked_changes"]);
  });

  it("reads through links, content controls and fields, and leaves field codes out", async () => {
    const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run("3") + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const { elements } = await read(
      paragraph(`${run("see ")}<w:hyperlink r:id="rId9">${run("the source", '<w:color w:val="0563C1"/><w:u w:val="single"/>')}</w:hyperlink>${run(" page ")}${field}`)
      + `<w:sdt><w:sdtContent>${p("inside a content control")}</w:sdtContent></w:sdt>`,
    );
    expect(elements).toEqual([{ kind: "paragraph", text: "see the source page 3" }, { kind: "paragraph", text: "inside a content control" }]);
  });

  it("reads a text box once when the file holds it in a new form and an old one", async () => {
    const box = `<w:txbxContent>${p("boxed words")}</w:txbxContent>`;
    const { elements } = await read(paragraph(`${run("before")}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx>${box}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>${box}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`));
    expect(texts(elements)).toEqual(["before", "boxed words"]);
  });

  it("reads the glyph a symbol font draws, so μg does not become mg and an arrow is not lost", async () => {
    const symbolFont = '<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>';
    const { elements, issues } = await read(
      paragraph(`${run("5 ")}${run("m", symbolFont)}${run("g ")}<w:r><w:sym w:font="Symbol" w:char="F0AD"/></w:r><w:r><w:sym w:font="Wingdings" w:char="F0E2"/></w:r>${run(" \uf0b1", symbolFont)}`)
      + paragraph('<w:r><w:sym w:font="Wingdings" w:char="F021"/></w:r>'),
    );
    expect(texts(elements)).toEqual(["5 μg ↑↓ ±", "\uFFFD"]);
    expect(codes(issues)).toEqual(["warning:unsupported_content"]);
  });

  it("leaves hidden text out and says so", async () => {
    const { elements, issues } = await read(paragraph(`${run("shown")}${run(" answer is B", "<w:vanish/>")}`));
    expect(texts(elements)).toEqual(["shown"]);
    expect(codes(issues)).toEqual(["info:unsupported_content"]);
  });

  it("tells formatting on a whole paragraph from a marked word inside one", async () => {
    const { elements } = await read(paragraph(run("all bold", "<w:b/>"), "") + paragraph(`${run("which is ")}${run("not", "<w:b/><w:u w:val=\"single\"/>")}${run(" true &lt; 5")}`) + paragraph(run("shaded"), '<w:shd w:val="clear" w:fill="FFFF00"/>'));
    expect(elements).toEqual([
      { kind: "paragraph", text: "all bold", emphasis: { bold: true } },
      { kind: "paragraph", text: "which is not true < 5", html: "which is <b><u>not</u></b> true &lt; 5" },
      { kind: "paragraph", text: "shaded", emphasis: { highlight: true } },
    ]);
  });

  it("numbers and letters lists as Word draws them, from the list or from the paragraph's style", async () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
      <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
    const styles = '<w:style w:type="paragraph" w:styleId="Choice"><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr></w:style>';
    const item = (text: string, numId: number, level = 0) => paragraph(run(text), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`);
    const { elements } = await read(
      item("one", 1) + item("two", 1) + item("deeper", 1, 1) + item("three", 1) + item("dot", 2) + paragraph(run("styled"), '<w:pStyle w:val="Choice"/>') + paragraph(run("styled again"), '<w:pStyle w:val="Choice"/>') + paragraph(run("off"), '<w:pStyle w:val="Choice"/><w:numPr><w:numId w:val="0"/></w:numPr>'),
      { numbering, styles },
    );
    expect(elements.map((element) => (element.kind === "paragraph" ? [element.listLabel, element.listKind, element.text] : []))).toEqual([
      ["(a)", "ordered", "one"], ["(b)", "ordered", "two"], ["b.i", "ordered", "deeper"], ["(c)", "ordered", "three"], ["•", "bullet", "dot"],
      ["(a)", "ordered", "styled"], ["(b)", "ordered", "styled again"], [undefined, undefined, "off"],
    ]);
  });

  it("keeps cell boundaries through merged cells, both across and down", async () => {
    const { elements } = await read(table(
      row(cell(p("Hormone"), '<w:vMerge w:val="restart"/>') + cell(p("Serum"), '<w:gridSpan w:val="2"/>'), "<w:tblHeader/>")
      + row(cell(p(""), "<w:vMerge/>") + cell(p("Before")) + cell(p("After")))
      + row(cell(p("TSH")) + cell(paragraph(`${run("0.2 ")}${run("2", '<w:vertAlign w:val="superscript"/>')}`)) + cell(p("4.1")))
      + row(cell(p("only")), '<w:gridBefore w:val="2"/>'),
    ));
    expect(elements).toEqual([{
      kind: "table",
      rich: true,
      headerRows: 1,
      rows: [["Hormone", "Serum", ""], ["", "Before", "After"], ["TSH", "0.2 <sup>2</sup>", "4.1"], ["", "", "only"]],
      merges: [{ row: 0, column: 0, rowSpan: 2, columnSpan: 1 }, { row: 0, column: 1, rowSpan: 1, columnSpan: 2 }],
    }]);
  });

  it("treats a table of one cell as a box round its text, and a table in a cell as lines of that cell", async () => {
    const boxed = await read(table(row(cell(p("A vignette in a box.") + p("Second line.")))));
    expect(texts(boxed.elements)).toEqual(["A vignette in a box.", "Second line."]);
    const nested = await read(table(row(cell(p("outer")) + cell(table(row(cell(p("a")) + cell(p("b"))) + row(cell(p("c")) + cell(p("d"))))))));
    expect(nested.elements).toEqual([{ kind: "table", rows: [["outer", "a | b\nc | d"]] }]);
    expect(codes(nested.issues)).toEqual(["warning:table_parse_uncertain"]);
  });

  it("places a picture found in a table cell straight after the table, and says so", async () => {
    const { elements, issues } = await read(
      table(row(cell(p("Finding")) + cell(paragraph(`<w:r>${drawing("rId5")}</w:r>`))) + row(cell(p("x")) + cell(p("y")))),
      { relationships: imageRelationship("rId5", "media/a.png"), media: { "a.png": TINY_PNG } },
    );
    expect(kinds(elements)).toBe("ti");
    expect(codes(issues)).toEqual(["info:media_association_uncertain"]);
  });

  it("carries the crop a document puts on a picture, so the hidden part stays hidden", async () => {
    const { elements, media } = await read(paragraph(`<w:r>${drawing("rId5", '<a:srcRect l="25000" b="10000"/>')}</w:r>`), { relationships: imageRelationship("rId5", "media/a.png"), media: { "a.png": TINY_PNG } });
    expect(elements).toEqual([{ kind: "image", target: "word/media/a.png", alt: "A figure", width: 200, height: 100, crop: { left: 0.25, top: 0, right: 0, bottom: 0.1 } }]);
    expect(media.get("word/media/a.png")).toEqual(TINY_PNG);
  });

  it("reports a picture that is linked from outside, or named but not in the file", async () => {
    const linked = await read(paragraph(`<w:r>${drawing("rId5", "", "r:link")}</w:r>`), { relationships: imageRelationship("rId5", "https://example.invalid/a.png", true) });
    expect(linked.elements.filter((element) => element.kind === "image")).toEqual([]);
    expect(codes(linked.issues)).toEqual(["error:missing_required_media"]);
    const absent = await read(paragraph(`<w:r>${drawing("rId5")}</w:r>`), { relationships: imageRelationship("rId5", "media/gone.png") });
    expect(codes(absent.issues)).toEqual(["error:missing_required_media"]);
  });

  it("says what it cannot read: a chart, and a comment", async () => {
    const chart = '<w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></wp:inline></w:drawing></w:r>';
    const { issues } = await read(paragraph(`${chart}<w:commentRangeStart w:id="0"/>${run("text")}`));
    expect(issues.map((issue) => issue.message)).toEqual([
      "The document holds a chart that AXOM cannot read. In Word, copy it and paste it back as a picture.",
      "The document has comments. They were not imported.",
    ]);
  });

  it("reads the strict spelling of the format", async () => {
    const strict = 'xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main" xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships"';
    expect(texts((await read(p("strict"), { namespaces: strict })).elements)).toEqual(["strict"]);
  });

  it("explains a file that is not a .docx", async () => {
    const message = async (bytes: Uint8Array) => (await readDocxBody(bytes)).issues.map((issue) => `${issue.code}: ${issue.message}`);
    expect(await message(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]))).toEqual(["invalid_document: This is an older .doc file. Open it in Word, save it as .docx, and import that."]);
    expect(await message(new TextEncoder().encode("a plain text file pretending to be a document"))).toEqual(["invalid_document: This is not a Word document: it is not a ZIP archive."]);
    const other = new JSZip();
    other.file("content.xml", "<x/>");
    expect(await message(await other.generateAsync({ type: "uint8array" }))).toEqual(["invalid_document: This is an OpenDocument file. Save it as .docx and import that."]);
  });
});

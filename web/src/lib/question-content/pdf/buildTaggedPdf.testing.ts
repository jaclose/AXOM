// Test support, not app code: small tagged PDFs written by hand from invented
// content. Each has the parts a Word or PowerPoint export has (a structure
// tree, marked content, a parent tree), so pdf.js reads it the way it reads a
// real one. Used by the unit tests of the loader and by the browser harness.

export interface Marked { role: string; ops: string; parent: number }
export interface Element { role: string; parent?: number; extra?: string }
/** One page. `parent` counts within the page's own elements. */
export interface PageSpec { width?: number; height?: number; elements: Element[]; marked: Marked[] }

export function taggedPdfPages(creator: string, pages: PageSpec[]): Uint8Array {
  const objects: string[] = [];
  const ROOT = 3;
  const DOCUMENT = 4;
  const PARENT_TREE = 5;
  const FONT = 6;
  const INFO = 7;
  let next = 8;
  const pageObjects: number[] = [];
  const topLevel: string[] = [];
  const parentTree: string[] = [];
  pages.forEach((page, pageIndex) => {
    const pageObject = next;
    const contents = next + 1;
    const firstElement = next + 2;
    next += 2 + page.elements.length;
    pageObjects.push(pageObject);
    const stream = page.marked.map((piece, mcid) => `/${piece.role} <</MCID ${mcid}>> BDC ${piece.ops} EMC`).join("\n");
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width ?? 612} ${page.height ?? 792}] /Contents ${contents} 0 R /StructParents ${pageIndex} /Resources << /Font << /F1 ${FONT} 0 R >> >> >>`;
    objects[contents] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    page.elements.forEach((element, index) => {
      const kids = [
        ...page.elements.flatMap((other, at) => (other.parent === index ? [`${firstElement + at} 0 R`] : [])),
        ...page.marked.flatMap((piece, mcid) => (piece.parent === index ? [String(mcid)] : [])),
      ].join(" ");
      objects[firstElement + index] = `<< /Type /StructElem /S /${element.role} /P ${element.parent === undefined ? DOCUMENT : firstElement + element.parent} 0 R /Pg ${pageObject} 0 R /K [${kids}] ${element.extra ?? ""} >>`;
      if (element.parent === undefined) topLevel.push(`${firstElement + index} 0 R`);
    });
    parentTree.push(`${pageIndex} [${page.marked.map((piece) => `${firstElement + piece.parent} 0 R`).join(" ")}]`);
  });
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot ${ROOT} 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjects.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[ROOT] = `<< /Type /StructTreeRoot /K [${DOCUMENT} 0 R] /ParentTree ${PARENT_TREE} 0 R >>`;
  objects[DOCUMENT] = `<< /Type /StructElem /S /Document /P ${ROOT} 0 R /K [${topLevel.join(" ")}] >>`;
  objects[PARENT_TREE] = `<< /Nums [${parentTree.join(" ")}] >>`;
  objects[FONT] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[INFO] = `<< /Creator (${creator}) >>`;
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = body.length;
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** One page: `elements` are its structure elements, and each piece of marked content names the element it belongs to. */
export const taggedPdf = (creator: string, elements: Element[], marked: Marked[]): Uint8Array => taggedPdfPages(creator, [{ elements, marked }]);

export const text = (words: string, left: number, fromBottom: number, size = 12): string => `BT /F1 ${size} Tf ${left} ${fromBottom} Td (${words}) Tj ET`;

/** A page being written top to bottom: each call adds one tagged block under the last. */
function writer(top: number, left = 72, step = 16) {
  const elements: Element[] = [];
  const marked: Marked[] = [];
  let y = top;
  const paragraph = (words: string): void => {
    elements.push({ role: "P" });
    // An empty paragraph still has a space in it, as a word processor writes one.
    marked.push({ role: "P", parent: elements.length - 1, ops: text(words || " ", left, y) });
    y -= step;
  };
  const figure = (width: number, height: number, alt: string): void => {
    const bottom = y - height + 8;
    elements.push({ role: "Figure", extra: `/Alt (${alt}) /A << /O /Layout /BBox [${left} ${bottom} ${left + width} ${bottom + height}] >>` });
    marked.push({ role: "Figure", parent: elements.length - 1, ops: `2 w ${left} ${bottom} ${width} ${height} re S ${left} ${bottom} m ${left + width} ${bottom + height} l S` });
    y = bottom - step;
  };
  const table = (rows: string[][]): void => {
    const at = elements.length;
    elements.push({ role: "Table" });
    rows.forEach((row, rowIndex) => {
      const rowAt = elements.length;
      elements.push({ role: "TR", parent: at });
      row.forEach((cell, column) => {
        elements.push({ role: rowIndex === 0 ? "TH" : "TD", parent: rowAt });
        marked.push({ role: rowIndex === 0 ? "TH" : "TD", parent: elements.length - 1, ops: text(cell, left + column * 130, y) });
      });
      y -= step;
    });
  };
  return { elements, marked, paragraph, figure, table, lines: (...all: string[]): void => all.forEach(paragraph) };
}

/** One invented question: a stem, a 2x2 table, a figure drawn as a rectangle, a lead-in, three choices and its answer. */
export function inventedQuestionPdf(creator = "An invented word processor"): Uint8Array {
  // Elements: 0 stem, 1 table, 2 and 3 its rows, 4 to 7 its cells, 8 figure, 9 lead-in, 10 to 12 choices, 13 answer.
  const elements: Element[] = [
    { role: "P" }, { role: "Table" }, { role: "TR", parent: 1 }, { role: "TR", parent: 1 },
    { role: "TH", parent: 2 }, { role: "TH", parent: 2 }, { role: "TD", parent: 3 }, { role: "TD", parent: 3 },
    { role: "Figure", extra: "/Alt (An invented dose-response curve) /A << /O /Layout /BBox [100 380 400 560] >>" },
    { role: "P" }, { role: "P" }, { role: "P" }, { role: "P" }, { role: "P" },
  ];
  const marked: Marked[] = [
    { role: "P", parent: 0, ops: text("1. A volunteer takes an invented drug and the table shows the result.", 72, 720) },
    { role: "TH", parent: 4, ops: text("Dose", 72, 690) },
    { role: "TH", parent: 5, ops: text("Level", 200, 690) },
    { role: "TD", parent: 6, ops: text("10 mg", 72, 670) },
    { role: "TD", parent: 7, ops: text("4 mg/L", 200, 670) },
    { role: "Figure", parent: 8, ops: "2 w 100 380 300 180 re S 100 380 m 400 560 l S" },
    { role: "P", parent: 9, ops: text("Which statement is supported?", 72, 350) },
    { role: "P", parent: 10, ops: text("A. The level rises with the dose", 72, 330) },
    { role: "P", parent: 11, ops: text("B. The level falls with the dose", 72, 310) },
    { role: "P", parent: 12, ops: text("C. The level does not change", 72, 290) },
    { role: "P", parent: 13, ops: text("Answer: A", 72, 270) },
  ];
  return taggedPdf(creator, elements, marked);
}

/**
 * A document of two pages holding two sets of questions, each numbered from 1.
 * The first set has a table and a figure and no answers of its own: they are
 * a section printed after the second set, under a heading the parser does not
 * know. The second set answers its first question in place and gives no
 * answer for its second.
 */
export function inventedTwoSetPdf(creator = "An invented word processor"): Uint8Array {
  const first = writer(740);
  first.lines("Cardiology", "1. A study compares an invented drug with placebo and counts the deaths in each group.");
  first.table([["Group", "Deaths", "Survivors"], ["Drug", "10", "90"], ["Placebo", "20", "80"]]);
  first.lines("What is the relative risk of death with the drug?", "A. 0.25", "B. 0.5", "C. 1.0", "D. 2.0", "");
  first.paragraph("2. A man of 60 has the invented pressure tracing shown.");
  first.figure(260, 120, "An invented pressure tracing");
  first.lines("Which valve lesion is most likely?", "A. Mitral stenosis", "B. Aortic regurgitation", "C. Aortic stenosis", "D. Tricuspid regurgitation");

  const second = writer(740);
  second.lines(
    "Renal physiology",
    "1. Which part of the nephron filters the blood into the urinary space?",
    "A. Glomerulus", "B. Loop of Henle", "C. Collecting duct", "D. Distal tubule",
    "Answer: A", "Explanation: Filtration happens across the glomerular capillaries.",
    "",
    "2. Which hormone makes the collecting duct take up more water?",
    "A. Aldosterone", "B. Renin", "C. Vasopressin", "D. Calcitriol",
    "",
    "Answers and brief explanations:",
    "Cardiology",
    "1. Answer: B", "Ten of 100 against twenty of 100 is a relative risk of one half.",
    "2. Answer: C", "A slow, late upstroke is the tracing of aortic stenosis.",
  );
  return taggedPdfPages(creator, [first, second]);
}

/**
 * A deck of seven slides: a title, then three questions, each followed by a
 * slide that prints it again with a small mark drawn beside one choice. No
 * key is printed anywhere. The first question has a graph.
 */
export function inventedDeckPdf(creator = "Invented Slides 3"): Uint8Array {
  const QUESTIONS = [
    ["1. A drug is given by constant infusion and its plasma level is followed over time.", "Which value decides how long it takes to reach steady state?", "A. Clearance alone", "B. Half-life", "C. Volume of distribution alone", "D. Bioavailability"],
    ["2. Two drugs act on the same receptor and reach the same maximal effect.", "Which word describes the drug that needs the lower dose?", "A. More efficacious", "B. More potent", "C. A partial agonist", "D. An inverse agonist"],
    ["3. A drug is cleared only by the kidney in a patient whose filtration has halved.", "Which change to the regimen keeps the same average level?", "A. Double the dose", "B. Halve the dosing interval", "C. Halve the dose", "D. No change"],
  ];
  const slide = (lines: string[], graph: boolean, markBeside?: number): PageSpec => {
    const elements: Element[] = [];
    const marked: Marked[] = [];
    lines.forEach((line, index) => {
      elements.push({ role: "P" });
      marked.push({ role: "P", parent: elements.length - 1, ops: text(line, 60, 480 - index * 34, 14) });
    });
    if (graph) {
      elements.push({ role: "Figure", extra: "/Alt (An invented plasma level curve) /A << /O /Layout /BBox [430 120 680 320] >>" });
      marked.push({ role: "Figure", parent: elements.length - 1, ops: "2 w 430 120 250 200 re S 430 120 m 680 320 l S" });
    }
    if (markBeside !== undefined) {
      const y = 480 - markBeside * 34 - 2;
      elements.push({ role: "Figure", extra: `/A << /O /Layout /BBox [36 ${y} 52 ${y + 16}] >>` });
      marked.push({ role: "Figure", parent: elements.length - 1, ops: `0 0.6 0 rg 36 ${y} 16 16 re f` });
    }
    return { width: 720, height: 540, elements, marked };
  };
  return taggedPdfPages(creator, [
    slide(["Pharmacokinetics review"], false),
    slide(QUESTIONS[0], true), slide(QUESTIONS[0], true, 3),
    slide(QUESTIONS[1], false), slide(QUESTIONS[1], false, 3),
    slide(QUESTIONS[2], false), slide(QUESTIONS[2], false, 4),
  ]);
}

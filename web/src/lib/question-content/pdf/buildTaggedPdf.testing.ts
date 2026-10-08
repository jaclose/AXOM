// Test support, not app code: a small tagged PDF written by hand from invented
// content. It has the parts a Word export has (a structure tree, marked
// content, a parent tree), so pdf.js reads it the way it reads a real one.
// Used by the unit test of the loader and by the browser harness.

export interface Marked { role: string; ops: string; parent: number }

/** One page. `tree` lists the structure elements; each piece of marked content names the element it belongs to. */
export function taggedPdf(creator: string, elements: { role: string; parent?: number; extra?: string }[], marked: Marked[]): Uint8Array {
  const objects: string[] = [];
  const FIRST_ELEMENT = 8;
  const stream = marked.map((piece, mcid) => `/${piece.role} <</MCID ${mcid}>> BDC ${piece.ops} EMC`).join("\n");
  const kidsOf = (element: number): string => [
    ...elements.flatMap((other, index) => (other.parent === element ? [`${FIRST_ELEMENT + index} 0 R`] : [])),
    ...marked.flatMap((piece, mcid) => (piece.parent === element ? [String(mcid)] : [])),
  ].join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /StructParents 0 /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>";
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objects[5] = "<< /Type /StructTreeRoot /K [6 0 R] /ParentTree 7 0 R >>";
  objects[6] = `<< /Type /StructElem /S /Document /P 5 0 R /K [${elements.flatMap((element, index) => (element.parent === undefined ? [`${FIRST_ELEMENT + index} 0 R`] : [])).join(" ")}] >>`;
  objects[7] = `<< /Nums [0 [${marked.map((piece) => `${FIRST_ELEMENT + piece.parent} 0 R`).join(" ")}]] >>`;
  elements.forEach((element, index) => {
    objects[FIRST_ELEMENT + index] = `<< /Type /StructElem /S /${element.role} /P ${element.parent === undefined ? 6 : FIRST_ELEMENT + element.parent} 0 R /Pg 3 0 R /K [${kidsOf(index)}] ${element.extra ?? ""} >>`;
  });
  const info = objects.length;
  objects[info] = `<< /Creator (${creator}) >>`;
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = body.length;
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export const text = (words: string, left: number, fromBottom: number): string => `BT /F1 12 Tf ${left} ${fromBottom} Td (${words}) Tj ET`;

/** One invented question: a stem, a 2x2 table, a figure drawn as a rectangle, a lead-in, three choices and its answer. */
export function inventedQuestionPdf(creator = "An invented word processor"): Uint8Array {
  // Elements: 0 stem, 1 table, 2 and 3 its rows, 4 to 7 its cells, 8 figure, 9 lead-in, 10 to 12 choices, 13 answer.
  const elements = [
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

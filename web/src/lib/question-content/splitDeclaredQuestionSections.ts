// Explicit multi-source boundaries in concatenated raw question collections.
// Not a question parser: after partitioning, AXOM's existing parser reads each
// source segment. Never infer a semester/week from a heading or quiz number.
export interface DeclaredQuestionSection {
  body: string;
  sourceLabel?: string;
  title?: string;
  /** 1-based position in this single source aggregate, not an official week. */
  set?: number;
}

const SOURCE_LINE = /^\s*Source file:\s*(.+\.(?:pdf|docx|txt|pptx))\s*$/i;
const QUESTION_ONE = /^\s*(?:question|q)\s*1\s*[).:\-–]/i;

function looksLikeDivider(line: string): boolean {
  return /^[-_=*\s]{5,}$/.test(line);
}

/** Split ONLY when repeated explicit source-file headings also begin a new
 * question sequence. Otherwise preserve the original intact for review.
 */
export function splitDeclaredQuestionSections(text: string): DeclaredQuestionSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const markers: Array<{ sourceLine: number; headingLine: number; sourceLabel: string; title: string }> = [];
  for (const [at, line] of lines.entries()) {
    const match = line.match(SOURCE_LINE);
    if (!match) continue;
    let headingLine = at - 1;
    while (headingLine >= 0 && (!lines[headingLine].trim() || looksLikeDivider(lines[headingLine]))) headingLine--;
    if (headingLine < 0) continue;
    const title = lines[headingLine].trim();
    const after = lines.slice(at + 1, Math.min(lines.length, at + 8));
    if (!after.some(item => QUESTION_ONE.test(item))) continue;
    markers.push({ sourceLine: at, headingLine, sourceLabel: match[1].trim(), title });
  }
  if (markers.length < 2) return [{ body: text }];
  const results: DeclaredQuestionSection[] = markers.map((marker, i) => ({
    set: i + 1,
    title: marker.title,
    sourceLabel: marker.sourceLabel,
    body: lines.slice(marker.sourceLine + 1, i + 1 < markers.length ? markers[i + 1].headingLine : lines.length).join("\n").trim(),
  }));
  // An arbitrary long preamble can contain relevant questions. Never drop
  // them by treating the first heading as a file boundary.
  const before = lines.slice(0, markers[0].headingLine).join("\n");
  if (/^\s*(?:question|q)\s*\d+\s*[).:\-–]/im.test(before)) return [{ body: text }];
  return results;
}

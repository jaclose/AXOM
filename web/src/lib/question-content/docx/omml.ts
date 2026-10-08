// ===========================================================================
// Word equations (Office Math, "OMML") read into the two forms an equation
// block holds: LaTeX to draw it, and plain text to search and to read aloud.
//
// Covers what course material uses: fractions, powers and indices, roots,
// brackets, sums and integrals, named functions, limits, accents, matrices.
// Anything else falls through to its contents, so text is never lost.
// ===========================================================================
import { attribute, child, elements, isElement, textOf, type XmlElement } from "./xml";

export const MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

export interface EquationText {
  latex: string;
  plainText: string;
}

const NARY: Record<string, string> = { "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap" };
const ACCENTS: Record<string, string> = { "̂": "\\hat", "̃": "\\tilde", "̄": "\\bar", "̅": "\\bar", "¯": "\\bar", "̇": "\\dot", "̈": "\\ddot", "⃗": "\\vec", "́": "\\acute", "̀": "\\grave", "̌": "\\check" };
const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "exp", "lim", "min", "max", "det", "gcd", "sup", "inf"]);
const BRACKETS: Record<string, string> = { "{": "\\{", "}": "\\}", "⟨": "\\langle", "⟩": "\\rangle", "‖": "\\|", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil" };

const escapeLatex = (text: string): string => text.replace(/[\\{}%&#$_^~]/g, (char) => (char === "\\" ? "\\backslash " : char === "~" ? "\\sim " : char === "^" ? "\\hat{}" : `\\${char}`));
const simple = (text: string): boolean => /^[\p{L}\p{N}.]+$/u.test(text);
const wrap = (text: string): string => (simple(text) ? text : `(${text})`);
const property = (element: XmlElement, group: string, name: string): string | undefined => attribute(child(child(element, MATH_NS, group), MATH_NS, name), MATH_NS, "val");
const part = (element: XmlElement, name: string): EquationText => {
  const found = child(element, MATH_NS, name);
  return found ? sequence(found) : { latex: "", plainText: "" };
};

function sequence(parent: XmlElement): EquationText {
  const parts = parent.children.filter(isElement).map(convert);
  return { latex: parts.map((entry) => entry.latex).join(""), plainText: parts.map((entry) => entry.plainText).join("") };
}

function run(element: XmlElement): EquationText {
  const text = element.children.filter(isElement).filter((node) => node.name === "t").map(textOf).join("");
  const upright = child(child(element, MATH_NS, "rPr"), MATH_NS, "nor") !== undefined;
  const latex = escapeLatex(text);
  return { latex: upright && /\p{L}{2,}/u.test(text) ? `\\text{${latex}}` : latex, plainText: text };
}

function convert(element: XmlElement): EquationText {
  if (element.ns !== MATH_NS) return element.name === "r" || element.name === "t" ? { latex: escapeLatex(textOf(element)), plainText: textOf(element) } : sequence(element);
  switch (element.name) {
    case "r":
      return run(element);
    case "f": {
      const top = part(element, "num");
      const bottom = part(element, "den");
      const kind = property(element, "fPr", "type");
      if (kind === "lin") return { latex: `${top.latex}/${bottom.latex}`, plainText: `${top.plainText}/${bottom.plainText}` };
      if (kind === "noBar") return { latex: `\\genfrac{}{}{0pt}{}{${top.latex}}{${bottom.latex}}`, plainText: `${wrap(top.plainText)} over ${wrap(bottom.plainText)}` };
      return { latex: `\\frac{${top.latex}}{${bottom.latex}}`, plainText: `${wrap(top.plainText)}/${wrap(bottom.plainText)}` };
    }
    case "sSup": {
      const base = part(element, "e");
      const power = part(element, "sup");
      return { latex: `{${base.latex}}^{${power.latex}}`, plainText: `${base.plainText}^${wrap(power.plainText)}` };
    }
    case "sSub": {
      const base = part(element, "e");
      const index = part(element, "sub");
      return { latex: `{${base.latex}}_{${index.latex}}`, plainText: `${base.plainText}_${wrap(index.plainText)}` };
    }
    case "sSubSup": {
      const base = part(element, "e");
      const index = part(element, "sub");
      const power = part(element, "sup");
      return { latex: `{${base.latex}}_{${index.latex}}^{${power.latex}}`, plainText: `${base.plainText}_${wrap(index.plainText)}^${wrap(power.plainText)}` };
    }
    case "sPre": {
      const base = part(element, "e");
      const index = part(element, "sub");
      const power = part(element, "sup");
      return { latex: `{}_{${index.latex}}^{${power.latex}}{${base.latex}}`, plainText: `${index.plainText}${power.plainText}${base.plainText}` };
    }
    case "rad": {
      const inside = part(element, "e");
      const degree = property(element, "radPr", "degHide") === "1" || property(element, "radPr", "degHide") === "on" ? { latex: "", plainText: "" } : part(element, "deg");
      return degree.latex
        ? { latex: `\\sqrt[${degree.latex}]{${inside.latex}}`, plainText: `${degree.plainText}√(${inside.plainText})` }
        : { latex: `\\sqrt{${inside.latex}}`, plainText: `√(${inside.plainText})` };
    }
    case "d": {
      const open = property(element, "dPr", "begChr") ?? "(";
      const close = property(element, "dPr", "endChr") ?? ")";
      const separator = property(element, "dPr", "sepChr") ?? "|";
      const inner = elements(element, MATH_NS, "e").map(sequence);
      const latexOf = (char: string): string => (char === "" ? "." : BRACKETS[char] ?? char);
      return {
        latex: `\\left${latexOf(open)}${inner.map((entry) => entry.latex).join(` ${separator} `)}\\right${latexOf(close)}`,
        plainText: `${open}${inner.map((entry) => entry.plainText).join(separator)}${close}`,
      };
    }
    case "nary": {
      const symbol = property(element, "naryPr", "chr") ?? "∫";
      const lower = part(element, "sub");
      const upper = part(element, "sup");
      const body = part(element, "e");
      return {
        latex: `${NARY[symbol] ?? escapeLatex(symbol)}${lower.latex ? `_{${lower.latex}}` : ""}${upper.latex ? `^{${upper.latex}}` : ""}{${body.latex}}`,
        plainText: `${symbol}${lower.plainText ? `_${wrap(lower.plainText)}` : ""}${upper.plainText ? `^${wrap(upper.plainText)}` : ""} ${body.plainText}`,
      };
    }
    case "func": {
      const name = part(element, "fName");
      const body = part(element, "e");
      const known = FUNCTIONS.has(name.plainText.trim());
      return { latex: `${known ? `\\${name.plainText.trim()}` : name.latex}{${body.latex}}`, plainText: `${name.plainText} ${body.plainText}`.trim() };
    }
    case "limLow": {
      const base = part(element, "e");
      const limit = part(element, "lim");
      return { latex: FUNCTIONS.has(base.plainText.trim()) ? `\\${base.plainText.trim()}_{${limit.latex}}` : `\\underset{${limit.latex}}{${base.latex}}`, plainText: `${base.plainText}_${wrap(limit.plainText)}` };
    }
    case "limUpp": {
      const base = part(element, "e");
      const limit = part(element, "lim");
      return { latex: `\\overset{${limit.latex}}{${base.latex}}`, plainText: `${base.plainText}^${wrap(limit.plainText)}` };
    }
    case "acc": {
      const body = part(element, "e");
      const mark = property(element, "accPr", "chr") ?? "̂";
      return { latex: `${ACCENTS[mark] ?? "\\hat"}{${body.latex}}`, plainText: `${body.plainText}${mark}` };
    }
    case "bar": {
      const body = part(element, "e");
      return { latex: `${property(element, "barPr", "pos") === "bot" ? "\\underline" : "\\overline"}{${body.latex}}`, plainText: body.plainText };
    }
    case "borderBox": {
      const body = part(element, "e");
      return { latex: `\\boxed{${body.latex}}`, plainText: body.plainText };
    }
    case "m": {
      const rows = elements(element, MATH_NS, "mr").map((row) => elements(row, MATH_NS, "e").map(sequence));
      return {
        latex: `\\begin{matrix}${rows.map((row) => row.map((cell) => cell.latex).join(" & ")).join(" \\\\ ")}\\end{matrix}`,
        plainText: `[${rows.map((row) => row.map((cell) => cell.plainText).join(", ")).join("; ")}]`,
      };
    }
    case "eqArr": {
      const lines = elements(element, MATH_NS, "e").map(sequence);
      return { latex: `\\begin{aligned}${lines.map((line) => line.latex).join(" \\\\ ")}\\end{aligned}`, plainText: lines.map((line) => line.plainText).join("; ") };
    }
    // Properties describe how to draw, not what is written.
    case "rPr": case "ctrlPr": case "fPr": case "dPr": case "naryPr": case "radPr": case "accPr": case "barPr": case "sSupPr": case "sSubPr":
    case "sSubSupPr": case "sPrePr": case "funcPr": case "limLowPr": case "limUppPr": case "mPr": case "eqArrPr": case "boxPr": case "borderBoxPr":
    case "groupChrPr": case "phantPr": case "oMathParaPr": case "argPr":
      return { latex: "", plainText: "" };
    default:
      return sequence(element);
  }
}

/** An `m:oMath` or `m:oMathPara` element as LaTeX and as plain text. */
export function readEquation(element: XmlElement): EquationText {
  const found = element.name === "oMathPara" ? elements(element, MATH_NS, "oMath").map(sequence) : [sequence(element)];
  return { latex: found.map((entry) => entry.latex).join(" \\\\ "), plainText: found.map((entry) => entry.plainText).join("; ").replace(/\s+/g, " ").trim() };
}

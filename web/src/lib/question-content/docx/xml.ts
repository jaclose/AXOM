// ===========================================================================
// A small XML reader for the parts of a Word document. Elements are matched
// by namespace and local name, never by prefix, since a prefix is only a
// nickname the writer chose.
//
// It reads no DTD and expands no entity beyond the five XML defines and
// character references, so a hostile file has nothing to expand. It needs no
// DOM, so it runs the same in a browser, a worker and Node.
// ===========================================================================

export interface XmlElement {
  /** Namespace URI, "" when the element has none. */
  ns: string;
  /** Name without its prefix. */
  name: string;
  /** Keyed "<namespace URI>|<local name>"; an unprefixed attribute has an empty namespace. */
  attributes: Map<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

function decode(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s>/!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
const ATTRIBUTE = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export interface XmlOptions {
  /** Namespace URIs to read as another URI, for the "strict" spelling of the Office formats. */
  aliases?: Readonly<Record<string, string>>;
}

export function parseXml(source: string, options: XmlOptions = {}): XmlElement {
  if (/<!DOCTYPE/i.test(source.slice(0, 2000))) throw new XmlError("The document declares a DTD, which AXOM does not read.");
  const alias = (uri: string): string => options.aliases?.[uri] ?? uri;
  const root: XmlElement = { ns: "", name: "#document", attributes: new Map(), children: [] };
  const stack: { element: XmlElement; scope: Map<string, string>; qualified: string }[] = [{ element: root, scope: new Map(), qualified: "" }];
  TOKEN.lastIndex = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) throw new XmlError(`The document's XML is damaged near character ${at}.`);
    const [, cdata, closing, opening, attributeText, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) top.element.children.push(decode(text));
    else if (cdata !== undefined) top.element.children.push(cdata);
    else if (closing !== undefined) {
      if (stack.length === 1 || top.qualified !== closing) throw new XmlError(`The document's XML closes <${closing}> where it should not.`);
      stack.pop();
    } else if (opening !== undefined) {
      const raw: [string, string][] = [];
      let scope = top.scope;
      ATTRIBUTE.lastIndex = 0;
      for (let found = ATTRIBUTE.exec(attributeText); found; found = ATTRIBUTE.exec(attributeText)) {
        const value = decode(found[2] ?? found[3] ?? "");
        if (found[1] === "xmlns" || found[1].startsWith("xmlns:")) {
          if (scope === top.scope) scope = new Map(top.scope);
          scope.set(found[1] === "xmlns" ? "" : found[1].slice(6), alias(value));
        } else raw.push([found[1], value]);
      }
      const split = (qualified: string): [string, string] => {
        const colon = qualified.indexOf(":");
        return colon < 0 ? ["", qualified] : [qualified.slice(0, colon), qualified.slice(colon + 1)];
      };
      const [prefix, name] = split(opening);
      const element: XmlElement = { ns: scope.get(prefix) ?? "", name, attributes: new Map(), children: [] };
      for (const [qualified, value] of raw) {
        const [attributePrefix, attributeName] = split(qualified);
        // An unprefixed attribute is in no namespace, whatever the default namespace is.
        element.attributes.set(`${attributePrefix ? scope.get(attributePrefix) ?? "" : ""}|${attributeName}`, value);
      }
      top.element.children.push(element);
      if (!selfClosing) stack.push({ element, scope, qualified: opening });
    }
  }
  if (stack.length !== 1) throw new XmlError("The document's XML ends before it is finished.");
  const documentElement = root.children.find((node): node is XmlElement => typeof node !== "string");
  if (!documentElement) throw new XmlError("The document's XML is empty.");
  return documentElement;
}

export const isElement = (node: XmlNode): node is XmlElement => typeof node !== "string";

export function elements(parent: XmlElement | undefined, ns?: string, name?: string): XmlElement[] {
  if (!parent) return [];
  return parent.children.filter((node): node is XmlElement => isElement(node) && (ns === undefined || node.ns === ns) && (name === undefined || node.name === name));
}

export function child(parent: XmlElement | undefined, ns: string, name: string): XmlElement | undefined {
  return parent?.children.find((node): node is XmlElement => isElement(node) && node.ns === ns && node.name === name);
}

/** The first element found by following a path of names in one namespace. */
export function descend(parent: XmlElement | undefined, ns: string, ...names: string[]): XmlElement | undefined {
  let current = parent;
  for (const name of names) current = child(current, ns, name);
  return current;
}

export function attribute(element: XmlElement | undefined, ns: string, name: string): string | undefined {
  return element?.attributes.get(`${ns}|${name}`);
}

/** Every element below `parent` that matches, in document order. */
export function findAll(parent: XmlElement, ns: string, name: string, into: XmlElement[] = []): XmlElement[] {
  for (const node of parent.children) {
    if (!isElement(node)) continue;
    if (node.ns === ns && node.name === name) into.push(node);
    findAll(node, ns, name, into);
  }
  return into;
}

export function textOf(element: XmlElement): string {
  return element.children.map((node) => (isElement(node) ? textOf(node) : node)).join("");
}

/**
 * Parser for Epson's ePOS-Print XML protocol (HTTP POST of a SOAP envelope wrapping an
 * <epos-print> body of declarative <text>/<feed>/<cut> elements — see Epson's ePOS-Print XML
 * User's Manual). Square's use of this protocol (vs. raw ESC/POS on 9100) is unconfirmed;
 * this parser exists so Step 0's capture can be fed through it once real payloads are seen.
 *
 * Same scope as escpos.parser.ts: text + job-boundary only. <barcode>/<image>/<symbol>/layout
 * elements are intentionally ignored for v1.
 */
import { XMLParser } from "fast-xml-parser";
import type { RawTicketLines } from "./printer.types";

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Ticket text indentation (used by ticket.mapper.ts to detect modifiers) lives in
  // leading whitespace inside <text> content — the default trimValues:true would strip it.
  trimValues: false,
});

function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx === -1 ? tag : tag.slice(idx + 1);
}

function findByLocalName(nodes: XmlNode[], name: string): XmlNode[] {
  const matches: XmlNode[] = [];
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === ":@") continue;
      if (localName(key) === name) {
        matches.push(node);
      }
      const value = node[key];
      if (Array.isArray(value)) matches.push(...findByLocalName(value as XmlNode[], name));
    }
  }
  return matches;
}

function textContent(children: XmlNode[]): string {
  return children
    .filter((c) => "#text" in c)
    .map((c) => String((c as Record<string, unknown>)["#text"]))
    .join("");
}

export function parseEposPrintXml(xml: string): RawTicketLines[] {
  let doc: XmlNode[];
  try {
    doc = parser.parse(xml);
  } catch (err) {
    console.warn("[eposxml] failed to parse XML body:", err);
    return [];
  }

  const eposPrintNodes = findByLocalName(doc, "epos-print");
  const tickets: RawTicketLines[] = [];

  for (const eposNode of eposPrintNodes) {
    const rootKey = Object.keys(eposNode).find((k) => k !== ":@" && localName(k) === "epos-print");
    if (!rootKey) continue;
    const children = eposNode[rootKey] as XmlNode[];

    let lines: string[] = [];
    let currentLine = "";

    const flushLine = (): void => {
      lines.push(currentLine);
      currentLine = "";
    };

    const endTicket = (): void => {
      flushLine();
      if (lines.some((line) => line.trim().length > 0)) tickets.push({ lines: [...lines] });
      lines = [];
    };

    for (const child of children) {
      const tagKey = Object.keys(child).find((k) => k !== ":@");
      if (!tagKey) continue;
      const tag = localName(tagKey);
      const value = child[tagKey];

      if (tag === "text") {
        const content = Array.isArray(value) ? textContent(value as XmlNode[]) : String(value ?? "");
        const segments = content.split("\n");
        currentLine += segments[0];
        for (let s = 1; s < segments.length; s++) {
          flushLine();
          currentLine = segments[s];
        }
      } else if (tag === "feed") {
        const attrs = (child[":@"] as Record<string, string>) ?? {};
        const lineCount = Number(attrs["@_line"] ?? 1) || 1;
        for (let n = 0; n < lineCount; n++) flushLine();
      } else if (tag === "cut") {
        endTicket();
      }
      // barcode/symbol/image/layout elements intentionally ignored for v1
    }

    endTicket();
  }

  return tickets;
}

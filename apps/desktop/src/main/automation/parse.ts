import { XMLParser } from "fast-xml-parser";
import type { PineJsonValue } from "../../shared/agent";

const MAX_PARSE_BYTES = 5 * 1024 * 1024;

function assertSize(text: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_PARSE_BYTES)
    throw new Error("Text to parse is larger than 5 MiB.");
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: false,
  trimValues: true,
});

/** XML (including RSS and Atom) as plain JSON; attributes are `@name`. */
export function parseXml(text: string): PineJsonValue {
  assertSize(text);
  return xmlParser.parse(text, true) as PineJsonValue;
}

/** RFC 4180 CSV with quoted fields; rows keep their own lengths. */
export function parseCsv(text: string): string[][] {
  assertSize(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && field === "") quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

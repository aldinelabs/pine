import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { PropertyList } from "./properties";

/** RTF keeps its `{\info}` group in the header. */
const HEADER_LIMIT = 1024 * 1024;

function codePageDecoder(header: string): TextDecoder {
  const codePage = /\\ansicpg(\d+)/.exec(header)?.[1];
  const labels: Record<string, string> = {
    "932": "shift_jis",
    "936": "gbk",
    "949": "euc-kr",
    "950": "big5",
    "65001": "utf-8",
  };
  const label = codePage
    ? (labels[codePage] ?? `windows-${codePage}`)
    : "windows-1252";
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder("windows-1252");
  }
}

/** The plain text of a group's contents: `\'hh` bytes, `\uN` characters. */
function groupText(source: string, decoder: TextDecoder): string {
  let text = "";
  let bytes: number[] = [];
  let skip = 0;
  let fallback = 1;
  const flush = () => {
    if (bytes.length) text += decoder.decode(Uint8Array.from(bytes));
    bytes = [];
  };
  const pattern =
    /\\'([0-9a-fA-F]{2})|\\([a-z]+)(-?\d+)? ?|\\([\\{}])|\\.|([^\\{}\r\n])/g;
  for (const match of source.matchAll(pattern)) {
    const [, hex, word, parameter, escaped, char] = match;
    if (skip > 0 && (hex || escaped || char)) {
      skip--;
      continue;
    }
    if (hex) bytes.push(parseInt(hex, 16));
    else if (word === "u" && parameter) {
      flush();
      const code = Number(parameter);
      text += String.fromCharCode(code < 0 ? code + 65536 : code);
      skip = fallback;
    } else if (word === "uc" && parameter) fallback = Number(parameter);
    else if (escaped || char) {
      flush();
      text += escaped ?? char;
    }
  }
  flush();
  return text;
}

/** The contents of the group that starts at `start` (its `{`). */
function groupAt(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") index++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0)
      return source.slice(start + 1, index);
  }
  return source.slice(start + 1);
}

function destination(info: string, name: string): string | undefined {
  const match = new RegExp(`\\{(?:\\\\\\*)?\\\\${name}(?![a-z])`).exec(info);
  if (!match) return undefined;
  return groupAt(info, match.index).slice(match[0].length - 1);
}

/** `{\creatim\yr2023\mo1\dy2\hr3\min4}` → "2023-01-02T03:04:00". */
function rtfDate(group: string | undefined): string | undefined {
  if (!group) return undefined;
  const part = (name: string) =>
    new RegExp(`\\\\${name}(\\d+)`).exec(group)?.[1]?.padStart(2, "0");
  const year = /\\yr(\d{4})/.exec(group)?.[1];
  if (!year) return undefined;
  return `${year}-${part("mo") ?? "01"}-${part("dy") ?? "01"}T${part("hr") ?? "00"}:${part("min") ?? "00"}:${part("sec") ?? "00"}`;
}

export function readRtfProperties(buffer: ArrayBuffer): PreviewProperty[] {
  const header = new TextDecoder("latin1").decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HEADER_LIMIT)),
  );
  const decoder = codePageDecoder(header.slice(0, 2048));
  const list = new PropertyList();
  const infoStart = /\{\\info(?![a-z])/.exec(header)?.index;
  const info = infoStart === undefined ? "" : groupAt(header, infoStart);
  const text = (name: string) => {
    const group = destination(info, name);
    return group === undefined ? undefined : groupText(group, decoder);
  };
  if (info)
    list
      .text("title", text("title"))
      .text("subject", text("subject"))
      .text("author", text("author"))
      .text("lastModifiedBy", text("operator"))
      .text("keywords", text("keywords"))
      .text("comment", text("doccomm"))
      .date("documentCreated", rtfDate(destination(info, "creatim")))
      .date("documentModified", rtfDate(destination(info, "revtim")))
      .number("words", /\\nofwords(\d+)/.exec(info)?.[1])
      .number("characters", /\\nofchars(\d+)/.exec(info)?.[1]);
  const generator = destination(header.slice(0, 64 * 1024), "generator");
  if (generator)
    list.text(
      "application",
      groupText(generator, decoder).replace(/;\s*$/, ""),
    );
  return list.items;
}

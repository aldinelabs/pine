/**
 * Outlook stores message bodies as compressed RTF (MS-OXRTFCP), and HTML
 * mail as RTF that encapsulates the original HTML (MS-OXRTFEX). This
 * decompresses the RTF and recovers the HTML or plain text inside it.
 */

const PREBUF =
  "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

/** Larger output means a corrupt or hostile size field. */
const MAX_RTF_BYTES = 64 * 1024 * 1024;

export function decompressRtf(data: Uint8Array): Uint8Array {
  if (data.length < 16) throw new Error("The RTF body is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rawSize = view.getUint32(4, true);
  const type = view.getUint32(8, true);
  if (type === 0x414c454d) return data.slice(16, 16 + rawSize); // "MELA", stored
  if (type !== 0x75465a4c)
    throw new Error("The RTF body uses an unknown compression.");
  if (rawSize > MAX_RTF_BYTES) throw new Error("The RTF body is too large.");
  const dictionary = new Uint8Array(4096);
  for (let index = 0; index < PREBUF.length; index++)
    dictionary[index] = PREBUF.charCodeAt(index);
  let write = PREBUF.length;
  const output = new Uint8Array(rawSize);
  let out = 0;
  let at = 16;
  while (at < data.length && out < rawSize) {
    const control = data[at++];
    for (let bit = 0; bit < 8 && out < rawSize; bit++) {
      if (control & (1 << bit)) {
        if (at + 1 >= data.length) return output.subarray(0, out);
        const token = (data[at] << 8) | data[at + 1];
        at += 2;
        const offset = token >> 4;
        const length = (token & 0x0f) + 2;
        if (offset === write) return output.subarray(0, out);
        for (let step = 0; step < length && out < rawSize; step++) {
          const byte = dictionary[(offset + step) % 4096];
          output[out++] = byte;
          dictionary[write] = byte;
          write = (write + 1) % 4096;
        }
      } else {
        if (at >= data.length) return output.subarray(0, out);
        const byte = data[at++];
        output[out++] = byte;
        dictionary[write] = byte;
        write = (write + 1) % 4096;
      }
    }
  }
  return output.subarray(0, out);
}

const DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "header",
  "footer",
  "generator",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "xmlnstbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
]);

/**
 * Reads the text of an RTF document. With `\fromhtml`, returns the
 * encapsulated HTML: text inside `\htmlrtf` blocks is RTF-only rendering
 * and is skipped, while `\*\htmltag` groups carry the original markup.
 */
export function rtfToContent(rtf: Uint8Array): { html?: string; text: string } {
  const source = new TextDecoder("latin1").decode(rtf);
  const fromHtml = /\\fromhtml1/.test(source.slice(0, 1024));
  let codepage = Number(
    /\\ansicpg(\d+)/.exec(source.slice(0, 1024))?.[1] ?? 1252,
  );
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(`windows-${codepage}`);
  } catch {
    codepage = 1252;
    decoder = new TextDecoder("windows-1252");
  }
  if (codepage === 936) decoder = new TextDecoder("gbk");
  else if (codepage === 950) decoder = new TextDecoder("big5");
  else if (codepage === 932) decoder = new TextDecoder("shift_jis");
  else if (codepage === 949) decoder = new TextDecoder("euc-kr");

  interface Group {
    skip: boolean;
    htmlrtf: boolean;
    uc: number;
  }
  const stack: Group[] = [];
  let group: Group = { skip: false, htmlrtf: false, uc: 1 };
  let output = "";
  let bytes: number[] = [];
  let skipChars = 0;
  const flush = (): void => {
    if (bytes.length) {
      output += decoder.decode(new Uint8Array(bytes));
      bytes = [];
    }
  };
  const emit = (text: string): void => {
    if (group.skip || (fromHtml && group.htmlrtf)) return;
    flush();
    output += text;
  };
  let index = 0;
  /** The next control word opens its group, after an optional `\*`. */
  let groupStart = false;
  let destination = false;
  while (index < source.length) {
    const char = source[index];
    if (char === "{") {
      stack.push(group);
      group = { ...group };
      groupStart = true;
      destination = false;
      index++;
      continue;
    }
    if (char === "}") {
      group = stack.pop() ?? group;
      groupStart = false;
      index++;
      continue;
    }
    if (char === "\\") {
      const next = source[index + 1];
      if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        index += 2;
        continue;
      }
      if (next === "'") {
        const value = Number.parseInt(source.slice(index + 2, index + 4), 16);
        index += 4;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        if (!group.skip && !(fromHtml && group.htmlrtf)) bytes.push(value);
        continue;
      }
      if (next === "*") {
        destination = true;
        index += 2;
        continue;
      }
      const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(
        source.slice(index, index + 40),
      );
      if (!word) {
        index += 2;
        continue;
      }
      index += word[0].length;
      const [, name = "", parameter] = word;
      const value = parameter === undefined ? undefined : Number(parameter);
      if (groupStart) {
        if (name === "htmltag") {
          // The group's text is the original HTML, even inside \htmlrtf.
          group.htmlrtf = false;
          group.skip = false;
        } else if (destination || DESTINATIONS.has(name)) group.skip = true;
      }
      groupStart = false;
      destination = false;
      switch (name) {
        case "htmlrtf":
          group.htmlrtf = value !== 0;
          break;
        case "par":
        case "line":
          emit("\n");
          break;
        case "tab":
          emit("\t");
          break;
        case "uc":
          group.uc = value ?? 1;
          break;
        case "u":
          if (value !== undefined)
            emit(String.fromCharCode(value < 0 ? value + 65536 : value));
          skipChars = group.uc;
          break;
        case "emdash":
          emit("—");
          break;
        case "endash":
          emit("–");
          break;
        case "lquote":
          emit("‘");
          break;
        case "rquote":
          emit("’");
          break;
        case "ldblquote":
          emit("“");
          break;
        case "rdblquote":
          emit("”");
          break;
      }
      continue;
    }
    groupStart = false;
    if (char === "\r" || char === "\n") {
      index++;
      continue;
    }
    if (skipChars > 0) {
      skipChars--;
      index++;
      continue;
    }
    if (!group.skip && !(fromHtml && group.htmlrtf)) {
      const code = char.charCodeAt(0);
      if (code > 0x7f) bytes.push(code);
      else {
        flush();
        output += char;
      }
    }
    index++;
  }
  flush();
  return fromHtml ? { html: output, text: "" } : { text: output.trim() };
}

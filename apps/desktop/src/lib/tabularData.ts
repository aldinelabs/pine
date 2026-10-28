/** Parsers for plain tabular files previewed in a data grid. */

export interface Table {
  columns: string[];
  rows: string[][];
  /** True when rows past `MAX_TABLE_ROWS` were left out. */
  truncated: boolean;
}

/** Rows kept from a text table; the grid shows them all virtualized. */
export const MAX_TABLE_ROWS = 1_000_000;

/**
 * Parses CSV or TSV per RFC 4180: quoted fields may hold delimiters, quotes
 * (doubled) and line breaks. The first row is the header.
 */
export function parseDelimited(
  source: string,
  delimiter: "," | "\t",
  maxRows = MAX_TABLE_ROWS,
): Table {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;
  let index = 0;
  const endRow = (): void => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else field += char;
      index++;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      endRow();
      if (char === "\r" && text[index + 1] === "\n") index++;
      // The header plus `maxRows` data rows.
      if (rows.length > maxRows) {
        truncated = index + 1 < text.length;
        break;
      }
    } else field += char;
    index++;
  }
  if (!truncated && (field !== "" || row.length)) endRow();
  const [header = [], ...body] = rows;
  const width = Math.max(
    header.length,
    ...body.slice(0, 1000).map((r) => r.length),
  );
  const columns = Array.from(
    { length: width },
    (_, column) => header[column]?.trim() || columnName(column),
  );
  return { columns, rows: body, truncated };
}

/** Spreadsheet-style column names: A, B, …, Z, AA, AB, … */
export function columnName(index: number): string {
  let name = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

export interface DbfField {
  name: string;
  type: string;
  length: number;
  decimals: number;
}

export interface DbfTable {
  fields: DbfField[];
  rowCount: number;
  /** Reads records `start` to `end` (exclusive) as typed values. */
  rows: (start: number, end: number) => (string | number | boolean | null)[][];
}

/** dBASE language driver IDs (header byte 29) and their text encodings. */
const DBF_ENCODINGS: Record<number, string> = {
  0x01: "ibm437",
  0x02: "ibm850",
  0x03: "windows-1252",
  0x13: "shift_jis",
  0x4d: "gbk",
  0x4e: "euc-kr",
  0x4f: "big5",
  0x57: "windows-1252",
  0x64: "ibm852",
  0x65: "ibm866",
  0x78: "big5",
  0x79: "euc-kr",
  0x7a: "gbk",
  0x7b: "shift_jis",
  0xc8: "windows-1250",
  0xc9: "windows-1251",
  0xca: "windows-1254",
  0xcb: "windows-1253",
};

function dbfDecoder(languageDriver: number): TextDecoder {
  try {
    return new TextDecoder(DBF_ENCODINGS[languageDriver] ?? "utf-8");
  } catch {
    // Encodings the runtime lacks fall back to UTF-8.
    return new TextDecoder("utf-8");
  }
}

/**
 * Reads a dBASE III–7 / FoxPro table. Records are decoded on demand, so a
 * large table only costs what the grid shows. Text uses the encoding named
 * by the header's language driver.
 */
export function readDbf(buffer: ArrayBuffer): DbfTable {
  const view = new DataView(buffer);
  if (buffer.byteLength < 32) throw new Error("The DBF header is truncated.");
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength > buffer.byteLength || recordLength === 0)
    throw new Error("The DBF header is invalid.");
  const decoder = dbfDecoder(view.getUint8(29));
  const bytes = new Uint8Array(buffer);
  const fields: DbfField[] = [];
  const offsets: number[] = [];
  // Records start with a deletion flag byte.
  let offset = 1;
  for (let at = 32; at + 32 <= headerLength && bytes[at] !== 0x0d; at += 32) {
    const nameBytes = bytes.subarray(at, at + 11);
    const end = nameBytes.indexOf(0);
    const field = {
      name: decoder.decode(end < 0 ? nameBytes : nameBytes.subarray(0, end)),
      type: String.fromCharCode(bytes[at + 11]),
      length: bytes[at + 16],
      decimals: bytes[at + 17],
    };
    fields.push(field);
    offsets.push(offset);
    offset += field.length;
  }
  const available = Math.floor(
    (buffer.byteLength - headerLength) / recordLength,
  );
  const rowCount = Math.min(recordCount, available);

  function value(field: DbfField, raw: Uint8Array) {
    const text = decoder.decode(raw).trim();
    switch (field.type) {
      case "N":
      case "F": {
        if (!text) return null;
        const number = Number(text);
        return Number.isFinite(number) ? number : text;
      }
      case "L":
        if (/^[YyTt]$/.test(text)) return true;
        if (/^[NnFf]$/.test(text)) return false;
        return null;
      case "D":
        return /^\d{8}$/.test(text)
          ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
          : text || null;
      default:
        return text;
    }
  }

  return {
    fields,
    rowCount,
    rows(start, end) {
      const result: (string | number | boolean | null)[][] = [];
      for (let row = start; row < Math.min(end, rowCount); row++) {
        const base = headerLength + row * recordLength;
        result.push(
          fields.map((field, index) =>
            value(
              field,
              bytes.subarray(
                base + offsets[index],
                base + offsets[index] + field.length,
              ),
            ),
          ),
        );
      }
      return result;
    },
  };
}

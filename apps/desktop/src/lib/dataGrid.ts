/** A value in a data preview table, as a parser hands it over. */
export type GridCell = unknown;

export interface FormattedCell {
  text: string;
  kind: "text" | "number" | "null" | "binary" | "empty";
}

const BINARY_PREVIEW_BYTES = 16;
const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, BINARY_PREVIEW_BYTES), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
}

/** Renders a cell value as one line of text, with a kind for styling. */
export function formatGridCell(value: GridCell, locale: string): FormattedCell {
  if (value === undefined) return { text: "", kind: "empty" };
  if (value === null) return { text: "NULL", kind: "null" };
  if (typeof value === "number")
    return {
      text: Number.isFinite(value)
        ? value.toLocaleString(locale, { maximumFractionDigits: 12 })
        : String(value),
      kind: "number",
    };
  if (typeof value === "bigint")
    return { text: value.toLocaleString(locale), kind: "number" };
  if (typeof value === "boolean") return { text: String(value), kind: "text" };
  if (value instanceof Uint8Array) {
    const more = value.byteLength > BINARY_PREVIEW_BYTES ? " …" : "";
    return {
      text: `${value.byteLength} B · ${hex(value)}${more}`,
      kind: "binary",
    };
  }
  if (value instanceof Date)
    return {
      text: Number.isNaN(value.getTime()) ? String(value) : value.toISOString(),
      kind: "text",
    };
  if (typeof value === "object")
    return {
      text: JSON.stringify(value, (_key, nested: unknown) =>
        typeof nested === "bigint" ? nested.toString() : nested,
      ),
      kind: "text",
    };
  // Anything left is a string; functions and symbols never come from parsers.
  if (typeof value !== "string") return { text: "", kind: "empty" };
  const text = value.replace(/\s*\n\s*/g, " ↵ ");
  if (!text) return { text, kind: "empty" };
  // Text tables carry numbers as text; align them like numbers.
  return { text, kind: NUMERIC.test(text) ? "number" : "text" };
}

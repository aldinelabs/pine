import type {
  PreviewProperty,
  PreviewPropertyKey,
} from "@/components/project/file-preview/previewRenderer";

/**
 * Collects a format's properties in order, leaving out absent, empty and
 * non-finite values.
 */
export class PropertyList {
  readonly items: PreviewProperty[] = [];

  text(key: PreviewPropertyKey, value: string | undefined | null): this {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (trimmed) this.items.push({ key, value: trimmed });
    return this;
  }

  number(key: PreviewPropertyKey, value: number | undefined | null): this {
    if (typeof value === "number" && Number.isFinite(value))
      this.items.push({ key, type: "number", value });
    return this;
  }

  /**
   * A date and time the format records. Values without a time of day
   * ("2010", "2010-05-01") and unparsable ones are kept as text, since
   * Details would otherwise show a midnight that the file never said.
   */
  date(key: PreviewPropertyKey, value: Date | string | undefined | null): this {
    if (value === undefined || value === null || value === "") return this;
    if (typeof value === "string" && !/\d:\d\d/.test(value))
      return this.text(key, value);
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
      return typeof value === "string" ? this.text(key, value) : this;
    this.items.push({ key, type: "date", value: date.toISOString() });
    return this;
  }

  boolean(key: PreviewPropertyKey, value: boolean | undefined): this {
    if (value !== undefined) this.items.push({ key, type: "boolean", value });
    return this;
  }
}

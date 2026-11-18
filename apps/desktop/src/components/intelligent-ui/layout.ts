/** Steps of the card rhythm: inline (sm), field (md, a FieldGroup apart), section (lg). */
export const GAP = {
  none: "gap-0",
  sm: "gap-2",
  md: "gap-5",
  lg: "gap-8",
} as const;
export const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
} as const;
export const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;
export const PADDING = {
  none: "p-0",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
} as const;

/** A value from a lookup table, or undefined for anything else. */
export function pick<T extends Record<string, string>>(
  table: T,
  key: unknown,
): T[keyof T] | undefined {
  return typeof key === "string" && key in table
    ? table[key as keyof T]
    : undefined;
}

/** Child elements one by one, flattening the lists `@Each` produces. */
export function childList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(childList);
  return value === null || value === undefined ? [] : [value];
}

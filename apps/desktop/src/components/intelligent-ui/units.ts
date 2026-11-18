const PREFIX_UNITS = new Set(["$", "€", "£", "¥", "₩", "₹", "₽", "US$", "HK$"]);

/** A number with its unit: `$40`, `25%`, `3.5 kg`. */
export function withUnit(value: number, unit: unknown): string {
  const text = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof unit !== "string" || !unit.trim()) return text;
  const trimmed = unit.trim();
  if (PREFIX_UNITS.has(trimmed)) return `${trimmed}${text}`;
  if (trimmed === "%" || trimmed === "°" || trimmed === "‰")
    return `${text}${trimmed}`;
  return `${text} ${trimmed}`;
}

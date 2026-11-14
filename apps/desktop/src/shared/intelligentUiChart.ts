/**
 * The data key each chart series reads. A model sometimes lists display
 * names as series while the rows use other keys, which would draw every
 * value as 0; when no listed series is a key of the data, the first row's
 * numeric keys (other than x) stand in for them in order, so the listed
 * names can serve as their labels.
 */
export function chartSeriesKeys(
  data: readonly Record<string, unknown>[],
  x: string,
  series: readonly string[],
): string[] {
  const [first] = data;
  if (!first || series.some((key) => data.some((item) => key in item)))
    return [...series];
  const numeric = Object.keys(first).filter(
    (key) => key !== x && typeof first[key] === "number",
  );
  return numeric.length === series.length ? numeric : [...series];
}

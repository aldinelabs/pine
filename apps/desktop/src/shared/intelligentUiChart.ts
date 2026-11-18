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

/**
 * The category key and series a chart reads. Either may be left out: x is
 * the first key holding text (a number key for scatter, which plots numbers
 * on both axes), and the series are every other key holding numbers.
 */
export function chartAxes(
  data: readonly Record<string, unknown>[],
  type: string,
  x: string | undefined,
  series: readonly string[] | undefined,
): { x: string; series: string[] } {
  const keys = [...new Set(data.flatMap((item) => Object.keys(item)))];
  const holds = (key: string, kind: "string" | "number") =>
    data.some((item) => typeof item[key] === kind);
  const numeric = keys.filter(
    (key) => holds(key, "number") && !holds(key, "string"),
  );
  const category =
    x ||
    (type === "scatter"
      ? numeric[0]
      : (keys.find((key) => holds(key, "string")) ?? keys[0])) ||
    "";
  const listed = (series ?? []).filter(
    (key): key is string => typeof key === "string" && key !== "",
  );
  return {
    x: category,
    series:
      listed.length > 0 ? listed : numeric.filter((key) => key !== category),
  };
}

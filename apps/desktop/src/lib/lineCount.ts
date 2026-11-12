/**
 * Line counts for text that grows while it streams (tool arguments), so a
 * count never copies the text into an array of lines.
 */

/** The number of lines in `text`, as `text.split("\n").length` counts them. */
export function countLines(text: string): number {
  let lines = 1;
  let at = text.indexOf("\n");
  while (at >= 0) {
    lines += 1;
    at = text.indexOf("\n", at + 1);
  }
  return lines;
}

const NON_WHITESPACE = /\S/g;

/** The lines of `text` with anything besides whitespace, as `trim()` sees it. */
export function countNonEmptyLines(text: string): number {
  let lines = 0;
  NON_WHITESPACE.lastIndex = 0;
  while (NON_WHITESPACE.exec(text)) {
    lines += 1;
    const end = text.indexOf("\n", NON_WHITESPACE.lastIndex);
    if (end < 0) break;
    NON_WHITESPACE.lastIndex = end + 1;
  }
  return lines;
}

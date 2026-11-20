/**
 * Tailwind compiles `group-*` and `peer-*` variants to an ancestor or sibling
 * test nested in `:is()`, e.g.
 *
 *   .x:is(:where(.group\/item):has([data-slot="badge"]) *)
 *   .y:is(:where(.group)[data-state="collapsed"] *)
 *
 * Chromium cannot scope invalidation inside `:is()`. While a `group-has-*`
 * rule exists, inserting any element anywhere restyles the whole document;
 * in a long transcript every streamed chunk then costs tens of milliseconds.
 * A `group-data-*` or `peer-data-*` rule makes every change of that attribute
 * restyle the group's whole subtree (or every sibling's), so toggling a
 * sidebar restyles the session tree and the conversation at the moment its
 * slide starts. The same test written as a plain combinator,
 *
 *   :where(.group\/item):has([data-slot="badge"]) .x
 *
 * matches the same elements with the same specificity, and Chromium only
 * re-checks the elements it concerns.
 *
 * Only tests on a selector's first compound move: the ancestor may sit above
 * the earlier compounds, which a combinator in place would not allow.
 *
 * Each selector moves out one test, the `:has()` one when there is one: two
 * tests on one compound may both be met by the same ancestor, which two
 * chained combinators would no longer allow.
 */

const COMBINATORS = new Set([" ", ">", "+", "~"]);

/** Index just past the bracket group opened at `start`, honouring escapes and strings. */
function closingIndex(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      index++;
    } else if (char === '"' || char === "'") {
      const end = text.indexOf(char, index + 1);
      index = end < 0 ? text.length : end;
    } else if (char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** Calls `visit` for each top-level character position (outside any brackets). */
function topLevel(text: string, visit: (index: number) => boolean | void) {
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      if (visit(index) === false) return;
      index++;
    } else if (char === "(" || char === "[" || char === '"' || char === "'") {
      if (visit(index) === false) return;
      const end =
        char === '"' || char === "'"
          ? text.indexOf(char, index + 1) + 1
          : closingIndex(text, index);
      if (end <= 0) return;
      index = end - 1;
    } else if (visit(index) === false) {
      return;
    }
  }
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  topLevel(text, (index) => {
    if (text[index] === separator) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  });
  parts.push(text.slice(start));
  return parts;
}

/**
 * Splits an `:is()` argument of the form `<compound> <combinator> *` into its
 * compound and combinator, or returns undefined for any other shape.
 */
function ancestorTest(
  argument: string,
): { compound: string; combinator: string } | undefined {
  const trimmed = argument.trim();
  if (!trimmed.endsWith("*")) return undefined;
  const beforeStar = trimmed.slice(0, -1);
  if (!/[\s>+~]$/.test(beforeStar) || beforeStar.endsWith("\\"))
    return undefined;
  const head = beforeStar.trimEnd();
  const last = head.at(-1) ?? "";
  const explicit = last === ">" || last === "+" || last === "~";
  const combinator = explicit ? last : " ";
  const compound = (explicit ? head.slice(0, -1) : head).trim();
  if (!compound) return undefined;
  let simple = true;
  topLevel(compound, (index) => {
    if (COMBINATORS.has(compound[index]) || compound[index] === ",") {
      simple = false;
      return false;
    }
  });
  if (!simple) return undefined;
  return { compound, combinator };
}

interface AncestorMatch {
  start: number;
  end: number;
  compoundStart: number;
  test: { compound: string; combinator: string };
}

function flattenComplex(result: string): string {
  const matches: AncestorMatch[] = [];
  let currentCompound = 0;
  topLevel(result, (index) => {
    const char = result[index];
    if (COMBINATORS.has(char)) {
      currentCompound = index + 1;
      return;
    }
    if (!result.startsWith(":is(", index)) return;
    const end = closingIndex(result, index + 3);
    if (end < 0) return false;
    const test = ancestorTest(result.slice(index + 4, end - 1));
    // Only a test on the first compound moves out unchanged: on a later one,
    // `.a .x:is(B *)` lets B sit above .a, which `.a B .x` would not.
    if (test && currentCompound === 0)
      matches.push({ start: index, end, compoundStart: currentCompound, test });
  });
  const match =
    matches.find(({ test }) => test.compound.includes(":has(")) ?? matches[0];
  if (!match) return result;
  const { compoundStart, test } = match;
  const before = result.slice(compoundStart, match.start);
  const after = result.slice(match.end);
  let subjectEnd = after.length;
  topLevel(after, (index) => {
    if (COMBINATORS.has(after[index])) {
      subjectEnd = index;
      return false;
    }
  });
  const subject = before + after.slice(0, subjectEnd) || "*";
  const separator = test.combinator === " " ? " " : ` ${test.combinator} `;
  return (
    result.slice(0, compoundStart) +
    test.compound +
    separator +
    subject +
    after.slice(subjectEnd)
  );
}

/** Rewrites every complex selector in a selector list; see the module comment. */
export function flattenAncestorTests(selectorList: string): string {
  if (!selectorList.includes(":is(")) return selectorList;
  return splitTopLevel(selectorList, ",")
    .map((selector) => {
      const leading = selector.match(/^\s*/)?.[0] ?? "";
      const trailing = selector.match(/\s*$/)?.[0] ?? "";
      return leading + flattenComplex(selector.trim()) + trailing;
    })
    .join(",");
}

/** PostCSS plugin applying {@link flattenAncestorTests} to every rule. */
export function flattenAncestorTestsPlugin() {
  return {
    postcssPlugin: "pine-flatten-ancestor-tests",
    Rule(rule: { selector: string }) {
      const next = flattenAncestorTests(rule.selector);
      if (next !== rule.selector) rule.selector = next;
    },
  };
}

/**
 * Escape single-dollar pairs that wrap ordinary prose. The streaming Markdown
 * parser treats every non-empty `$...$` pair as inline math in strict mode,
 * which can pair a literal currency symbol with the next dollar in a sentence.
 */
export function escapeProseDollarDelimiters(source: string): string {
  const delimiters = findSingleDollarDelimiters(source);
  const escaped = new Set<number>();

  for (let index = 0; index < delimiters.length - 1;) {
    const open = delimiters[index];
    const close = delimiters[index + 1];
    const content = source.slice(open + 1, close);

    if (content.includes("\n\n") || content.includes("\r\n\r\n")) {
      index++;
      continue;
    }

    if (isLikelyProse(content)) {
      // Keep scanning from the would-be close: it may begin a real formula.
      escaped.add(open);
      index++;
      continue;
    }

    index += 2;
  }

  if (escaped.size === 0) return source;

  let result = source;
  for (const position of [...escaped].sort((left, right) => right - left)) {
    result = `${result.slice(0, position)}\\${result.slice(position)}`;
  }
  return result;
}

function findSingleDollarDelimiters(source: string): number[] {
  const delimiters: number[] = [];
  let fence: { character: string; length: number } | undefined;

  for (let index = 0; index < source.length;) {
    if (index === 0 || source[index - 1] === "\n") {
      const lineEnd = source.indexOf("\n", index);
      const line = source.slice(
        index,
        lineEnd === -1 ? source.length : lineEnd,
      );
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/u);

      if (fence) {
        const closingFence = new RegExp(
          `^ {0,3}${fence.character}{${fence.length},}[\\t ]*\\r?$`,
          "u",
        );
        if (closingFence.test(line)) fence = undefined;
        index = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }

      if (fenceMatch) {
        const marker = fenceMatch[1];
        fence = { character: marker[0], length: marker.length };
        index = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }

      if (/^(?: {4,}|\t)/u.test(line)) {
        index = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }
    }

    if (source[index] === "`") {
      let runEnd = index + 1;
      while (source[runEnd] === "`") runEnd++;
      const run = source.slice(index, runEnd);
      let closeIndex = source.indexOf(run, runEnd);
      while (
        closeIndex !== -1 &&
        (source[closeIndex - 1] === "`" ||
          source[closeIndex + run.length] === "`")
      ) {
        closeIndex = source.indexOf(run, closeIndex + run.length);
      }
      index = closeIndex === -1 ? source.length : closeIndex + run.length;
      continue;
    }

    if (
      source[index] === "$" &&
      source[index + 1] === "$" &&
      !isEscaped(source, index)
    ) {
      const closeIndex = findUnescapedDoubleDollar(source, index + 2);
      index = closeIndex === -1 ? source.length : closeIndex + 2;
      continue;
    }

    if (
      source[index] === "$" &&
      !isEscaped(source, index) &&
      source[index - 1] !== "$" &&
      source[index + 1] !== "$"
    ) {
      delimiters.push(index);
    }
    index++;
  }

  return delimiters;
}

function findUnescapedDoubleDollar(source: string, start: number): number {
  for (let index = start; index < source.length - 1; index++) {
    if (
      source[index] === "$" &&
      source[index + 1] === "$" &&
      !isEscaped(source, index)
    ) {
      return index;
    }
  }
  return -1;
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor--
  ) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function isLikelyProse(content: string): boolean {
  if (/[\\{}^_=<>+*/]/u.test(content)) return false;

  const words = content.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
  if (words.length >= 2 && words.some((word) => word.length > 1)) return true;

  const cjkCharacters =
    content.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    ) ?? [];
  if (cjkCharacters.length >= 2) return true;

  return words.length === 1 && words[0].length > 1 && /^\s|\s$/u.test(content);
}

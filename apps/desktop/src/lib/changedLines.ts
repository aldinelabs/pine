import type { FileLineRange } from "@/shared/projectFiles";

/** Edits beyond this many lines between two versions count as one block. */
const MAX_EDIT_DISTANCE = 500;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Which lines of `after` also appear in `before`, by Myers' shortest edit
 * script. Null when the versions differ by more than `MAX_EDIT_DISTANCE`
 * lines, which would make the diff too slow to run on every save.
 */
function keptLines(before: string[], after: string[]): boolean[] | null {
  const n = before.length;
  const m = after.length;
  const limit = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // Each step keeps only its own diagonals, so memory grows with the edits.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d, offset + d + 1));
        return backtrack(trace, n, m);
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): boolean[] {
  const kept = new Array<boolean>(m).fill(false);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d -= 1) {
    const previous = trace[d - 1];
    const at = (k: number): number => previous[k + d - 1];
    const k = x - y;
    const previousK =
      k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      kept[y] = true;
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    kept[y] = true;
  }
  return kept;
}

/**
 * The 1-based line ranges of `after` that were added or changed since
 * `before`. Lines that were only removed leave nothing to mark.
 */
export function changedLineRanges(
  before: string,
  after: string,
): FileLineRange[] {
  if (before === after) return [];
  const old = splitLines(before);
  const next = splitLines(after);
  // Edits are usually local; matching the shared ends first keeps the diff
  // small for long files.
  let start = 0;
  while (
    start < old.length &&
    start < next.length &&
    old[start] === next[start]
  )
    start += 1;
  let end = 0;
  while (
    end < old.length - start &&
    end < next.length - start &&
    old[old.length - 1 - end] === next[next.length - 1 - end]
  )
    end += 1;
  const middle = next.slice(start, next.length - end);
  const kept =
    keptLines(old.slice(start, old.length - end), middle) ??
    middle.map(() => false);

  const ranges: FileLineRange[] = [];
  kept.forEach((isKept, index) => {
    if (isKept) return;
    const line = start + index + 1;
    const last = ranges.at(-1);
    if (last && last.end === line - 1) last.end = line;
    else ranges.push({ start: line, end: line });
  });
  return ranges;
}

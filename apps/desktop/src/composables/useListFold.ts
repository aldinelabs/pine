import {
  nextTick,
  onScopeDispose,
  shallowRef,
  watch,
  type ComponentPublicInstance,
  type Ref,
} from "vue";
import { prefersReducedMotion } from "@/lib/animateScroll";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";

/** A row of a folding list: `key` names it across updates. */
export interface FoldRow {
  key: string;
  /** A row whose depth changes moved, even when its order did not. */
  depth?: number;
}

/**
 * A row as rendered: `leave` rows are copies of rows that left (or moved
 * away from) their place, folding out there; `renderKey` keeps them apart
 * from the live row of the same key.
 */
export type FoldDisplayRow<T extends FoldRow> = T & {
  renderKey: string;
  motion?: "leave";
};

export interface ListFoldOptions {
  /**
   * False skips this update's motion, as for a session switch or a
   * transcript page arriving. Called once per update, before rendering.
   */
  canAnimate: () => boolean;
  /** The gap between rows, folded with a row so the rows below follow it. */
  gap?: string;
  /**
   * An update that folds more rows than this shows at once: each folding row
   * animates its own height, so hundreds of them relayout the list every
   * frame.
   */
  maxFoldingRows?: number;
}

/** Enough for any folder or burst of files a person follows by eye. */
export const MAX_FOLDING_ROWS = 40;

/**
 * Indexes (into `sequence`) of a longest increasing subsequence: the rows
 * that kept their order. The others moved.
 */
function longestIncreasing(sequence: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(sequence.length).fill(-1);
  sequence.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]] < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const kept = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index])
    kept.add(index);
  return kept;
}

/**
 * Folds rows in where they appear and out where they leave, the way the
 * session list does: Web Animations on each row's height and opacity, so the
 * rows around it follow without measuring or moving anything else. A row
 * that moves folds out at its old place and in at its new one. Rows that
 * leave stay inert while they fold, so they cannot be clicked, dragged or
 * opened in a menu.
 */
export function useListFold<T extends FoldRow>(
  rows: Ref<readonly T[]>,
  options: ListFoldOptions,
) {
  const gap = options.gap ?? "0.125rem";
  const maxFoldingRows = options.maxFoldingRows ?? MAX_FOLDING_ROWS;
  const displayRows = shallowRef<FoldDisplayRow<T>[]>([]);
  const elements = new Map<string, HTMLElement>();
  const animations = new Map<string, Animation>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Rows folding out, each after the rendered row that preceded it (`after`,
   * a render key; null for the top), so rows moving elsewhere do not shift it.
   */
  let leaving: { row: FoldDisplayRow<T>; after: string | null }[] = [];
  let previous: readonly T[] = [];
  let ghostId = 0;
  /** The first rows are shown as they are. */
  let first = true;

  function compose(next: readonly T[]): FoldDisplayRow<T>[] {
    const shown: FoldDisplayRow<T>[] = next.map((row) => ({
      ...row,
      renderKey: row.key,
    }));
    for (const { row, after } of leaving) {
      const index =
        after === null
          ? 0
          : shown.findIndex((candidate) => candidate.renderKey === after) + 1;
      // An anchor that is gone (a ghost that finished) puts it at the end.
      shown.splice(index > 0 || after === null ? index : shown.length, 0, row);
    }
    return shown;
  }

  function fold(
    element: HTMLElement,
    key: string,
    motion: "in" | "out",
    height: string,
  ) {
    const folded = { height: "0px", opacity: 0, marginTop: `-${gap}` };
    const unfolded = { height, opacity: 1, marginTop: "0px" };
    element.style.overflow = "hidden";
    const animation = element.animate(
      motion === "in" ? [folded, unfolded] : [unfolded, folded],
      {
        duration: DURATION_MS,
        easing: EASE_OUT_EXPO,
        fill: motion === "out" ? "forwards" : "none",
      },
    );
    // Cancelling (a newer fold, unmounting) rejects `finished`; nothing waits on it.
    animation.finished.catch(() => undefined);
    animations.set(key, animation);
    if (motion === "in")
      animation.onfinish = () => {
        element.style.overflow = "";
        if (animations.get(key) === animation) animations.delete(key);
      };
  }

  function clearLeaving(): void {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    leaving = [];
  }

  watch(
    rows,
    (next) => {
      // Asked every update, so the caller can follow what changed.
      const allowed = options.canAnimate();
      const animate =
        !first &&
        allowed &&
        !prefersReducedMotion() &&
        typeof Element.prototype.animate === "function";
      const before = previous;
      previous = next;
      first = false;
      if (!animate) {
        clearLeaving();
        displayRows.value = compose(next);
        return;
      }
      const oldIndex = new Map(before.map((row, index) => [row.key, index]));
      const nextKeys = new Set(next.map((row) => row.key));
      // Rows in both lists that kept their order and depth stay put.
      const persisting = next.filter((row) => oldIndex.has(row.key));
      const kept = longestIncreasing(
        persisting.map((row) => oldIndex.get(row.key)!),
      );
      const moved = new Set<string>();
      persisting.forEach((row, index) => {
        if (
          !kept.has(index) ||
          before[oldIndex.get(row.key)!].depth !== row.depth
        )
          moved.add(row.key);
      });
      const entering = new Set(
        next
          .filter((row) => !oldIndex.has(row.key) || moved.has(row.key))
          .map((row) => row.key),
      );
      // Rows that leave or move, from the old rendering. A moved row folds
      // twice: out where it was and in where it lands.
      const rendered = displayRows.value;
      const departing = rendered.filter(
        (shown) =>
          !shown.motion && (!nextKeys.has(shown.key) || moved.has(shown.key)),
      );
      if (entering.size + departing.length > maxFoldingRows) {
        clearLeaving();
        displayRows.value = compose(next);
        return;
      }
      // A row back before it finished leaving no longer leaves.
      leaving = leaving.filter(
        ({ row }) => !nextKeys.has(row.key) || moved.has(row.key),
      );
      // Copies of the rows that leave or move.
      const outgoing = new Map<string, FoldDisplayRow<T>>();
      for (const shown of departing) {
        outgoing.set(shown.renderKey, {
          ...shown,
          renderKey: `leave:${ghostId++}:${shown.key}`,
          motion: "leave",
        });
      }
      const anchored = new Map(
        leaving.map((entry) => [entry.row.renderKey, entry]),
      );
      // What a rendered row is called after this update, if it is still shown.
      const renderedAs = (shown: FoldDisplayRow<T>): string | undefined => {
        if (shown.motion)
          return anchored.has(shown.renderKey) ? shown.renderKey : undefined;
        const ghost = outgoing.get(shown.renderKey);
        if (ghost) return ghost.renderKey;
        return nextKeys.has(shown.key) ? shown.key : undefined;
      };
      const ordered: typeof leaving = [];
      rendered.forEach((shown, index) => {
        const ghost = shown.motion ? anchored.get(shown.renderKey) : undefined;
        const fresh = shown.motion ? undefined : outgoing.get(shown.renderKey);
        if (!ghost && !fresh) return;
        let after: string | null = null;
        for (let back = index - 1; back >= 0; back -= 1) {
          const name = renderedAs(rendered[back]);
          if (name) {
            after = name;
            break;
          }
        }
        ordered.push({ row: ghost?.row ?? fresh!, after });
      });
      leaving = ordered;
      displayRows.value = compose(next);
      if (!entering.size && !outgoing.size) return;
      void nextTick(() => {
        const folds: [HTMLElement, string, "in" | "out"][] = [];
        for (const key of entering) {
          const element = elements.get(key);
          if (element) folds.push([element, key, "in"]);
        }
        for (const ghost of outgoing.values()) {
          const element = elements.get(ghost.renderKey);
          if (element) folds.push([element, ghost.renderKey, "out"]);
          const timer = setTimeout(() => {
            timers.delete(timer);
            animations.delete(ghost.renderKey);
            leaving = leaving.filter((entry) => entry.row !== ghost);
            displayRows.value = compose(previous);
          }, DURATION_MS);
          timers.add(timer);
        }
        // A row still folding from an earlier update is measured unfolded.
        for (const [, key] of folds) animations.get(key)?.cancel();
        // Every height is read before any animation starts: one layout.
        const heights = folds.map(([element]) => `${element.offsetHeight}px`);
        folds.forEach(([element, key, motion], index) =>
          fold(element, key, motion, heights[index]),
        );
      });
    },
    { immediate: true },
  );

  /** Ref callback for a rendered row's element. */
  function setElement(
    renderKey: string,
    element: Element | ComponentPublicInstance | null,
  ): void {
    const node =
      element && "$el" in element ? (element.$el as Element) : element;
    if (node instanceof HTMLElement) elements.set(renderKey, node);
    else elements.delete(renderKey);
  }

  onScopeDispose(() => {
    clearLeaving();
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  });

  return { displayRows, setElement };
}

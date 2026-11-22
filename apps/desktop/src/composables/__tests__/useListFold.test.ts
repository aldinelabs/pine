import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DURATION_MS } from "@/lib/motion";
import { useListFold, type FoldRow } from "../useListFold";

type Row = FoldRow & { depth: number };

function rowsOf(...keys: string[]): Row[] {
  return keys.map((key) => {
    const [name, depth = "0"] = key.split(":");
    return { key: name, depth: Number(depth) };
  });
}

function setup(initial: Row[], canAnimate = () => true) {
  const rows = ref<Row[]>(initial);
  const animate = vi.spyOn(HTMLElement.prototype, "animate");
  const Host = defineComponent(() => {
    const { displayRows, setElement } = useListFold(rows, { canAnimate });
    return () =>
      h(
        "ul",
        displayRows.value.map((row) =>
          h(
            "li",
            {
              key: row.renderKey,
              ref: (element) => setElement(row.renderKey, element as Element),
              "data-motion": row.motion,
            },
            row.key,
          ),
        ),
      );
  });
  const wrapper = mount(Host);
  const shown = () =>
    wrapper
      .findAll("li")
      .map((item) =>
        item.attributes("data-motion") ? `~${item.text()}` : item.text(),
      );
  /** The rows animated since the last call and how. */
  const folds = () => {
    const calls = animate.mock.contexts.map((element, index) => {
      const [from] = animate.mock.calls[index][0] as Keyframe[];
      return `${(element as HTMLElement).textContent}:${from.opacity === 0 ? "in" : "out"}`;
    });
    animate.mockClear();
    return calls;
  };
  return { rows, wrapper, shown, folds };
}

describe("useListFold", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the first rows without folding them in", async () => {
    const { shown, folds } = setup(rowsOf("a", "b"));
    await nextTick();
    expect(shown()).toEqual(["a", "b"]);
    expect(folds()).toEqual([]);
  });

  it("folds new rows in and removed rows out at their place", async () => {
    const { rows, shown, folds } = setup(rowsOf("a", "b", "c"));
    rows.value = rowsOf("new", "a", "c");
    await nextTick();
    await nextTick();
    expect(shown()).toEqual(["new", "a", "~b", "c"]);
    expect(folds().sort()).toEqual(["b:out", "new:in"]);
    vi.advanceTimersByTime(DURATION_MS);
    await nextTick();
    expect(shown()).toEqual(["new", "a", "c"]);
  });

  it("folds a moved row out at its old place and in at the new one", async () => {
    const { rows, shown, folds } = setup(rowsOf("a", "b", "c", "d"));
    rows.value = rowsOf("d", "a", "b", "c");
    await nextTick();
    await nextTick();
    expect(shown()).toEqual(["d", "a", "b", "c", "~d"]);
    expect(folds().sort()).toEqual(["d:in", "d:out"]);
  });

  it("treats a change of depth as a move", async () => {
    const { rows, shown } = setup(rowsOf("f", "a", "b"));
    rows.value = rowsOf("f", "a:1", "b");
    await nextTick();
    expect(shown()).toEqual(["f", "~a", "a", "b"]);
  });

  it("drops a leaving row that comes back", async () => {
    const { rows, shown, folds } = setup(rowsOf("a", "b"));
    rows.value = rowsOf("a");
    await nextTick();
    await nextTick();
    folds();
    rows.value = rowsOf("a", "b");
    await nextTick();
    await nextTick();
    expect(shown()).toEqual(["a", "b"]);
    expect(folds()).toEqual(["b:in"]);
  });

  it("does not animate when the update is quiet or motion is reduced", async () => {
    const quiet = { value: true };
    const { rows, shown, folds } = setup(rowsOf("a"), () => !quiet.value);
    rows.value = rowsOf("b");
    await nextTick();
    expect(shown()).toEqual(["b"]);

    quiet.value = false;
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    rows.value = rowsOf("c");
    await nextTick();
    await nextTick();
    expect(shown()).toEqual(["c"]);
    expect(folds()).toEqual([]);
  });
});

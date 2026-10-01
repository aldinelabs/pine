import { afterEach, expect, it, vi } from "vitest";
import { useFrozenWindowResize } from "../useFrozenWindowResize";

afterEach(() => {
  Reflect.deleteProperty(window, "pine");
});

function installPine(delta: number) {
  const events: string[] = [];
  const commitWindowResize = vi.fn(() => {
    events.push("commit");
    return Promise.resolve();
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      planWindowResize: vi.fn().mockResolvedValue(delta),
      commitWindowResize,
    },
  });
  return { commitWindowResize, events };
}

it("freezes at the widened width before committing an expansion", async () => {
  const { events } = installPine(256);
  const resize = useFrozenWindowResize();
  let frozenDuringCommit: number | null = null;

  const resized = await resize.run(
    { kind: "toggle-right-sidebar", open: true },
    {
      beforeCommit: () => {
        events.push("before");
        frozenDuringCommit = resize.frozenWidth.value;
      },
      onCommitStart: (delta) => events.push(`start ${delta}`),
      afterCommit: () => events.push("after"),
    },
  );

  expect(resized).toBe(true);
  expect(frozenDuringCommit).toBe(window.innerWidth + 256);
  expect(events).toEqual(["before", "commit", "start 256", "after"]);
  expect(resize.frozenWidth.value).toBeNull();
  expect(resize.isResizing.value).toBe(false);
});

it("reports skipped resizes so callers can fall back", async () => {
  const { commitWindowResize } = installPine(0);
  const resize = useFrozenWindowResize();
  const beforeCommit = vi.fn();

  await expect(
    resize.run({ kind: "fit-right-sidebar" }, { beforeCommit }),
  ).resolves.toBe(false);
  expect(beforeCommit).not.toHaveBeenCalled();
  expect(commitWindowResize).not.toHaveBeenCalled();
});

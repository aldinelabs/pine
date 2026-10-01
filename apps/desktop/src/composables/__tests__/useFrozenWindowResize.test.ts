import { afterEach, expect, it, vi } from "vitest";
import {
  useFrozenWindowResize,
  WINDOW_EDGE_LATENCY_MS,
} from "../useFrozenWindowResize";

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

it("aligns matching transitions with the window animation clock", async () => {
  let notifyStarted: (startedAt: number) => void = () => {};
  let finishResize = () => {};
  const unsubscribe = vi.fn();
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      planWindowResize: vi.fn().mockResolvedValue(-256),
      commitWindowResize: vi.fn(
        () => new Promise<void>((resolve) => (finishResize = resolve)),
      ),
      onWindowResizeStarted: vi.fn((listener: (startedAt: number) => void) => {
        notifyStarted = listener;
        return unsubscribe;
      }),
    },
  });
  const onCommitStart = vi.fn();
  const resize = useFrozenWindowResize();

  const running = resize.run(
    { kind: "toggle-right-sidebar", open: false },
    { onCommitStart },
  );
  await vi.waitFor(() =>
    expect(window.pine.commitWindowResize).toHaveBeenCalledOnce(),
  );
  expect(onCommitStart).not.toHaveBeenCalled();

  vi.spyOn(Date, "now").mockReturnValue(1_000);
  notifyStarted(980);
  expect(onCommitStart).toHaveBeenCalledExactlyOnceWith(-256);
  expect(resize.transitionDelay.value).toBe(WINDOW_EDGE_LATENCY_MS - 20);
  vi.restoreAllMocks();

  finishResize();
  await expect(running).resolves.toBe(true);
  expect(unsubscribe).toHaveBeenCalled();
});

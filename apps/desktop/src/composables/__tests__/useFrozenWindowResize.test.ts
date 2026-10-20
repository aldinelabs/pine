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
    { kind: "toggle-sidebar", open: true },
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

it("stays frozen until the page takes the window's new width", async () => {
  const { events } = installPine(256);
  const startWidth = window.innerWidth;
  const resize = useFrozenWindowResize();
  let framesAfterCommit = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    if (events.includes("commit")) {
      framesAfterCommit += 1;
      // The page catches up two frames after the window stops.
      if (framesAfterCommit === 2)
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: startWidth + 256,
        });
      events.push(`frame ${window.innerWidth - startWidth}`);
    }
    callback(0);
    return 0;
  });

  await resize.run(
    { kind: "toggle-sidebar", open: true },
    {
      afterCommit: () => {
        events.push("after");
        expect(resize.frozenWidth.value).toBe(startWidth + 256);
      },
    },
  );

  expect(events.slice(0, 4)).toEqual([
    "commit",
    "frame 0",
    "frame 256",
    "after",
  ]);
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: startWidth,
  });
  vi.restoreAllMocks();
});

it("reports skipped resizes so callers can fall back", async () => {
  const { commitWindowResize } = installPine(0);
  const resize = useFrozenWindowResize();
  const beforeCommit = vi.fn();

  await expect(
    resize.run({ kind: "fit-sidebar", open: true }, { beforeCommit }),
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
    { kind: "toggle-sidebar", open: false },
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

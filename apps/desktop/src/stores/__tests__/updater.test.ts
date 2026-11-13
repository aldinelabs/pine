import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateEventListener } from "@/shared/updates";
import { useUpdaterStore } from "../updater";

const update = {
  changelog: "- Improved updates",
  internalVersion: "abc1234",
  publishedAt: "2026-09-10T12:00:00.000Z",
  version: "1.1.0",
};

describe("updater store", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    window.pine = {
      checkForUpdate: vi.fn().mockResolvedValue({
        status: "available",
        update,
      }),
      downloadUpdate: vi.fn().mockResolvedValue({ ready: true }),
      installUpdate: vi.fn().mockResolvedValue({ started: true }),
      onUpdateEvent: vi.fn(() => () => undefined),
      platform: "darwin",
    } as unknown as typeof window.pine;
  });

  it("refreshes the release before opening and shares concurrent checks", async () => {
    const store = useUpdaterStore();
    await store.check();
    let finish!: (value: {
      status: "available";
      update: typeof update;
    }) => void;
    vi.mocked(window.pine.checkForUpdate!).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = store.openDialog();
    const duplicate = store.check();
    expect(store.isChecking).toBe(true);
    expect(store.isDialogOpen).toBe(false);
    expect(window.pine.checkForUpdate).toHaveBeenCalledTimes(2);
    finish({ status: "available", update: { ...update, version: "1.2.0" } });
    await Promise.all([opening, duplicate]);
    expect(store.update?.version).toBe("1.2.0");
    expect(store.isDialogOpen).toBe(true);
    expect(store.isChecking).toBe(false);
  });

  it("checks every two hours and initializes only once", async () => {
    const store = useUpdaterStore();
    store.initialize();
    store.initialize();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000 - 1);
    expect(window.pine.checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(window.pine.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it("clears a withdrawn release and resets readiness for a newer one", async () => {
    const store = useUpdaterStore();
    await store.check();
    store.phase = "ready";
    store.progress = 100;
    vi.mocked(window.pine.checkForUpdate!).mockResolvedValueOnce({
      status: "available",
      update: { ...update, version: "1.2.0" },
    });
    await store.openDialog();
    expect(store.phase).toBe("available");
    expect(store.progress).toBe(0);
    vi.mocked(window.pine.checkForUpdate!).mockResolvedValueOnce({
      status: "current",
    });
    await store.openDialog();
    expect(store.isDialogOpen).toBe(false);
    expect(store.isAvailable).toBe(false);
    expect(store.phase).toBe("idle");
  });

  it("keeps the downloaded release on failed checks and during downloads", async () => {
    const store = useUpdaterStore();
    await store.check();
    store.phase = "ready";
    vi.mocked(window.pine.checkForUpdate!).mockRejectedValueOnce(
      new Error("offline"),
    );
    await store.openDialog();
    expect(store.phase).toBe("ready");
    expect(store.update).toEqual(update);
    store.phase = "downloading";
    await store.openDialog();
    expect(window.pine.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it("tracks download progress and readiness", () => {
    let listener: UpdateEventListener | undefined;
    window.pine.onUpdateEvent = vi.fn((nextListener) => {
      listener = nextListener;
      return () => undefined;
    });
    const store = useUpdaterStore();
    store.initialize();
    listener?.({
      percent: 42,
      totalBytes: 100,
      transferredBytes: 42,
      type: "download-progress",
    });
    expect(store.progress).toBe(42);
    listener?.({ type: "download-ready" });
    expect(store.phase).toBe("ready");
  });
});

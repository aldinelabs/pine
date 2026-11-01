import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSubscriptions } from "../webSubscriptions";

afterEach(() => vi.useRealTimers());

describe("browser file subscriptions", () => {
  it("unions directory watches and isolates preview IDs between browser tabs", async () => {
    const directories = vi.fn().mockResolvedValue(undefined);
    const preview = vi.fn().mockResolvedValue(undefined);
    const subscriptions = new WebSubscriptions(directories, preview);
    const folder = {
      projectId: "project",
      folderId: "folder",
      directories: [""],
    };
    await subscriptions.directories("first", { folders: [folder] });
    await subscriptions.directories("second", {
      folders: [{ ...folder, directories: ["src"] }],
    });
    expect(directories).toHaveBeenLastCalledWith({
      folders: [{ ...folder, directories: ["", "src"] }],
    });
    await subscriptions.directories("first", { folders: [] });
    expect(directories).toHaveBeenLastCalledWith({
      folders: [{ ...folder, directories: ["src"] }],
    });
    await subscriptions.preview("first", { watchId: "preview", target: null });
    await subscriptions.preview("second", { watchId: "preview", target: null });
    expect(preview).toHaveBeenNthCalledWith(1, {
      watchId: "first/preview",
      target: null,
    });
    expect(preview).toHaveBeenNthCalledWith(2, {
      watchId: "second/preview",
      target: null,
    });
    subscriptions.clear();
  });

  it("preserves watches during reconnection and releases abandoned subscriptions", async () => {
    vi.useFakeTimers();
    const directories = vi.fn().mockResolvedValue(undefined);
    const preview = vi.fn().mockResolvedValue(undefined);
    const subscriptions = new WebSubscriptions(directories, preview);
    const target = { source: "presented" as const, path: "/tmp/image.png" };
    await subscriptions.preview("first", { watchId: "image", target });
    subscriptions.disconnected("first");
    await vi.advanceTimersByTimeAsync(20_000);
    subscriptions.connected("first");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(preview).toHaveBeenCalledOnce();
    subscriptions.disconnected("first");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(preview).toHaveBeenLastCalledWith({
      watchId: "first/image",
      target: null,
    });
    subscriptions.clear();
  });
});

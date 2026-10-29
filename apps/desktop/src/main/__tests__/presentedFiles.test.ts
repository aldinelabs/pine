// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  MAX_PRESENTED_FILES_PER_WINDOW,
  operatePresentedFile,
  PresentedFileRegistry,
} from "../presentedFiles";

describe("presented file grants", () => {
  it("allows only paths remembered for the same window", () => {
    const registry = new PresentedFileRegistry();
    registry.remember(1, "/tmp/report.pdf");
    expect(registry.allows(1, "/tmp/report.pdf")).toBe(true);
    expect(registry.allows(1, "/tmp/other.pdf")).toBe(false);
    expect(registry.allows(2, "/tmp/report.pdf")).toBe(false);
  });

  it("bounds how many grants one window can accumulate", () => {
    const registry = new PresentedFileRegistry();
    for (let index = 0; index < MAX_PRESENTED_FILES_PER_WINDOW + 2; index++) {
      registry.remember(1, `/tmp/file-${index}.txt`);
    }
    expect(registry.allows(1, "/tmp/file-0.txt")).toBe(false);
    expect(registry.allows(1, "/tmp/file-1.txt")).toBe(false);
    expect(registry.allows(1, "/tmp/file-2.txt")).toBe(true);
    expect(
      registry.allows(1, `/tmp/file-${MAX_PRESENTED_FILES_PER_WINDOW + 1}.txt`),
    ).toBe(true);
  });

  it("keeps a re-presented path alive against eviction", () => {
    const registry = new PresentedFileRegistry();
    for (let index = 0; index < MAX_PRESENTED_FILES_PER_WINDOW; index++) {
      registry.remember(1, `/tmp/file-${index}.txt`);
    }
    // Re-presenting the oldest path makes it the newest, so the next insert
    // evicts the path behind it instead.
    registry.remember(1, "/tmp/file-0.txt");
    registry.remember(1, "/tmp/newest.txt");
    expect(registry.allows(1, "/tmp/file-0.txt")).toBe(true);
    expect(registry.allows(1, "/tmp/file-1.txt")).toBe(false);
  });

  it("forgets every grant when a window goes away", () => {
    const registry = new PresentedFileRegistry();
    registry.remember(1, "/tmp/report.pdf");
    registry.forget(1);
    expect(registry.allows(1, "/tmp/report.pdf")).toBe(false);
  });
});

describe("presented file operations", () => {
  function native() {
    return {
      open: vi.fn(() => Promise.resolve("")),
      reveal: vi.fn(),
      copyPath: vi.fn(),
    };
  }

  it("runs each action on the authorized canonical path", async () => {
    const actions = native();
    const authorize = vi.fn(() => Promise.resolve("/private/tmp/report.pdf"));
    for (const action of ["open", "reveal", "copy-path"] as const) {
      await operatePresentedFile(
        { action, path: "/tmp/report.pdf" },
        authorize,
        actions,
      );
    }
    expect(authorize).toHaveBeenCalledWith("/tmp/report.pdf");
    expect(actions.open).toHaveBeenCalledWith("/private/tmp/report.pdf");
    expect(actions.reveal).toHaveBeenCalledWith("/private/tmp/report.pdf");
    expect(actions.copyPath).toHaveBeenCalledWith("/private/tmp/report.pdf");
  });

  it("never acts on a path the window was not granted", async () => {
    const actions = native();
    await expect(
      operatePresentedFile(
        { action: "reveal", path: "/etc/passwd" },
        () => Promise.reject(new Error("not presented")),
        actions,
      ),
    ).rejects.toThrow("not presented");
    expect(actions.reveal).not.toHaveBeenCalled();
  });

  it("rejects actions that would change the file", async () => {
    const actions = native();
    const authorize = vi.fn(() => Promise.resolve("/tmp/report.pdf"));
    await expect(
      operatePresentedFile(
        { action: "trash", path: "/tmp/report.pdf" },
        authorize,
        actions,
      ),
    ).rejects.toThrow();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("reports a failure to open with the default application", async () => {
    const actions = native();
    actions.open.mockResolvedValue("No application found");
    await expect(
      operatePresentedFile(
        { action: "open", path: "/tmp/report.xyz" },
        () => Promise.resolve("/tmp/report.xyz"),
        actions,
      ),
    ).rejects.toThrow("No application found");
  });
});

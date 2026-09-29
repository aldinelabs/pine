import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeDiagnostics } from "../runtimeDiagnostics";

describe("RuntimeDiagnostics", () => {
  let directory: string;
  let diagnostics: RuntimeDiagnostics;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pine-diagnostics-"));
    diagnostics = new RuntimeDiagnostics(directory, true);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await diagnostics.flush();
    await rm(directory, { recursive: true, force: true });
  });

  async function records() {
    await diagnostics.flush();
    return (await readFile(diagnostics.logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("records failures with their channel while preserving the original error", async () => {
    const error = new Error("No project is open in this window.");
    await expect(
      diagnostics.trace("sessions:search", 3, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await records()).toEqual([
      expect.objectContaining({ event: "ipc:start", requestId: 1 }),
      expect.objectContaining({
        event: "ipc:error",
        channel: "sessions:search",
        senderId: 3,
        requestId: 1,
        error: error.message,
      }),
    ]);
  });

  it("observes a stalled request without cancelling it or logging its result", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const pending = diagnostics.trace(
      "projects:open",
      1,
      () => new Promise<string>((done) => (resolve = done)),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await records()).toContainEqual(
      expect.objectContaining({ event: "ipc:pending", requestId: 1 }),
    );
    resolve("private result");
    await expect(pending).resolves.toBe("private result");
    await vi.advanceTimersByTimeAsync(30_000);
    const log = await records();
    expect(log.map((record) => record.event)).toEqual([
      "ipc:start",
      "ipc:pending",
      "ipc:complete",
    ]);
    expect(JSON.stringify(log)).not.toContain("private result");
  });

  it("rotates the log and keeps writing subsequent entries", async () => {
    await writeFile(diagnostics.logPath, "x".repeat(1_048_576));
    diagnostics.record("power:resume");
    expect(await records()).toEqual([
      expect.objectContaining({ event: "power:resume" }),
    ]);
    expect((await readFile(`${diagnostics.logPath}.1`)).length).toBe(1_048_576);
    diagnostics.record("power:suspend");
    expect(await records()).toHaveLength(2);
    await writeFile(diagnostics.logPath, "y".repeat(1_048_576));
    diagnostics.record("power:resume");
    expect(await records()).toHaveLength(1);
    expect(
      (await readFile(`${diagnostics.logPath}.1`, "utf8")).startsWith("y"),
    ).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([
      "runtime-diagnostics.jsonl",
      "runtime-diagnostics.jsonl.1",
    ]);
  });

  it("keeps IPC results available when diagnostics cannot be written", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const blockedDirectory = path.join(directory, "file");
    await writeFile(blockedDirectory, "not a directory");
    diagnostics = new RuntimeDiagnostics(blockedDirectory, true);
    await expect(
      diagnostics.trace("sessions:search", 1, () => ["session"]),
    ).resolves.toEqual(["session"]);
    await diagnostics.flush();
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not create logs by default and still executes requests", async () => {
    diagnostics = new RuntimeDiagnostics(directory);
    diagnostics.record("power:resume");
    await expect(
      diagnostics.trace("sessions:search", 1, () => ["session"]),
    ).resolves.toEqual(["session"]);
    await diagnostics.flush();
    await expect(stat(diagnostics.logPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("drops queued writes when disabled and can resume recording", async () => {
    diagnostics.record("discarded");
    await diagnostics.setEnabled(false);
    diagnostics.record("also-discarded");
    await diagnostics.flush();
    await expect(stat(diagnostics.logPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await diagnostics.setEnabled(true);
    diagnostics.record("power:resume");
    expect(await records()).toEqual([
      expect.objectContaining({ event: "power:resume" }),
    ]);
  });

  it("does not record old request completions after disabling and re-enabling", async () => {
    let resolve!: () => void;
    const pending = diagnostics.trace(
      "projects:open",
      1,
      () => new Promise<void>((done) => (resolve = done)),
    );
    await diagnostics.flush();
    await diagnostics.setEnabled(false);
    await diagnostics.setEnabled(true);
    resolve();
    await pending;
    expect((await records()).map((record) => record.event)).toEqual([
      "ipc:start",
    ]);
  });
});

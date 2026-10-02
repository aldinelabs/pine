import { describe, expect, it } from "vitest";
import {
  backgroundTaskNotificationTask,
  buildCompletionNotification,
  deriveCompletionDeliveryGuidance,
  deriveTaskNameFromCommand,
  formatDuration,
  formatSnapshotList,
  formatSize,
  normalizeMaxBytes,
  prepareBgRunArguments,
  sortTasksForDisplay,
  taskDisplayName,
  MAX_LOG_BYTES,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";
import { parseMessageBlocks, transcriptRole } from "../sessions";

function task(
  overrides: Partial<BackgroundTaskSnapshot> = {},
): BackgroundTaskSnapshot {
  return {
    id: "b1234abcd",
    name: "Dev server",
    command: "bun run dev",
    status: "running",
    outputPath: "/tmp/b1234abcd.output",
    cwd: "/project",
    startTime: 1_000,
    bytesWritten: 0,
    notified: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true,
    privileged: false,
    ...overrides,
  };
}

describe("task names", () => {
  it("names package scripts and falls back to the first words", () => {
    expect(deriveTaskNameFromCommand("bun run dev --port 3000")).toBe(
      "bun run dev",
    );
    expect(deriveTaskNameFromCommand("npm test")).toBe("npm test");
    expect(deriveTaskNameFromCommand("sleep 10 && echo done now ok")).toBe(
      "sleep 10 && echo done",
    );
    expect(deriveTaskNameFromCommand("   ")).toBe("Background task");
  });

  it("prefers the name, then the description, then the command", () => {
    expect(taskDisplayName({ name: " Build ", command: "x" })).toBe("Build");
    expect(taskDisplayName({ description: "Watch files", command: "x" })).toBe(
      "Watch files",
    );
    expect(taskDisplayName({ command: "bun run build" })).toBe("bun run build");
  });
});

describe("bg_run arguments", () => {
  it("derives a missing name and ignores upstream-only flags", () => {
    expect(
      prepareBgRunArguments({
        command: "bun run dev",
        isAgent: false,
        surviveReload: true,
      }),
    ).toEqual({ command: "bun run dev", name: "bun run dev" });
    expect(
      prepareBgRunArguments({
        command: "make",
        description: "Compile everything",
        privileged: true,
        timeoutSeconds: 30,
      }),
    ).toEqual({
      command: "make",
      name: "Compile everything",
      description: "Compile everything",
      privileged: true,
      timeoutSeconds: 30,
    });
  });

  it("rejects calls without a command", () => {
    expect(() => prepareBgRunArguments(undefined)).toThrow("must be an object");
    expect(() => prepareBgRunArguments({ name: "x" })).toThrow(
      "requires command string",
    );
  });
});

describe("formatting", () => {
  it("formats durations and sizes like upstream", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(9_000)).toBe("9s");
    expect(formatDuration(125_000)).toBe("2m5s");
    expect(formatDuration(3_660_000)).toBe("1h1m");
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(2048)).toBe("2.0KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0MB");
  });

  it("clamps the log read size", () => {
    expect(normalizeMaxBytes(undefined)).toBe(MAX_LOG_BYTES);
    expect(normalizeMaxBytes(10)).toBe(10);
    expect(normalizeMaxBytes(10 ** 9)).toBe(MAX_LOG_BYTES);
    expect(normalizeMaxBytes(0)).toBe(1);
  });

  it("lists tasks with their output path", () => {
    expect(formatSnapshotList([])).toBe("No background tasks in this session.");
    const text = formatSnapshotList(
      [
        task({
          status: "failed",
          endTime: 4_000,
          exitCode: 2,
          error: "Exited with code 2",
        }),
      ],
      5_000,
    );
    expect(text).toBe(
      "✗ b1234abcd failed 3s exit=2 — Dev server error=Exited with code 2\n    output: /tmp/b1234abcd.output",
    );
  });

  it("orders running tasks first, then failures, stops, and completions", () => {
    const sorted = sortTasksForDisplay([
      task({ id: "done", status: "completed", endTime: 9 }),
      task({ id: "old-run", status: "running", startTime: 1 }),
      task({ id: "stopped", status: "killed", endTime: 8 }),
      task({ id: "new-run", status: "running", startTime: 5 }),
      task({ id: "bad", status: "failed", endTime: 7 }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual([
      "new-run",
      "old-run",
      "bad",
      "stopped",
      "done",
    ]);
  });
});

describe("completion delivery", () => {
  it("describes the wake-up path the flags actually produce", () => {
    expect(deriveCompletionDeliveryGuidance(true, true).mode).toBe(
      "notification-and-wake",
    );
    expect(deriveCompletionDeliveryGuidance(true, false).mode).toBe(
      "notification-only",
    );
    const manual = deriveCompletionDeliveryGuidance(false, true);
    expect(manual.mode).toBe("manual-monitoring");
    expect(manual.text).toContain("has no effect while notifyOnCompletion");
  });
});

describe("terminal notification", () => {
  it("builds the upstream message with escaped fields", () => {
    const message = buildCompletionNotification(
      task({
        name: "Build <all>",
        status: "failed",
        exitCode: 1,
        error: "Exited with code 1",
      }),
    );
    expect(message.customType).toBe("background-task-notification");
    expect(message.display).toBe(true);
    expect(message.content).toContain("<task-id>b1234abcd</task-id>");
    expect(message.content).toContain(
      "<task-name>Build &lt;all&gt;</task-name>",
    );
    expect(message.content).toContain("<status>failed</status>");
    expect(message.content).toContain("<exit-code>1</exit-code>");
    expect(message.content).toContain("<error>Exited with code 1</error>");
    expect(message.content).toContain(
      "<output-file>/tmp/b1234abcd.output</output-file>",
    );
    expect(message.content.startsWith("<background-task-notification>")).toBe(
      true,
    );
  });

  it("reads the task back from a stored custom message", () => {
    const stored = {
      role: "custom",
      customType: "background-task-notification",
      content: "<background-task-notification/>",
      display: true,
      details: task({ status: "completed", endTime: 2_000 }),
    };
    expect(backgroundTaskNotificationTask(stored)).toMatchObject({
      id: "b1234abcd",
      status: "completed",
    });
    expect(transcriptRole(stored)).toBe("assistant");
    expect(parseMessageBlocks(stored)).toEqual([
      {
        type: "backgroundTask",
        task: expect.objectContaining({ id: "b1234abcd" }),
      },
    ]);
  });

  it("tolerates notifications written by other hosts", () => {
    // Upstream's snapshot has no `privileged` flag or absolute output path.
    const upstream = {
      role: "custom",
      customType: "background-task-notification",
      details: {
        id: "b1",
        command: "sleep 1",
        status: "completed",
        startTime: 1,
        outputPath: ".pi/tasks/b1.output",
      },
    };
    expect(backgroundTaskNotificationTask(upstream)).toMatchObject({
      name: "sleep 1",
      privileged: false,
      bytesWritten: 0,
    });
  });

  it("ignores unrelated and malformed custom messages", () => {
    expect(
      backgroundTaskNotificationTask({ role: "custom", customType: "other" }),
    ).toBeUndefined();
    expect(
      backgroundTaskNotificationTask({
        role: "custom",
        customType: "background-task-notification",
        details: { id: 1 },
      }),
    ).toBeUndefined();
    expect(transcriptRole({ role: "custom", customType: "other" })).toBeNull();
    expect(transcriptRole({ role: "toolResult" })).toBeNull();
    expect(parseMessageBlocks({ role: "custom", customType: "x" })).toEqual([]);
  });
});

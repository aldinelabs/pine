import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  buildNewFileReminder,
  buildRevisionReminder,
  createArtifactRemindersExtension,
  isLikelyDeliverable,
} from "../artifact-reminders";

function submitEntry(paths: string[], isError = false) {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "ui_submit_artifact",
      isError,
      details: { files: paths.map((file) => ({ path: file })), rejected: [] },
    },
  };
}

function setup(branch: unknown[] = []) {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "pine-artifacts-")));
  const handlers = new Map<string, unknown>();
  const activeTools = ["write", "edit", "ui_submit_artifact"];
  const pi = {
    on: (name: string, handler: unknown) => handlers.set(name, handler),
    getActiveTools: () => activeTools,
  } as unknown as ExtensionAPI;
  const extension = createArtifactRemindersExtension({ cwd });
  if (typeof extension !== "object" || !("factory" in extension))
    throw new Error("Expected an inline extension");
  void extension.factory(pi);
  const handler = handlers.get("tool_result") as (
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ) => ToolResultEventResult | undefined;
  const ctx = {
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
  const tool = (overrides: Partial<ToolResultEvent> = {}) =>
    handler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call",
        input: {},
        content: [{ type: "text", text: "original output" }],
        details: undefined,
        isError: false,
        ...overrides,
      },
      ctx,
    );
  const write = (file: string, toolName: "write" | "edit" = "write") =>
    tool({ toolName, input: { path: file } });
  const submit = (paths: string[]) =>
    tool({
      toolName: "ui_submit_artifact",
      details: { files: paths.map((file) => ({ path: file })) },
    });
  const startRun = handlers.get("agent_start") as () => void;
  return { cwd, tool, write, submit, startRun, activeTools };
}

const noteOf = (result: ToolResultEventResult | undefined) =>
  (result?.content?.at(-1) as { text?: string } | undefined)?.text;

describe("artifact reminders", () => {
  it("asks for a resubmission when a submitted file is revised, once per run", () => {
    const branch: unknown[] = [];
    const { cwd, write, startRun } = setup(branch);
    branch.push(submitEntry([path.join(cwd, "report.md")]));

    const result = write("report.md", "edit");
    expect(result?.content?.[0]).toEqual({
      type: "text",
      text: "original output",
    });
    expect(noteOf(result)).toBe(`\n\n${buildRevisionReminder("report.md")}`);
    expect(write("report.md", "edit")).toBeUndefined();

    startRun();
    expect(noteOf(write("report.md", "edit"))).toContain(
      "submit it again with ui_submit_artifact",
    );
  });

  it("stays quiet once the run has resubmitted the file", () => {
    const branch: unknown[] = [];
    const { cwd, write, submit } = setup(branch);
    const report = path.join(cwd, "report.md");
    branch.push(submitEntry([report]));
    submit([report]);
    expect(write("report.md", "edit")).toBeUndefined();
  });

  it("ignores failed submissions when replaying the branch", () => {
    const branch: unknown[] = [];
    const { cwd, write } = setup(branch);
    branch.push(submitEntry([path.join(cwd, "notes.ts")], true));
    expect(write("notes.ts", "edit")).toBeUndefined();
  });

  it("hints once per run at a new document in the project", () => {
    const { write, startRun } = setup();
    expect(noteOf(write("summary.pdf"))).toBe(
      `\n\n${buildNewFileReminder("summary.pdf")}`,
    );
    expect(write("slides.pptx")).toBeUndefined();
    startRun();
    expect(noteOf(write("slides.pptx"))).toContain("Ignore this for scratch");
  });

  it("does not hint at source code, edits, files outside the project or after a submission", () => {
    const { cwd, write, submit } = setup();
    expect(write("src/index.ts")).toBeUndefined();
    expect(write("notes.md", "edit")).toBeUndefined();
    expect(write(path.join(tmpdir(), "scratch.md"))).toBeUndefined();
    submit([path.join(cwd, "other.pdf")]);
    expect(write("summary.pdf")).toBeUndefined();
  });

  it("does nothing without the submit tool or for nested and failed calls", () => {
    const { tool, write, activeTools } = setup();
    const call = (overrides: Partial<ToolResultEvent>) =>
      tool({
        toolName: "write",
        input: { path: "summary.pdf" },
        ...overrides,
      });
    expect(call({ parentToolCallId: "script" })).toBeUndefined();
    expect(call({ isError: true })).toBeUndefined();
    activeTools.splice(activeTools.indexOf("ui_submit_artifact"), 1);
    expect(write("summary.pdf")).toBeUndefined();
    activeTools.push("ui_submit_artifact");
    expect(noteOf(write("summary.pdf"))).toBeDefined();
  });

  it("recognises document and media formats only", () => {
    expect(isLikelyDeliverable("a/Report.PDF")).toBe(true);
    expect(isLikelyDeliverable("deck.pptx")).toBe(true);
    expect(isLikelyDeliverable("photo.png")).toBe(true);
    expect(isLikelyDeliverable("main.ts")).toBe(false);
    expect(isLikelyDeliverable("Makefile")).toBe(false);
  });
});

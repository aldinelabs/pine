import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PineApprovalMode } from "../../../shared/agent";
import type { ToolGate } from "../../gate";
import { PineMemoryRepository } from "../repository";
import {
  createMemoryToolDefinitions,
  memoryWriteNeedsReview,
  type MemoryToolsOptions,
} from "../tools";

describe("memoryWriteNeedsReview", () => {
  it.each<[PineApprovalMode, "project" | "global", boolean, boolean]>([
    ["YOLO", "global", true, false],
    ["let-me-review", "project", false, true],
    ["auto-approve", "project", false, false],
    ["autonomous", "project", false, false],
    ["auto-approve", "global", false, true],
    ["autonomous", "global", false, true],
    ["auto-approve", "project", true, true],
  ])(
    "%s, %s scope, external content %s → %s",
    (mode, scope, external, expected) => {
      expect(memoryWriteNeedsReview(mode, scope, external)).toBe(expected);
    },
  );
});

describe("memory tools", () => {
  let root: string;
  let repository: PineMemoryRepository;
  let reviewPrivilegedCall: ReturnType<typeof vi.fn>;
  let options: MemoryToolsOptions & {
    approvalMode: PineApprovalMode;
    enabled: boolean;
    external: boolean;
  };

  function tool(name: string) {
    const definition = createMemoryToolDefinitions(options).find(
      (candidate) => candidate.name === name,
    );
    if (!definition) throw new Error(`Missing tool ${name}`);
    return (params: Record<string, unknown>) =>
      definition.execute(
        "call-1",
        params,
        undefined,
        undefined,
        undefined as never,
      );
  }

  const note = {
    scope: "project",
    name: "ci",
    description: "CI runs on push",
    content: "Checked in the workflow file.",
    verified: true,
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pine-memory-tools-"));
    repository = new PineMemoryRepository({
      global: path.join(root, "global"),
      project: path.join(root, "project"),
    });
    reviewPrivilegedCall = vi.fn().mockResolvedValue({ kind: "allow" });
    options = {
      approvalMode: "auto-approve",
      enabled: true,
      external: false,
      repository,
      afterExternalContent: () => options.external,
      getApprovalMode: () => options.approvalMode,
      getGate: () => ({ reviewPrivilegedCall }) as unknown as ToolGate,
      isEnabled: () => options.enabled,
      sessionId: () => "session-9",
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves a project note without review in an automatic mode", async () => {
    await tool("memory_save")(note);
    expect(reviewPrivilegedCall).not.toHaveBeenCalled();
    expect(await repository.read("project", "ci")).toMatchObject({
      content: "Checked in the workflow file.",
      sessionId: "session-9",
      verified: true,
    });
  });

  it("reviews a global note and does not save a denied one", async () => {
    reviewPrivilegedCall.mockResolvedValue({ kind: "deny", reason: "No." });
    await expect(
      tool("memory_save")({ ...note, scope: "global" }),
    ).rejects.toThrow("No.");
    expect(reviewPrivilegedCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "memory_save",
        subject: "global memory ci",
        description: "Remember: CI runs on push",
      }),
    );
    expect(await repository.list()).toEqual([]);
  });

  it("reviews a project note after the turn read external content", async () => {
    options.external = true;
    await tool("memory_save")(note);
    expect(reviewPrivilegedCall).toHaveBeenCalledTimes(1);
    expect(reviewPrivilegedCall.mock.calls[0]?.[0].evidence).toContain(
      "web or MCP content",
    );
  });

  it("reads a note by name, project scope first", async () => {
    await tool("memory_save")(note);
    const result = await tool("memory_read")({ name: "ci" });
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(
          /^<memory scope="project" name="ci" verified="true" updated="[^"]+">\nChecked in the workflow file\.\n<\/memory>$/u,
        ),
      },
    ]);
    await expect(tool("memory_read")({ name: "absent" })).rejects.toThrow(
      /no memory note named "absent"/u,
    );
  });

  it("lists every note when no name is given", async () => {
    expect((await tool("memory_read")({})).content).toEqual([
      { type: "text", text: "No notes have been saved." },
    ]);
    await tool("memory_save")({ ...note, verified: false });
    expect((await tool("memory_read")({})).content).toEqual([
      { type: "text", text: "- [project] ci (unverified): CI runs on push" },
    ]);
  });

  it("removes a note and fails for one that is not there", async () => {
    await tool("memory_save")(note);
    await tool("memory_remove")({ scope: "project", name: "ci" });
    expect(await repository.list()).toEqual([]);
    await expect(
      tool("memory_remove")({ scope: "project", name: "ci" }),
    ).rejects.toThrow(/no memory note/u);
  });

  it("refuses every tool while memory is turned off", async () => {
    options.enabled = false;
    await expect(tool("memory_save")(note)).rejects.toThrow(/turned off/u);
    await expect(tool("memory_read")({})).rejects.toThrow(/turned off/u);
    await expect(
      tool("memory_remove")({ scope: "project", name: "ci" }),
    ).rejects.toThrow(/turned off/u);
  });
});

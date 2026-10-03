import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSemanticCompactionExtension } from "../semantic-compaction";

const compactionResult = {
  compaction: {
    firstKeptEntryId: "kept",
    summary:
      "[Session Goal]\n- Fix login\n\n---\n\nUse `vcc_recall` to search for prior work, decisions, and context from before this summary. Do not redo work already\ncompleted.",
  },
};
const contextResult = { messages: [] };

vi.mock("../pi-vcc.js", () => ({
  registerBeforeCompactHook: (pi: ExtensionAPI) => {
    pi.on("session_before_compact", () => compactionResult as never);
    pi.on("context", () => contextResult);
  },
}));

function loadExtension(isEnabled: () => boolean) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  const extension = createSemanticCompactionExtension({
    agentDir: "/agent",
    isEnabled,
  });
  if (typeof extension !== "object" || !("factory" in extension)) {
    throw new Error("Expected an inline extension factory.");
  }
  void extension.factory(pi);
  return handlers;
}

describe("createSemanticCompactionExtension", () => {
  it("only lets pi-vcc compact while the semantic route is selected", async () => {
    let enabled = false;
    const handlers = loadExtension(() => enabled);
    const beforeCompact = handlers.get("session_before_compact");

    await expect(beforeCompact?.()).resolves.toBeUndefined();
    enabled = true;
    await expect(beforeCompact?.()).resolves.toEqual({
      compaction: {
        firstKeptEntryId: "kept",
        summary: "[Session Goal]\n- Fix login",
      },
    });
  });

  it("leaves pi-vcc's other hooks ungated", () => {
    const handlers = loadExtension(() => false);

    expect(handlers.get("context")?.()).toBe(contextResult);
  });
});

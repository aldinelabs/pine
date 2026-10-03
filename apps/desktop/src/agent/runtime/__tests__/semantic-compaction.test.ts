import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSemanticCompactionExtension } from "../semantic-compaction";

const compactionResult = { compaction: { summary: "vcc" } };
const contextResult = { messages: [] };

vi.mock("../pi-vcc.js", () => ({
  registerBeforeCompactHook: (pi: ExtensionAPI) => {
    pi.on("session_before_compact", () => compactionResult as never);
    pi.on("context", () => contextResult);
  },
  registerRecallTool: (pi: ExtensionAPI) => {
    pi.registerTool({ name: "recall" } as never);
  },
}));

function loadExtension(isEnabled: () => boolean) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const tools: string[] = [];
  const pi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    },
    registerTool: (tool: { name: string }) => {
      tools.push(tool.name);
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
  return { handlers, tools };
}

describe("createSemanticCompactionExtension", () => {
  it("only lets pi-vcc compact while the semantic route is selected", () => {
    let enabled = false;
    const { handlers } = loadExtension(() => enabled);
    const beforeCompact = handlers.get("session_before_compact");

    expect(beforeCompact?.()).toBeUndefined();
    enabled = true;
    expect(beforeCompact?.()).toBe(compactionResult);
  });

  it("leaves pi-vcc's other hooks ungated", () => {
    const { handlers } = loadExtension(() => false);

    expect(handlers.get("context")?.()).toBe(contextResult);
  });

  it("registers recall for the runtime to activate by route", () => {
    expect(loadExtension(() => false).tools).toEqual(["recall"]);
  });
});

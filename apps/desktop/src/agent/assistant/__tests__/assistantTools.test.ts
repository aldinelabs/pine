import { describe, expect, it, vi } from "vitest";
import type { AgentHostRequest, AgentHostResponse } from "../../protocol";
import {
  ASSISTANT_BLOCKED_TOOL_REASON,
  ASSISTANT_TOOL_NAMES,
  createAssistantToolDefinitions,
  createAssistantToolGuardExtension,
  isAssistantTool,
} from "../tools";

type ToolCallHandler = (event: { toolName: string }) => unknown;

/** The guard's tool_call handler, taken from its extension factory. */
function guardHandler(): ToolCallHandler {
  let handler: ToolCallHandler | undefined;
  const pi = {
    on: (event: string, listener: ToolCallHandler) => {
      if (event === "tool_call") handler = listener;
    },
  };
  const extension = createAssistantToolGuardExtension() as unknown as {
    factory: (api: typeof pi) => unknown;
  };
  void extension.factory(pi);
  if (!handler) throw new Error("The guard registered no tool_call handler.");
  return handler;
}

function context(
  answer: (request: AgentHostRequest) => AgentHostResponse = () => {
    throw new Error("unexpected host request");
  },
) {
  const requestHost = vi.fn((request: AgentHostRequest) =>
    Promise.resolve(answer(request)),
  );
  return {
    requestHost,
    getApprovalMode: () => "auto-approve" as const,
    getLocale: () => "zh-CN" as const,
  };
}

function tool(name: string, ctx = context()) {
  const found = createAssistantToolDefinitions(ctx).find(
    (definition) => definition.name === name,
  );
  if (!found) throw new Error(`No ${name}`);
  return found;
}

describe("the Assistant's tools", () => {
  it("are exactly the allowlist, in its order", () => {
    expect(
      createAssistantToolDefinitions(context()).map(
        (definition) => definition.name,
      ),
    ).toEqual([...ASSISTANT_TOOL_NAMES]);
  });

  it("include nothing that does work", () => {
    for (const name of [
      "bash",
      "privileged_bash",
      "powershell",
      "read",
      "write",
      "edit",
      "grep",
      "find",
      "ls",
      "bg_run",
      "web_search",
      "web_fetch",
      "ui_session_new",
      "ui_session_send",
      "ui_project_create",
      "memory_save",
      "automation_run_now",
      "activate_computer_use",
      "activate_pine_ops",
      "ui_submit_artifact",
    ])
      expect(isAssistantTool(name)).toBe(false);
  });
});

describe("the Assistant's tool guard", () => {
  it("refuses any tool off the list", () => {
    const handler = guardHandler();
    for (const toolName of ["bash", "write", "mcp__files__write", "x"])
      expect(handler({ toolName })).toEqual({
        block: true,
        reason: ASSISTANT_BLOCKED_TOOL_REASON,
      });
  });

  it("lets every listed tool through", () => {
    const handler = guardHandler();
    for (const toolName of ASSISTANT_TOOL_NAMES)
      expect(handler({ toolName })).toBeUndefined();
  });
});

describe("dispatch_task", () => {
  it("dispatches in the Assistant's own mode by default", async () => {
    const ctx = context(() => ({
      kind: "assistant",
      result: {
        op: "dispatch",
        sessionId: "s-1",
        projectId: "p-1",
        projectName: "Blog",
        approvalMode: "auto-approve",
      },
    }));
    const result = await tool("dispatch_task", ctx).execute(
      "call",
      { projectId: " p-1 ", title: "修首页", message: " 修一下首页样式 " },
      undefined,
      undefined,
      undefined as never,
    );

    expect(ctx.requestHost).toHaveBeenCalledExactlyOnceWith({
      kind: "assistant",
      operation: {
        op: "dispatch",
        projectId: "p-1",
        title: "修首页",
        message: "修一下首页样式",
        approvalMode: "auto-approve",
        locale: "zh-CN",
      },
    });
    expect(JSON.stringify(result.content)).toContain("s-1");
  });

  it("never dispatches a session less supervised than the Assistant", async () => {
    const ctx = context();
    await expect(
      tool("dispatch_task", ctx).execute(
        "call",
        { projectId: "p-1", title: "t", message: "m", approvalMode: "YOLO" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow(/cannot use YOLO/);
    expect(ctx.requestHost).not.toHaveBeenCalled();
  });
});

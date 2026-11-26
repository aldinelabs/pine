import { describe, expect, it, vi } from "vitest";
import type {
  AssistantHostOperation,
  AssistantHostResult,
} from "../../../shared/assistant";
import type {
  AgentHostRequest,
  AgentHostResponse,
  GateDecision,
} from "../../protocol";
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
  decision: GateDecision = { kind: "allow" },
) {
  const requestHost = vi.fn((request: AgentHostRequest) =>
    Promise.resolve(answer(request)),
  );
  const requestApproval = vi.fn(() => Promise.resolve(decision));
  return {
    requestHost,
    requestApproval,
    getApprovalMode: () => "auto-approve" as const,
    getLocale: () => "zh-CN" as const,
  };
}

function run(name: string, ctx: ReturnType<typeof context>, params: object) {
  return tool(name, ctx).execute(
    "call",
    params,
    undefined,
    undefined,
    undefined as never,
  );
}

/** Answers Assistant operations by op; anything else fails the test. */
function assistantHost(
  results: Record<string, (operation: AssistantHostOperation) => unknown>,
) {
  return (request: AgentHostRequest): AgentHostResponse => {
    if (request.kind !== "assistant")
      throw new Error(`unexpected ${request.kind} request`);
    const answer = results[request.operation.op];
    if (!answer) throw new Error(`unexpected ${request.operation.op}`);
    return {
      kind: "assistant",
      result: {
        op: request.operation.op,
        ...(answer(request.operation) as object),
      } as AssistantHostResult,
    };
  };
}

const BLOG = "44444444-4444-4444-8444-444444444444";
const SESSION = "22222222-2222-4222-8222-222222222222";

function sessionFact(dispatched: boolean) {
  return {
    session: {
      sessionId: SESSION,
      projectId: BLOG,
      projectName: "Blog",
      title: "修首页",
      state: "running",
      dispatched,
    },
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

  it("are the same list as before attachments: no file tool came with them", () => {
    expect([...ASSISTANT_TOOL_NAMES]).toEqual([
      "pine_overview",
      "dispatch_task",
      "session_digest",
      "ui_session_search",
      "ui_session_read",
      "ui_session_send",
      "ui_session_stop",
      "ui_session_rename",
      "approvals_list",
      "watch",
      "watch_list",
      "watch_cancel",
      "automation_list",
      "automation_get",
      "automation_set_enabled",
      "automation_run_now",
      "ui_project_list",
      "ui_project_create",
      "ui_project_update",
      "settings_read",
      "datetime",
      "memory_read",
      "memory_save",
      "memory_remove",
      "submit_session_summary",
    ]);
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
      "ui_session_delete",
      "ui_session_organize",
      "ui_project_delete",
      "automation_save",
      "automation_delete",
      "automation_check",
      "activate_automation_authoring",
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
    for (const toolName of [
      "bash",
      "write",
      "mcp__files__write",
      "ui_project_delete",
      "automation_save",
      "x",
    ])
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
  it("passes the attachment ids it names on to Pine, once each", async () => {
    const ctx = context(() => ({
      kind: "assistant",
      result: {
        op: "dispatch",
        sessionId: "s-1",
        projectId: "p-1",
        projectName: "Blog",
        approvalMode: "auto-approve",
        attachments: 1,
      },
    }));
    const result = await run("dispatch_task", ctx, {
      projectId: "p-1",
      title: "看报表",
      message: "分析附件里的报表",
      attachmentIds: [" att_1 ", "att_1", ""],
    });

    expect(ctx.requestHost).toHaveBeenCalledExactlyOnceWith({
      kind: "assistant",
      operation: expect.objectContaining({
        op: "dispatch",
        attachmentIds: ["att_1"],
      }) as unknown,
    });
    expect(JSON.stringify(result.content)).toContain("with 1 attachment");
  });

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

describe("acting on sessions", () => {
  it("sends to a dispatched session without asking", async () => {
    const ctx = context(
      assistantHost({
        session: () => sessionFact(true),
        "session-send": () => ({ delivered: "steer" }),
      }),
    );
    await run("ui_session_send", ctx, {
      projectId: BLOG,
      sessionId: SESSION,
      message: " 顺便把页脚也改了 ",
    });
    expect(ctx.requestApproval).not.toHaveBeenCalled();
    expect(ctx.requestHost).toHaveBeenLastCalledWith({
      kind: "assistant",
      operation: {
        op: "session-send",
        projectId: BLOG,
        sessionId: SESSION,
        message: "顺便把页脚也改了",
        locale: "zh-CN",
        confirmed: false,
      },
    });
  });

  it("asks the user before touching a session it did not dispatch", async () => {
    const ctx = context(
      assistantHost({
        session: () => sessionFact(false),
        "session-stop": () => ({ stopped: true }),
      }),
    );
    await run("ui_session_stop", ctx, { projectId: BLOG, sessionId: SESSION });
    expect(ctx.requestApproval).toHaveBeenCalledOnce();
    expect(ctx.requestHost).toHaveBeenLastCalledWith({
      kind: "assistant",
      operation: {
        op: "session-stop",
        projectId: BLOG,
        sessionId: SESSION,
        confirmed: true,
      },
    });
  });

  it("changes nothing when the user declines", async () => {
    const ctx = context(assistantHost({ session: () => sessionFact(false) }), {
      kind: "deny",
    });
    const result = await run("ui_session_rename", ctx, {
      projectId: BLOG,
      sessionId: SESSION,
      title: "新标题",
    });
    expect(ctx.requestHost).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.content)).toContain("did not rename");
  });
});

describe("automations", () => {
  const detail = (runRefusal?: string) => ({
    automation: {
      id: "a-1",
      projectId: BLOG,
      projectName: "Blog",
      name: "日报",
      status: "active",
      triggers: ["schedule"],
      running: false,
      reads: [],
      writes: [],
      network: [],
      ...(runRefusal ? { runRefusal } : {}),
    },
  });

  it("never turns one on", async () => {
    const ctx = context();
    const result = await run("automation_set_enabled", ctx, {
      projectId: BLOG,
      automationId: "a-1",
      enabled: true,
    });
    expect(ctx.requestHost).not.toHaveBeenCalled();
    expect(JSON.stringify(result.content)).toContain(".auto <name> on");
  });

  it("turns one off", async () => {
    const ctx = context(
      assistantHost({
        "automation-disable": () => ({ name: "日报", changed: true }),
      }),
    );
    await run("automation_set_enabled", ctx, {
      projectId: BLOG,
      automationId: "a-1",
      enabled: false,
    });
    expect(ctx.requestHost).toHaveBeenCalledOnce();
  });

  it("runs one only after the user confirms on a card", async () => {
    const ctx = context(
      assistantHost({
        automation: () => detail(),
        "automation-run": () => ({ name: "日报" }),
      }),
    );
    await run("automation_run_now", ctx, {
      projectId: BLOG,
      automationId: "a-1",
    });
    expect(ctx.requestApproval).toHaveBeenCalledOnce();
    expect(ctx.requestHost).toHaveBeenLastCalledWith({
      kind: "assistant",
      operation: { op: "automation-run", projectId: BLOG, automationId: "a-1" },
    });
  });

  it("does not ask when the WeChat rules refuse the run", async () => {
    const ctx = context(
      assistantHost({ automation: () => detail("It is not on.") }),
    );
    const result = await run("automation_run_now", ctx, {
      projectId: BLOG,
      automationId: "a-1",
    });
    expect(ctx.requestApproval).not.toHaveBeenCalled();
    expect(JSON.stringify(result.content)).toContain("It is not on.");
  });
});

describe("watch", () => {
  it("takes exactly one of at, schedule or sessionId", async () => {
    const ctx = context();
    await expect(
      run("watch", ctx, {
        label: "看周报",
        at: "2026-11-25T09:00:00+08:00",
        schedule: "FREQ=DAILY",
      }),
    ).rejects.toThrow(/exactly one/);
    await expect(run("watch", ctx, { label: "看周报" })).rejects.toThrow(
      /exactly one/,
    );
    expect(ctx.requestHost).not.toHaveBeenCalled();
  });

  it("asks main for a recurring briefing", async () => {
    const ctx = context(
      assistantHost({
        "watch-create": (operation) => ({
          watch: {
            id: "w-1",
            label: "每日简报",
            trigger: {
              kind: "schedule",
              rrule: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
              timezone: "Asia/Shanghai",
            },
            source: "wechat",
            createdAt: "2026-11-24T00:00:00.000Z",
            nextAt: "2026-11-24T10:00:00.000Z",
            operation,
          },
        }),
      }),
    );
    const result = await run("watch", ctx, {
      label: "每日简报",
      schedule: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
      timezone: "Asia/Shanghai",
    });
    expect(ctx.requestHost).toHaveBeenCalledWith({
      kind: "assistant",
      operation: {
        op: "watch-create",
        label: "每日简报",
        trigger: {
          kind: "schedule",
          rrule: "FREQ=DAILY;BYHOUR=18;BYMINUTE=0",
          timezone: "Asia/Shanghai",
        },
      },
    });
    expect(JSON.stringify(result.content)).toContain("w-1");
  });
});

describe("projects", () => {
  it("creates one only after the user confirms on a card", async () => {
    const ctx = context((request) => {
      if (request.kind !== "project") throw new Error(request.kind);
      return {
        kind: "project",
        result: { op: "create", projectId: BLOG, projectName: "Blog" },
      };
    });
    await run("ui_project_create", ctx, {
      name: "Blog",
      folders: [{ path: "/Users/me/blog" }],
    });
    expect(ctx.requestApproval).toHaveBeenCalledOnce();
  });

  it("has no delete, and no prompt notes about one", () => {
    const tools = createAssistantToolDefinitions(context());
    for (const definition of tools)
      expect(
        JSON.stringify({
          description: definition.description,
          snippet: definition.promptSnippet,
          guidelines: definition.promptGuidelines,
        }),
      ).not.toContain("ui_project_delete");
  });
});

describe("approvals_list", () => {
  it("lists cards read only, with their WeChat numbers", async () => {
    const ctx = context(
      assistantHost({
        approvals: () => ({
          approvals: [
            {
              kind: "approval",
              projectId: BLOG,
              projectName: "Blog",
              sessionId: SESSION,
              sessionTitle: "修首页",
              what: "bash",
              subject: "rm -rf build",
              since: "2026-11-24T00:00:00.000Z",
              wechatCard: 12,
            },
          ],
        }),
      }),
    );
    const result = await run("approvals_list", ctx, {});
    const body = JSON.stringify(result.content);
    expect(body).toContain("WeChat card 12");
    expect(body).toContain("Only the user decides");
  });
});

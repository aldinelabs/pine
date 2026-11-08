import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentSession,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachedPathsFromSessionEntries,
  authorizationGrantsFromSessionEntries,
  buildGateTurnContext,
  computerUseActiveFromSessionEntries,
  mediaGenerationActiveFromSessionEntries,
  skillAuthoringActiveFromSessionEntries,
  judgeStreamOptions,
  normalizeGeneratedTitle,
  parseJudgeRulings,
  PineAgentRuntime,
  getLatestCacheHitRate,
  projectSessionDirectory,
  recommendedCompactionReserveTokens,
  titleFromAssistantMessage,
  announcedApprovalMode,
  toolNamesForTinyFishCredential,
  toolNamesForComputerUseState,
  toolNamesForMediaGenerationState,
  toolNamesForSkillAuthoringState,
} from "../runtime";
import { PINE_APPROVAL_MODE_NOTICE } from "../runtime/session-state";
import type { JudgeRequest, JudgeRuling, UserApprovalRequest } from "../gate";
import type { LiveAgentSession } from "../runtime/session-state";
import type { GateDecision } from "../protocol";
import type { PineAgentEvent } from "../../shared/agent";
import { PINE_APPROVAL_DECISION_ENTRY } from "../../shared/sessions";
import { serializeAttachmentMessage } from "../../shared/attachments";
import { ACTIVATE_COMPUTER_USE_TOOL_NAME } from "../computer-use/tools";
import { UI_WORKBENCH_STATE_TOOL_NAME } from "../../shared/workbench";
import { TODO_REMINDER_HEADING } from "../runtime/progress-reminders";

const temporaryDirectories: string[] = [];

function assistantMessage(
  input: number,
  cacheRead: number,
  cacheWrite: number,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "test",
    model: "test-model",
    usage: {
      input,
      output: 0,
      cacheRead,
      cacheWrite,
      totalTokens: input + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("getLatestCacheHitRate", () => {
  it("uses the latest assistant request and accepts an unpersisted message", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "assistant-1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: assistantMessage(100, 300, 100),
      },
    ];
    const current = assistantMessage(100, 700, 100);

    expect(getLatestCacheHitRate(entries)).toBeCloseTo(60);
    expect(getLatestCacheHitRate(entries, current)).toBeCloseTo(77.8, 1);
  });

  it("returns null when no assistant request has usable prompt tokens", () => {
    expect(
      getLatestCacheHitRate([
        {
          type: "message",
          id: "assistant-1",
          parentId: null,
          timestamp: new Date().toISOString(),
          message: assistantMessage(0, 0, 0),
        },
      ]),
    ).toBeNull();
  });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("attachedPathsFromSessionEntries", () => {
  it("restores only attachment blocks from user messages", () => {
    const attachment = {
      extension: "txt",
      kind: "file" as const,
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "context.txt",
      path: "/tmp/context.txt",
      size: 12,
    };
    const block = serializeAttachmentMessage([attachment], "Read it.");

    expect(
      attachedPathsFromSessionEntries([
        { type: "message", message: { role: "user", content: block } },
        { type: "message", message: { role: "assistant", content: block } },
        {
          type: "message",
          message: { role: "user", content: [{ type: "text", text: block }] },
        },
      ]),
    ).toEqual(["/tmp/context.txt"]);
  });
});

describe("approval context", () => {
  it("keeps user authority and causal events without exposing raw thinking", () => {
    const entries = [
      {
        type: "message",
        id: "user-root",
        message: { role: "user", content: "Refactor the approval flow." },
      },
      {
        type: "message",
        id: "assistant-1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private chain of thought" },
            { type: "text", text: "I will inspect the gate." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "bash",
              arguments: { command: "bun test" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "tool-result-1",
        message: {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "bash",
          content: [{ type: "text", text: "permission denied" }],
          isError: true,
        },
      },
      {
        type: "message",
        id: "user-latest",
        message: { role: "user", content: "Proceed with steps one to four." },
      },
    ] as never[];

    const context = buildGateTurnContext(entries, []);

    expect(context.rootGoal).toEqual({
      id: "user-root",
      text: "Refactor the approval flow.",
    });
    expect(context.recentUserStatements).toEqual([
      { id: "user-latest", text: "Proceed with steps one to four." },
    ]);
    expect(JSON.stringify(context)).toContain("I will inspect the gate");
    expect(JSON.stringify(context)).toContain("permission denied");
    expect(JSON.stringify(context)).not.toContain("private chain of thought");
  });

  it("restores only validated authorization grant entries", () => {
    const grant = {
      id: "grant-1",
      source: "user" as const,
      scope: "once" as const,
      toolName: "privileged_bash",
      subject: "open -a Finder",
      actionDigest: "abc123",
      createdAt: "2026-09-11T00:00:00.000Z",
    };
    expect(
      authorizationGrantsFromSessionEntries([
        {
          type: "custom",
          customType: "pine.authorization-grant",
          data: grant,
        },
        {
          type: "custom",
          customType: "pine.authorization-grant",
          data: { subject: "incomplete" },
        },
      ]),
    ).toEqual([grant]);
  });

  it("keeps older events that match the reviewed subject", () => {
    const entries = [
      {
        type: "message",
        id: "root",
        message: { role: "user", content: "Diagnose the build." },
      },
      {
        type: "message",
        id: "relevant-old-event",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "The failing target is packages/compiler." },
          ],
        },
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        type: "message",
        id: `recent-${index}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `Unrelated event ${index}` }],
        },
      })),
    ] as never[];

    const context = buildGateTurnContext(entries, [], undefined, [
      "rm -rf packages/compiler",
    ]);

    expect(context.recentEvents.map((event) => event.id)).toContain(
      "relevant-old-event",
    );
  });
});

describe("judgeStreamOptions", () => {
  const signal = new AbortController().signal;
  const modelWithApi = (api: Api) => ({ api }) as unknown as Model<Api>;

  it("disables reasoning wherever the API exposes a switch", () => {
    expect(
      judgeStreamOptions(modelWithApi("anthropic-messages"), signal),
    ).toEqual({ signal, thinkingEnabled: false });
    expect(
      judgeStreamOptions(modelWithApi("openai-responses"), signal),
    ).toEqual({ signal, reasoningEffort: "minimal" });
    // Omitting options is the off state for completions-family formats;
    // passing an effort would enable thinking.
    expect(
      judgeStreamOptions(modelWithApi("openai-completions"), signal),
    ).toEqual({ signal });
  });
});

describe("normalizeGeneratedTitle", () => {
  it("keeps only a bounded, unquoted first line", () => {
    expect(normalizeGeneratedTitle('  "初始会话标题。"\n额外解释')).toBe(
      "初始会话标题",
    );
    expect(normalizeGeneratedTitle(" ")).toBeUndefined();
    expect([...normalizeGeneratedTitle("a".repeat(80))!]).toHaveLength(60);
  });

  it("preserves complete Chinese, English, and mixed-language titles", () => {
    for (const title of [
      "编码任务与操作任务的区别",
      "循环变换器与 GPT-6 新模型对比",
      "Improve TinyFish web search support for Pine",
    ]) {
      expect(normalizeGeneratedTitle(title)).toBe(title);
    }
  });
});

describe("recommendedCompactionReserveTokens", () => {
  it("triggers at 80% for ordinary context windows", () => {
    expect(recommendedCompactionReserveTokens(128_000)).toBe(25_600);
    expect(recommendedCompactionReserveTokens(400_000)).toBe(80_000);
  });

  it("caps the trigger threshold at 400K tokens", () => {
    expect(recommendedCompactionReserveTokens(1_000_000)).toBe(600_000);
  });
});

describe("titleFromAssistantMessage", () => {
  it("accepts only the structured submit_title tool result", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "title-call",
          name: "submit_title",
          arguments: { title: "Dedicated Utility Model" },
        },
      ],
    } as unknown as AssistantMessage;

    expect(titleFromAssistantMessage(message)).toBe("Dedicated Utility Model");
    expect(
      titleFromAssistantMessage({
        ...message,
        content: [{ type: "text", text: "Unexpected prose" }],
      }),
    ).toBeUndefined();
    expect(
      titleFromAssistantMessage({
        ...message,
        content: [
          {
            type: "toolCall",
            id: "title-call",
            name: "submit_title",
            arguments: { title: "Title", explanation: "Unexpected" },
          },
        ],
      } as unknown as AssistantMessage),
    ).toBeUndefined();
  });
});

describe("toolNamesForTinyFishCredential", () => {
  it("only exposes TinyFish tools when a credential is configured", () => {
    const activeTools = [
      "read",
      "bash",
      "edit",
      "write",
      "web_search",
      "web_fetch",
      "privileged_bash",
    ];
    expect(toolNamesForTinyFishCredential(activeTools, false)).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "privileged_bash",
    ]);
    expect(toolNamesForTinyFishCredential(activeTools, true)).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "privileged_bash",
      "web_search",
      "web_fetch",
    ]);
  });
});

describe("announcedApprovalMode", () => {
  it("returns the most recent permission mode notice", () => {
    expect(announcedApprovalMode([])).toBeUndefined();
    expect(
      announcedApprovalMode([
        {
          role: "custom",
          customType: PINE_APPROVAL_MODE_NOTICE,
          details: { approvalMode: "auto-approve" },
        },
        { role: "user", content: "hi" },
        {
          role: "custom",
          customType: PINE_APPROVAL_MODE_NOTICE,
          details: { approvalMode: "YOLO" },
        },
        { role: "custom", customType: "other", details: {} },
      ]),
    ).toBe("YOLO");
  });
});

describe("toolNamesForComputerUseState", () => {
  const tools = [
    "read",
    "activate_computer_use",
    "request_computer_use_permissions",
    "list_apps",
    "browser_open_tab",
  ];

  it("keeps only the activator visible before Computer Use is activated", () => {
    expect(toolNamesForComputerUseState(tools, false)).toEqual([
      "read",
      "activate_computer_use",
    ]);
  });

  it("restores every registered Computer Use tool after activation", () => {
    expect(toolNamesForComputerUseState(tools, true)).toEqual(tools);
  });

  it("restores activation from session metadata", () => {
    expect(
      computerUseActiveFromSessionEntries([
        {
          type: "custom",
          customType: "pine.computer-use-active",
          data: { active: true },
        },
      ]),
    ).toBe(true);
    expect(
      computerUseActiveFromSessionEntries([
        {
          type: "custom",
          customType: "pine.computer-use-active",
          data: { active: false },
        },
      ]),
    ).toBe(false);
  });
});

describe("toolNamesForSkillAuthoringState", () => {
  const tools = [
    "read",
    "invoke_skill",
    "activate_skill_authoring",
    "create_skill",
    "edit_skill",
    "remove_skill",
  ];

  it("keeps invocation and activation visible before authoring is activated", () => {
    expect(toolNamesForSkillAuthoringState(tools, false)).toEqual([
      "read",
      "invoke_skill",
      "activate_skill_authoring",
    ]);
  });

  it("restores mutation tools from session metadata", () => {
    expect(toolNamesForSkillAuthoringState(tools, true)).toEqual(tools);
    expect(
      skillAuthoringActiveFromSessionEntries([
        {
          type: "custom",
          customType: "pine.skill-authoring-active",
          data: { active: true },
        },
      ]),
    ).toBe(true);
  });
});

describe("toolNamesForMediaGenerationState", () => {
  const tools = [
    "read",
    "activate_media_generation",
    "generate_image",
    "web_search",
  ];

  it("keeps only the activator visible before media generation is activated", () => {
    expect(toolNamesForMediaGenerationState(tools, false)).toEqual([
      "read",
      "activate_media_generation",
      "web_search",
    ]);
  });

  it("restores the image tool after activation", () => {
    expect(toolNamesForMediaGenerationState(tools, true)).toEqual(tools);
  });

  it("restores activation from session metadata", () => {
    expect(
      mediaGenerationActiveFromSessionEntries([
        {
          type: "custom",
          customType: "pine.media-generation-active",
          data: { active: true },
        },
      ]),
    ).toBe(true);
    expect(
      mediaGenerationActiveFromSessionEntries([
        {
          type: "custom",
          customType: "pine.media-generation-active",
          data: { active: false },
        },
      ]),
    ).toBe(false);
  });
});

describe("parseJudgeRulings", () => {
  it("parses one ordered ruling for every expected tool call", () => {
    expect(
      parseJudgeRulings(
        {
          rulings: [
            {
              toolCallId: "p2",
              verdict: "deny",
              reason: " unsafe ",
            },
            {
              toolCallId: "p1",
              verdict: "needs_user",
              reason: " expected ",
              scope: "once",
            },
          ],
        },
        ["p1", "p2"],
      ),
    ).toEqual([
      { toolCallId: "p2", verdict: "deny", reason: "unsafe" },
      {
        toolCallId: "p1",
        verdict: "needs_user",
        reason: "expected",
        scope: "once",
      },
    ]);
  });

  it("rejects omitted, duplicate, and unknown tool call IDs", () => {
    expect(() =>
      parseJudgeRulings({ rulings: [{ toolCallId: "p1", verdict: "allow" }] }, [
        "p1",
        "p2",
      ]),
    ).toThrow("one ruling per tool call");
    expect(() =>
      parseJudgeRulings(
        {
          rulings: [
            { toolCallId: "p1", verdict: "allow" },
            { toolCallId: "p1", verdict: "deny" },
          ],
        },
        ["p1", "p2"],
      ),
    ).toThrow("malformed");
    expect(() =>
      parseJudgeRulings(
        { rulings: [{ toolCallId: "unknown", verdict: "allow" }] },
        ["p1"],
      ),
    ).toThrow("malformed");
  });
});

describe("PineAgentRuntime", () => {
  it("keeps failed reviewer history through the manual decision and its persisted record", async () => {
    const emit = vi.fn();
    const runtime = new PineAgentRuntime({ emit });
    const internals = runtime as unknown as {
      requestUserApproval: (
        live: LiveAgentSession,
        request: UserApprovalRequest,
      ) => Promise<GateDecision>;
    };
    const appendCustomEntry = vi.fn();
    const live = {
      session: {
        sessionId: "manual-session",
        sessionManager: { appendCustomEntry },
      },
    } as unknown as LiveAgentSession;
    const reviews = [
      {
        kind: "model" as const,
        modelId: "failed-reviewer",
        outcome: "error" as const,
        reason: "Provider unavailable",
      },
    ];
    try {
      const result = internals.requestUserApproval(live, {
        toolCallId: "reviewed",
        toolName: "bash",
        trigger: "privileged-execution",
        reviews,
      });
      const event = emit.mock.calls[0][0] as Extract<
        PineAgentEvent,
        { type: "approval-request" }
      >;
      expect(event).toMatchObject({ type: "approval-request", reviews });
      expect(
        runtime.resolveApproval(event.requestId, {
          kind: "deny",
          reason: "Stop",
        }),
      ).toEqual({ accepted: true });
      await expect(result).resolves.toEqual({ kind: "deny", reason: "Stop" });
      expect(appendCustomEntry).toHaveBeenCalledWith(
        PINE_APPROVAL_DECISION_ENTRY,
        expect.objectContaining({ decidedBy: "user", reviews }),
      );
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "approval-decided",
          decidedBy: "user",
          reviews,
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it.each([false, true])(
    "records the resolved review model on success or provider failure: %s",
    async (fails) => {
      const runtime = new PineAgentRuntime({ emit: () => undefined });
      const internals = runtime as unknown as {
        getModelRuntime: () => Promise<unknown>;
        modelService: { approvalModel: () => Promise<unknown> };
        runModelJudge: (
          live: { agentDir: string; approvalMode: string },
          requests: JudgeRequest[],
          signal: AbortSignal,
        ) => Promise<JudgeRuling[]>;
      };
      const model = {
        id: "resolved-reviewer",
        name: "Resolved reviewer",
        provider: "custom-provider",
        api: "openai-completions",
      };
      internals.modelService.approvalModel = vi.fn().mockResolvedValue(model);
      internals.getModelRuntime = vi.fn().mockResolvedValue({
        stream: function* () {
          if (fails) throw new Error("Provider unavailable");
          yield {
            type: "done",
            message: {
              content: [
                {
                  type: "toolCall",
                  name: "submit_ruling",
                  arguments: {
                    rulings: [{ toolCallId: "reviewed", verdict: "allow" }],
                  },
                },
              ],
            },
          };
        },
      });
      const onReview = vi.fn();
      try {
        const result = internals.runModelJudge(
          { agentDir: "/unused", approvalMode: "auto-approve" },
          [
            {
              toolCallId: "reviewed",
              toolName: "bash",
              trigger: "privileged-execution",
              subject: "bun test",
              turn: { recentUserStatements: [], recentEvents: [], grants: [] },
              onReview,
            },
          ],
          new AbortController().signal,
        );
        if (fails) await expect(result).rejects.toThrow("Provider unavailable");
        else
          await expect(result).resolves.toMatchObject([{ verdict: "allow" }]);
        expect(onReview).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            kind: "model",
            providerId: "custom-provider",
            modelId: "resolved-reviewer",
            modelName: "Resolved reviewer",
            outcome: fails ? "error" : "allow",
          }),
        );
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("delivers workbench state and recurring todo reminders through real Pi turns", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-progress-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [{ access: "read-write" as const, path: root }],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.agentDir, { recursive: true });
    await mkdir(location.cwd, { recursive: true });
    await writeFile(
      path.join(location.agentDir, "models.json"),
      JSON.stringify({
        providers: {
          verify: {
            api: "openai-completions",
            apiKey: "verify-key",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [{ id: "progress", input: ["text"] }],
          },
        },
      }),
    );
    await writeFile(
      path.join(location.agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "verify", defaultModel: "progress" }),
    );
    const state = {
      open: true,
      visible: false,
      top: "files" as const,
      bottom: "preview" as const,
      split: 65,
    };
    const runtime = new PineAgentRuntime({
      emit: (event) => {
        if (event.type !== "host-request") return;
        expect(event.request).toEqual({ kind: "workbench-state" });
        runtime.resolveHostRequest(event.requestId, {
          ok: true,
          response: { kind: "workbench-state", state },
        });
      },
    });
    try {
      const created = await runtime.createSession(location);
      const { session } = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions.get(created.session.id)!;
      session.setSessionName("Progress reminder regression");
      expect(session.getActiveToolNames()).toContain(
        UI_WORKBENCH_STATE_TOOL_NAME,
      );
      const reminderCounts: number[] = [];
      // The first turn creates the list the reminders report on.
      const toolsToRun = 33;
      session.agent.streamFunction = (model, context) => {
        reminderCounts.push(
          context.messages.filter(
            (message) =>
              message.role === "toolResult" &&
              message.content.some(
                (block) =>
                  block.type === "text" &&
                  block.text.includes(TODO_REMINDER_HEADING),
              ),
          ).length,
        );
        const toolTurn = reminderCounts.length <= toolsToRun;
        const stopReason = toolTurn ? "toolUse" : "stop";
        const response: AssistantMessage = {
          ...assistantMessage(100, 0, 0),
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason,
          content: toolTurn
            ? [
                reminderCounts.length === 1
                  ? {
                      type: "toolCall",
                      id: "todo-create",
                      name: "todo",
                      arguments: {
                        action: "create",
                        tasks: [
                          { subject: "Check progress", dependsOn: [] },
                          { subject: "Report", dependsOn: [1] },
                        ],
                      },
                    }
                  : {
                      type: "toolCall",
                      id: `state-${reminderCounts.length}`,
                      name: UI_WORKBENCH_STATE_TOOL_NAME,
                      arguments: {},
                    },
              ]
            : [{ type: "text", text: "Done." }],
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: response });
        stream.push({
          type: "done",
          reason: stopReason,
          message: response,
        });
        stream.end();
        return stream;
      };
      await session.prompt("Check progress over several steps.");
      expect(reminderCounts).toHaveLength(toolsToRun + 1);
      expect(reminderCounts[16]).toBe(0);
      expect(reminderCounts[17]).toBe(1);
      expect(reminderCounts[toolsToRun - 1]).toBe(1);
      expect(reminderCounts[toolsToRun]).toBe(2);
      const results = session.messages.filter(
        (message) => message.role === "toolResult",
      );
      expect(results).toHaveLength(toolsToRun);
      expect(results[0]?.isError).toBe(false);
      for (const result of results.slice(1)) {
        expect(result.isError).toBe(false);
        expect(result.details).toEqual({ state });
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("pre-activates authoring through a session mutator before the first message", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-mutator-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [{ access: "read-write" as const, path: root }],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.agentDir, { recursive: true });
    await mkdir(location.cwd, { recursive: true });
    await writeFile(
      path.join(location.agentDir, "models.json"),
      JSON.stringify({
        providers: {
          verify: {
            api: "openai-completions",
            apiKey: "verify-key",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [{ id: "mutator", input: ["text"] }],
          },
        },
      }),
    );
    await writeFile(
      path.join(location.agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "verify", defaultModel: "mutator" }),
    );
    const runtime = new PineAgentRuntime({
      emit: (event) => {
        if (event.type !== "host-request") return;
        runtime.resolveHostRequest(event.requestId, {
          ok: false,
          error: "not needed",
        });
      },
    });
    try {
      const created = await runtime.createSession(location);
      const { session } = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions.get(created.session.id)!;
      expect(session.getActiveToolNames()).toContain("activate_mcp_authoring");
      expect(session.getActiveToolNames()).not.toContain("mcp_config_save");

      const mutator = {
        kind: "activate-authoring" as const,
        target: "mcp" as const,
      };
      await expect(
        runtime.mutateSession(created.session.id, [mutator, mutator]),
      ).resolves.toEqual({ applied: [mutator] });
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining([
          "mcp_config_list",
          "mcp_config_save",
          "mcp_config_set_enabled",
          "mcp_config_remove",
        ]),
      );
      expect(
        session.sessionManager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "custom" &&
              entry.customType === "pine.mcp-authoring-active",
          ),
      ).toBe(true);
      // Already active: nothing more is added.
      await expect(
        runtime.mutateSession(created.session.id, [mutator]),
      ).resolves.toEqual({ applied: [] });

      let firstContext = "";
      session.agent.streamFunction = (model, context) => {
        firstContext ||= JSON.stringify(context.messages);
        const response: AssistantMessage = {
          ...assistantMessage(100, 0, 0),
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason: "stop",
          content: [{ type: "text", text: "Which server?" }],
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: response });
        stream.push({ type: "done", reason: "stop", message: response });
        stream.end();
        return stream;
      };
      await session.prompt("Add the GitHub MCP server.");
      expect(firstContext).toContain("<mcp_authoring>");
      expect(firstContext).toContain("~/.config/mcp/mcp.json");
      expect(firstContext).toContain("Add the GitHub MCP server.");
      expect(
        session.messages.filter(
          (message) =>
            message.role === "custom" &&
            message.customType === "pine.session-mutation",
        ),
      ).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("limits an automation run to its approved tools and the report tool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-automation-run-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [{ access: "read-write" as const, path: root }],
      sessionsRoot: path.join(root, "sessions"),
      approvalMode: "autonomous" as const,
      automation: {
        automationId: "automation-1",
        runId: "run-1",
        name: "Daily summary",
        network: [],
        secrets: [],
        toolNames: ["read", "write"],
        payload: null,
      },
    };
    await mkdir(location.agentDir, { recursive: true });
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });
    try {
      const created = await runtime.createSession(location);
      const { session } = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions.get(created.session.id)!;
      expect([...session.getActiveToolNames()].sort()).toEqual([
        "automation_report",
        "read",
        "write",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("automatically compacts a resumed 1M session above 400K after settings saves and MCP reload", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-compaction-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [{ access: "read-write" as const, path: root }],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.agentDir, { recursive: true });
    await mkdir(location.cwd, { recursive: true });
    await writeFile(
      path.join(location.agentDir, "models.json"),
      JSON.stringify({
        providers: {
          verify: {
            api: "openai-completions",
            apiKey: "verify-key",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [
              {
                id: "large",
                name: "Large context regression model",
                contextWindow: 1_000_000,
                maxTokens: 8_192,
                input: ["text"],
              },
            ],
          },
        },
      }),
    );
    await writeFile(
      path.join(location.agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "verify",
        defaultModel: "large",
        compaction: { keepRecentTokens: 8 },
      }),
    );
    // Main answers the turn's location lookup; no estimate is available here.
    const runtime: PineAgentRuntime = new PineAgentRuntime({
      emit: (event) => {
        if (event.type === "host-request")
          runtime.resolveHostRequest(event.requestId, {
            ok: true,
            response: { kind: "approximate-location", location: null },
          });
      },
    });
    try {
      const created = await runtime.createSession(location);
      const internals = runtime as unknown as {
        liveSessions: Map<string, { session: AgentSession }>;
      };
      const session = internals.liveSessions.get(created.session.id)!.session;
      expect(session.model?.contextWindow).toBe(1_000_000);
      session.setSessionName("Compaction regression");
      session.sessionManager.appendMessage({
        role: "user",
        content: "Earlier request. ".repeat(100),
        timestamp: Date.now() - 2_000,
      });
      const history: AssistantMessage = {
        ...assistantMessage(589, 611_712, 0),
        api: "openai-completions",
        provider: "verify",
        model: "large",
        content: [{ type: "text", text: "Earlier response. ".repeat(100) }],
        usage: {
          ...assistantMessage(589, 611_712, 0).usage,
          output: 1_611,
          totalTokens: 613_912,
        },
        timestamp: Date.now() - 1_000,
      };
      session.sessionManager.appendMessage(history);
      await runtime.disposeSession(created.session.id);

      const reopened = await runtime.openSession(
        location,
        created.sessionFile!,
      );
      const resumed = internals.liveSessions.get(reopened.session.id)!.session;
      resumed.setThinkingLevel("off");
      await runtime.reloadMcp(reopened.session.id);
      const compactions: string[] = [];
      resumed.subscribe((event) => {
        if (event.type === "compaction_start") compactions.push(event.reason);
      });
      // Exercise Pi's real compaction and prompt paths without provider requests.
      resumed.agent.streamFunction = (model) => {
        const stream = createAssistantMessageEventStream();
        const response: AssistantMessage = {
          ...assistantMessage(100, 0, 0),
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [{ type: "text", text: "Summarized and continued." }],
        };
        stream.push({ type: "start", partial: response });
        stream.push({ type: "done", reason: "stop", message: response });
        stream.end();
        return stream;
      };

      await resumed.prompt("Continue");

      expect(compactions).toContain("threshold");
      expect(resumed.sessionManager.getEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "compaction",
            tokensBefore: 613_912,
          }),
        ]),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("loads project MCP configuration and reports a disabled server", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-mcp-runtime-"));
    temporaryDirectories.push(root);
    const cwd = path.join(root, "source");
    await mkdir(cwd, { recursive: true });
    await writeFile(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          example: { command: "node", args: ["server.js"], disabled: true },
        },
      }),
    );
    const runtime = new PineAgentRuntime({ emit: () => undefined });
    try {
      const created = await runtime.createSession({
        agentDir: path.join(root, "agent"),
        cwd,
        folders: [{ access: "read-write", path: cwd }],
        sessionsRoot: path.join(root, "sessions"),
      });
      await vi.waitFor(() => {
        expect(runtime.getMcpStatus(created.session.id).servers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "example", status: "disabled" }),
          ]),
        );
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("registers hidden Computer Use tools without exposing them initially", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;

      expect(agentSession?.getAllTools().map((tool) => tool.name)).toContain(
        "list_apps",
      );
      expect(agentSession?.getActiveToolNames()).toContain(
        ACTIVATE_COMPUTER_USE_TOOL_NAME,
      );
      expect(agentSession?.getActiveToolNames()).toContain("mcp");
      expect(agentSession?.getActiveToolNames()).not.toContain("list_apps");
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps the tool list unchanged when switching to YOLO", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const internals = runtime as unknown as {
        liveSessions: Map<string, { session: AgentSession }>;
      };
      const agentSession = internals.liveSessions.get(
        created.session.id,
      )?.session;
      const before = agentSession?.getActiveToolNames();
      expect(before).toContain(
        process.platform === "win32" ? "powershell" : "bash",
      );

      runtime.setSessionApprovalMode(created.session.id, "YOLO");

      expect(agentSession?.getActiveToolNames()).toEqual(before);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps Computer Use active after a turn settles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      type LiveSession = {
        computerUseActive: boolean;
        session: AgentSession;
      };
      const internals = runtime as unknown as {
        forwardEvent(session: AgentSession, event: unknown): void;
        liveSessions: Map<string, LiveSession>;
        syncActiveTools(live: LiveSession): void;
      };
      const live = internals.liveSessions.get(created.session.id);
      expect(live).toBeDefined();
      live!.computerUseActive = true;
      internals.syncActiveTools(live!);

      internals.forwardEvent(live!.session, { type: "agent_settled" });
      await Promise.resolve();

      expect(live!.computerUseActive).toBe(true);
      expect(live!.session.getActiveToolNames()).toContain("list_apps");
    } finally {
      await runtime.dispose();
    }
  });

  it("restores Computer Use when a saved session is reopened", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const internals = runtime as unknown as {
        liveSessions: Map<string, { session: AgentSession }>;
      };
      const agentSession = internals.liveSessions.get(
        created.session.id,
      )?.session;
      expect(agentSession).toBeDefined();
      expect(created.sessionFile).toBeDefined();
      agentSession!.sessionManager.appendMessage({
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "test",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });
      agentSession!.sessionManager.appendCustomEntry(
        "pine.computer-use-active",
        { active: true },
      );
      await runtime.disposeSession(created.session.id);

      const reopened = await runtime.openSession(
        location,
        created.sessionFile!,
      );
      const reopenedSession = internals.liveSessions.get(
        reopened.session.id,
      )?.session;

      expect(reopenedSession?.getActiveToolNames()).toContain("list_apps");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns the session as soon as prompt preflight succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;
      expect(agentSession).toBeDefined();
      let finishRun: (() => void) | undefined;
      const running = new Promise<void>((resolve) => {
        finishRun = resolve;
      });
      vi.spyOn(agentSession!, "prompt").mockImplementation(
        async (_message, options) => {
          options?.preflightResult?.("started");
          await running;
        },
      );

      await expect(
        runtime.prompt(created.session.id, "Start"),
      ).resolves.toEqual(
        expect.objectContaining({
          accepted: true,
          session: expect.objectContaining({ id: created.session.id }),
        }),
      );
      finishRun?.();
    } finally {
      await runtime.dispose();
    }
  });

  it("queues steering when compaction starts during prompt preflight", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        { access: "read-write" as const, path: path.join(root, "source") },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const events: Array<{ type: string; messages?: readonly string[] }> = [];
    const runtime = new PineAgentRuntime({
      emit: (event) => events.push(event),
    });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;
      expect(agentSession).toBeDefined();
      let finishCompaction: (() => void) | undefined;
      const compaction = new Promise<void>((resolve) => {
        finishCompaction = resolve;
      });
      vi.spyOn(agentSession!, "waitForIdle").mockReturnValue(compaction);
      const submit = vi
        .spyOn(agentSession!, "prompt")
        .mockRejectedValueOnce(
          new Error(
            "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
          ),
        )
        .mockResolvedValue(undefined);

      await expect(
        runtime.prompt(created.session.id, "First", "steer"),
      ).resolves.toMatchObject({ accepted: true });
      await expect(
        runtime.prompt(created.session.id, "Second"),
      ).resolves.toMatchObject({ accepted: true });
      expect(
        events.filter((event) => event.type === "steering-queue").at(-1),
      ).toMatchObject({ messages: ["First", "Second"] });
      expect(
        await runtime.dequeueSteering(created.session.id, "First"),
      ).toEqual({
        message: "First",
        removed: true,
      });
      expect(
        events.filter((event) => event.type === "steering-queue").at(-1),
      ).toMatchObject({ messages: ["Second"] });

      finishCompaction?.();
      await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
      expect(submit.mock.calls[1]?.[0]).toBe("Second");
      expect(events.some((event) => event.type === "session-error")).toBe(
        false,
      );
    } finally {
      await runtime.dispose();
    }
  });

  describe("sendSteeringNow", () => {
    async function setupSendNow() {
      const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
      temporaryDirectories.push(root);
      const location = {
        agentDir: path.join(root, "agent"),
        cwd: path.join(root, "source"),
        folders: [
          {
            access: "read-write" as const,
            path: path.join(root, "source"),
          },
        ],
        sessionsRoot: path.join(root, "sessions"),
      };
      await mkdir(location.cwd, { recursive: true });
      const events: Array<
        Parameters<ConstructorParameters<typeof PineAgentRuntime>[0]["emit"]>[0]
      > = [];
      const runtime = new PineAgentRuntime({
        emit: (event) => events.push(event),
      });
      const created = await runtime.createSession(location);
      const live = (
        runtime as unknown as {
          liveSessions: Map<
            string,
            {
              session: AgentSession;
              activeToolCalls: Map<string, string>;
              foregroundPromoter: { promote(toolCallId: string): boolean };
            }
          >;
        }
      ).liveSessions.get(created.session.id)!;
      await live.session.steer("Keep this steering");
      await live.session.steer("Send this now");
      // A run is in progress; aborting it is not what these tests exercise.
      const idle = vi
        .spyOn(live.session, "isIdle", "get")
        .mockReturnValue(false);
      const dispose = async () => {
        idle.mockRestore();
        await runtime.dispose();
      };
      const abort = vi
        .spyOn(runtime, "abort")
        .mockResolvedValue({ aborted: true });
      const prompt = vi
        .spyOn(live.session, "prompt")
        .mockResolvedValue(undefined);
      const track = (event: unknown) =>
        (
          runtime as unknown as {
            trackSendNow(live: unknown, event: unknown): void;
          }
        ).trackSendNow(live, event);
      const takeMessage = (text: string) =>
        track({
          type: "message_start",
          message: { role: "user", content: [{ type: "text", text }] },
        });
      const startResponse = () =>
        track({ type: "message_start", message: { role: "assistant" } });
      const stagedMessages = () =>
        events.filter((event) => event.type === "steering-queue").at(-1);
      return {
        runtime,
        dispose,
        sessionId: created.session.id,
        live,
        abort,
        prompt,
        takeMessage,
        startResponse,
        stagedMessages,
        track,
      };
    }

    it("interrupts streaming output and sends only the chosen message", async () => {
      const {
        runtime,
        dispose,
        sessionId,
        live,
        abort,
        prompt,
        takeMessage,
        startResponse,
        stagedMessages,
      } = await setupSendNow();
      try {
        await expect(
          runtime.sendSteeringNow(sessionId, "Send this now"),
        ).resolves.toEqual({ sent: true });
        expect(abort).toHaveBeenCalledWith(sessionId);
        expect(prompt.mock.calls[0]?.[0]).toBe("Send this now");
        // The other message is held out of the agent's queue, which would
        // deliver it together with the new prompt, but stays visible.
        expect(live.session.getSteeringMessages()).toEqual([]);
        expect(stagedMessages()).toMatchObject({
          messages: ["Keep this steering"],
        });

        takeMessage("Send this now");
        expect(live.session.getSteeringMessages()).toEqual([]);
        startResponse();
        await vi.waitFor(() =>
          expect(live.session.getSteeringMessages()).toEqual([
            "Keep this steering",
          ]),
        );
        expect(stagedMessages()).toMatchObject({
          messages: ["Keep this steering"],
        });
      } finally {
        await dispose();
      }
    });

    it("moves running shell commands to the background and delivers only the chosen message", async () => {
      const {
        runtime,
        dispose,
        sessionId,
        live,
        abort,
        prompt,
        takeMessage,
        startResponse,
      } = await setupSendNow();
      try {
        live.activeToolCalls.set("call-1", "bash");
        live.activeToolCalls.set("call-2", "privileged_bash");
        const promote = vi
          .spyOn(live.foregroundPromoter, "promote")
          .mockReturnValue(true);
        await expect(
          runtime.sendSteeringNow(sessionId, "Send this now"),
        ).resolves.toEqual({ sent: true });
        expect(promote.mock.calls.map(([id]) => id)).toEqual([
          "call-1",
          "call-2",
        ]);
        expect(abort).not.toHaveBeenCalled();
        expect(prompt).not.toHaveBeenCalled();
        // Only the chosen message is left for the boundary to deliver.
        expect(live.session.getSteeringMessages()).toEqual(["Send this now"]);

        // The agent drops a message from its queue when it takes it.
        live.session.clearQueue();
        takeMessage("Send this now");
        startResponse();
        await vi.waitFor(() =>
          expect(live.session.getSteeringMessages()).toEqual([
            "Keep this steering",
          ]),
        );
      } finally {
        await dispose();
      }
    });

    it("interrupts when a shell call cannot move or another tool runs", async () => {
      const { runtime, dispose, sessionId, live, abort, prompt } =
        await setupSendNow();
      try {
        live.activeToolCalls.set("call-1", "bash");
        vi.spyOn(live.foregroundPromoter, "promote").mockReturnValue(false);
        await runtime.sendSteeringNow(sessionId, "Send this now");
        expect(abort).toHaveBeenCalledTimes(1);
        // The chosen message left the queue instead of waiting in it.
        expect(live.session.getSteeringMessages()).not.toContain(
          "Send this now",
        );

        await live.session.steer("And this one");
        live.activeToolCalls.set("call-2", "read");
        await runtime.sendSteeringNow(sessionId, "And this one");
        expect(abort).toHaveBeenCalledTimes(2);
        expect(prompt.mock.calls.map(([message]) => message)).toEqual([
          "Send this now",
          "And this one",
        ]);
      } finally {
        await dispose();
      }
    });

    it("lets a held message be withdrawn", async () => {
      const { runtime, dispose, sessionId, live, stagedMessages } =
        await setupSendNow();
      try {
        await runtime.sendSteeringNow(sessionId, "Send this now");
        await expect(
          runtime.dequeueSteering(sessionId, "Keep this steering"),
        ).resolves.toEqual({ message: "Keep this steering", removed: true });
        expect(stagedMessages()).toMatchObject({ messages: [] });
        expect(live.session.getSteeringMessages()).toEqual([]);
      } finally {
        await dispose();
      }
    });

    it("submits held messages when the run ends before taking the sent one", async () => {
      const { runtime, dispose, sessionId, live, track, prompt } =
        await setupSendNow();
      try {
        vi.spyOn(live.session, "waitForIdle").mockResolvedValue(undefined);
        await runtime.sendSteeringNow(sessionId, "Send this now");
        track({ type: "agent_end", messages: [] });
        await vi.waitFor(() =>
          expect(prompt.mock.calls.map(([message]) => message)).toContain(
            "Keep this steering",
          ),
        );
        expect(live.session.getSteeringMessages()).toEqual([]);
      } finally {
        await dispose();
      }
    });

    it("does nothing for a message that is no longer queued", async () => {
      const { runtime, dispose, sessionId, abort } = await setupSendNow();
      try {
        await expect(
          runtime.sendSteeringNow(sessionId, "Already delivered"),
        ).resolves.toEqual({ sent: false });
        expect(abort).not.toHaveBeenCalled();
      } finally {
        await dispose();
      }
    });
  });

  it("dequeues one steering message while preserving the rest of both queues", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;
      expect(agentSession).toBeDefined();
      await agentSession?.steer("Keep this steering");
      await agentSession?.steer("Restore this steering");
      await agentSession?.followUp("Keep this follow-up");

      await expect(
        runtime.dequeueSteering(created.session.id, "Restore this steering"),
      ).resolves.toEqual({
        message: "Restore this steering",
        removed: true,
      });
      expect(agentSession?.getSteeringMessages()).toEqual([
        "Keep this steering",
      ]);
      expect(agentSession?.getFollowUpMessages()).toEqual([
        "Keep this follow-up",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("creates persistent SDK sessions in the project session directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const result = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;

      expect(result.session.messageCount).toBe(0);
      expect(liveSessions.get(result.session.id)?.session.steeringMode).toBe(
        "all",
      );
      expect(result.sessionFile).toContain(
        projectSessionDirectory(location.sessionsRoot, location.cwd),
      );
      expect(result.sessionFile).toMatch(/\.jsonl$/);
    } finally {
      await runtime.dispose();
    }
  });

  it("renames a live session through its session manager", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const renamed = runtime.renameSession(
        created.session.id,
        "Renamed session",
      );

      expect(renamed.session.name).toBe("Renamed session");
    } finally {
      await runtime.dispose();
    }
  });
});

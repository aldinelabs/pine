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
  toolNamesForApprovalMode,
  toolNamesForComputerUseState,
  toolNamesForMediaGenerationState,
  toolNamesForSkillAuthoringState,
} from "../runtime";
import { serializeAttachmentMessage } from "../../shared/attachments";
import { ACTIVATE_COMPUTER_USE_TOOL_NAME } from "../computer-use/tools";

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

describe("toolNamesForApprovalMode", () => {
  const tools = ["read", "bash", "edit", "write", "privileged_bash"];

  it("removes ordinary bash in yolo mode", () => {
    expect(toolNamesForApprovalMode(tools, "YOLO")).toEqual([
      "read",
      "edit",
      "write",
      "privileged_bash",
    ]);
  });

  it("restores ordinary bash before privileged bash", () => {
    expect(
      toolNamesForApprovalMode(
        ["read", "edit", "write", "privileged_bash"],
        "auto-approve",
      ),
    ).toEqual(tools);
  });

  it("only exposes TinyFish tools when a credential is configured", () => {
    const activeTools = [
      "read",
      "bash",
      "edit",
      "write",
      "web_search",
      "web_fetch",
    ];
    expect(
      toolNamesForApprovalMode(activeTools, "auto-approve", false),
    ).toEqual(["read", "bash", "edit", "write"]);
    expect(toolNamesForApprovalMode(activeTools, "auto-approve", true)).toEqual(
      [...activeTools],
    );
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
    const runtime = new PineAgentRuntime({ emit: () => undefined });
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
        syncApprovalModeTools(live: LiveSession): void;
      };
      const live = internals.liveSessions.get(created.session.id);
      expect(live).toBeDefined();
      live!.computerUseActive = true;
      internals.syncApprovalModeTools(live!);

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

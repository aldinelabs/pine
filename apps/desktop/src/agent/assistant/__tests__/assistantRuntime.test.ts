// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PineAgentEvent } from "../../../shared/agent";
import { PineAgentRuntime } from "../../runtime";
import { ASSISTANT_SYSTEM_PROMPT, markWeChatMessage } from "../prompt";
import { ASSISTANT_TOOL_NAMES } from "../tools";
import { MEMORY_SYSTEM_PROMPT } from "../../memory/prompt";
import { serializeAttachmentMessage } from "../../../shared/attachments";
import { assistantAttachmentId } from "../../../shared/assistant";

/**
 * The Assistant's conversation run end to end against a mock provider: what
 * the model is offered, and what happens when it reaches for a tool it does
 * not have (docs/orchestrator-proposal.md §3.4).
 */

interface ProviderRequest {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
}

type Reply =
  | { text: string }
  | { toolCall: { name: string; arguments: Record<string, unknown> } };

interface TestSession {
  prompt(text: string): Promise<void>;
  messages: { role: string; toolName?: string; content?: unknown }[];
  getActiveToolNames(): string[];
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return `data: ${JSON.stringify({
    id: "mock",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/** Records the Assistant's requests and answers each with the next reply. */
async function mockProvider(replies: Reply[]) {
  const requests: ProviderRequest[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (data: Buffer) => {
      body += data.toString();
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as ProviderRequest;
      const conversation = payload.tools?.some(
        (tool) => tool.function.name === ASSISTANT_TOOL_NAMES[0],
      );
      // Title requests and the like get a plain answer and are not recorded.
      const reply = conversation
        ? (replies.shift() ?? { text: "OK." })
        : { text: "OK." };
      if (conversation) requests.push(payload);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if ("text" in reply) {
        response.write(chunk({ role: "assistant", content: reply.text }, null));
        response.write(chunk({}, "stop"));
      } else {
        response.write(
          chunk(
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: {
                    name: reply.toolCall.name,
                    arguments: JSON.stringify(reply.toolCall.arguments),
                  },
                },
              ],
            },
            null,
          ),
        );
        response.write(chunk({}, "tool_calls"));
      }
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return { port: (server.address() as AddressInfo).port, requests };
}

async function assistantLocation(port: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-assistant-"));
  cleanups.push(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5 }),
  );
  const location = {
    agentDir: path.join(root, "agent"),
    cwd: path.join(root, "assistant", "workspace"),
    folders: [],
    sessionsRoot: path.join(root, "assistant", "sessions"),
    projectName: "Assistant",
    orchestrator: true,
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
          baseUrl: `http://127.0.0.1:${port}/v1`,
          models: [
            {
              id: "small",
              name: "Test model",
              contextWindow: 200_000,
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
    JSON.stringify({ defaultProvider: "verify", defaultModel: "small" }),
  );
  return location;
}

/** A runtime whose host answers the Assistant's overview with an empty Pine. */
function testRuntime(hostRequests: PineAgentEvent[] = []) {
  const runtime: PineAgentRuntime = new PineAgentRuntime({
    emit: (event) => {
      if (event.type !== "host-request") return;
      hostRequests.push(event);
      runtime.resolveHostRequest(
        event.requestId,
        event.request.kind === "assistant"
          ? {
              ok: true,
              response: {
                kind: "assistant",
                result: {
                  op: "overview",
                  overview: {
                    projects: [],
                    active: [],
                    dispatched: [],
                    pendingApprovals: 0,
                  },
                },
              },
            }
          : { ok: false, error: "Not available in this test." },
      );
    },
  });
  cleanups.push(async () => {
    await runtime.dispose();
  });
  return runtime;
}

function liveSession(runtime: PineAgentRuntime, sessionId: string) {
  return (
    runtime as unknown as {
      liveSessions: Map<string, { session: TestSession }>;
    }
  ).liveSessions.get(sessionId)!.session;
}

function text(content: unknown): string {
  return typeof content === "string"
    ? content
    : (content as { text?: string }[]).map((part) => part.text ?? "").join("");
}

describe("the Assistant's conversation", () => {
  it("offers the model exactly the allowlisted tools and its own prompt", async () => {
    const provider = await mockProvider([{ text: "OK." }]);
    const runtime = testRuntime();
    const location = await assistantLocation(provider.port);
    const created = await runtime.createSession(location);
    const session = liveSession(runtime, created.session.id);

    await session.prompt("看看现在都在跑什么");

    const [request] = provider.requests;
    expect(request?.tools?.map((tool) => tool.function.name)).toEqual([
      ...ASSISTANT_TOOL_NAMES,
    ]);
    for (const name of ["bash", "read", "write", "edit", "web_search"])
      expect(session.getActiveToolNames()).not.toContain(name);
    const system = text(
      request?.messages.find((message) => message.role === "system")?.content,
    );
    expect(system.startsWith(ASSISTANT_SYSTEM_PROMPT)).toBe(true);
    // Memory is on by default: the ordinary guide follows its own prompt.
    expect(system).toContain(MEMORY_SYSTEM_PROMPT);
    expect(system).not.toContain("privileged_bash");
  });

  it("keeps the prompt and tools fixed while desktop and WeChat messages mix", async () => {
    const provider = await mockProvider([
      { text: "OK." },
      { text: "OK." },
      { text: "OK." },
    ]);
    const runtime = testRuntime();
    const location = await assistantLocation(provider.port);
    const created = await runtime.createSession(location);
    const session = liveSession(runtime, created.session.id);

    await session.prompt("看看现在都在跑什么");
    await session.prompt(markWeChatMessage("导航那个好了没"));
    await session.prompt("把周报的会话打开");

    expect(provider.requests).toHaveLength(3);
    const systems = provider.requests.map((request) =>
      text(
        request.messages.find((message) => message.role === "system")?.content,
      ),
    );
    expect(new Set(systems).size).toBe(1);
    expect(systems[0]?.startsWith(ASSISTANT_SYSTEM_PROMPT)).toBe(true);
    for (const request of provider.requests)
      expect(request.tools?.map((tool) => tool.function.name)).toEqual([
        ...ASSISTANT_TOOL_NAMES,
      ]);
    // The WeChat mark rides on the user message itself, not the prompt.
    const users = provider.requests[2]?.messages
      .filter((message) => message.role === "user")
      .map((message) => text(message.content));
    expect(users).toContain(markWeChatMessage("导航那个好了没"));
  });

  it("shows the model only what attachments are, and keeps them in the transcript", async () => {
    const provider = await mockProvider([{ text: "OK." }]);
    const runtime = testRuntime();
    const location = await assistantLocation(provider.port);
    const created = await runtime.createSession(location);
    const session = liveSession(runtime, created.session.id);
    const attachment = {
      name: "q3.csv",
      path: "/Users/me/Private/finance/q3.csv",
      extension: "csv",
      kind: "file" as const,
      size: 4096,
      modifiedAt: "2026-11-20T00:00:00.000Z",
    };
    const sent = serializeAttachmentMessage(
      [attachment],
      markWeChatMessage("交给财务项目分析"),
    );

    await session.prompt(sent);

    const request = provider.requests[0];
    const user = request?.messages
      .filter((message) => message.role === "user")
      .map((message) => text(message.content))
      .find((content) => content.includes("交给财务项目分析"));
    expect(user).toBe(
      [
        "[WeChat]",
        "<attachments>",
        `- ${assistantAttachmentId(attachment)}: q3.csv (csv file, 4 KB)`,
        "</attachments>",
        "",
        "交给财务项目分析",
      ].join("\n"),
    );
    expect(JSON.stringify(request?.messages)).not.toContain("/Users/me");
    expect(request?.tools?.map((tool) => tool.function.name)).toEqual([
      ...ASSISTANT_TOOL_NAMES,
    ]);
    const stored = session.messages.find((message) => message.role === "user");
    expect(text(stored?.content)).toBe(sent);
  });

  it("refuses a tool that is not on the list, and runs one that is", async () => {
    const provider = await mockProvider([
      { toolCall: { name: "bash", arguments: { command: "ls ~" } } },
      { toolCall: { name: "pine_overview", arguments: {} } },
      { text: "Nothing is running." },
    ]);
    const hostRequests: PineAgentEvent[] = [];
    const runtime = testRuntime(hostRequests);
    const location = await assistantLocation(provider.port);
    const created = await runtime.createSession(location);
    const session = liveSession(runtime, created.session.id);

    await session.prompt("列一下我的主目录");

    const results = session.messages.filter(
      (message) => message.role === "toolResult",
    );
    expect(results.map((result) => result.toolName)).toEqual([
      "bash",
      "pine_overview",
    ]);
    // Never registered, so it cannot run (the guard is the second line,
    // tested on its own in assistantTools.test.ts).
    expect(text(results[0]?.content)).toBe("Tool bash not found");
    expect(text(results[1]?.content)).toContain("Projects:");
    expect(
      hostRequests.map(
        (event) => event.type === "host-request" && event.request.kind,
      ),
    ).toEqual(["assistant"]);
    // Three requests, and the tool list never changed between them.
    expect(provider.requests).toHaveLength(3);
    for (const request of provider.requests)
      expect(request.tools?.map((tool) => tool.function.name)).toEqual([
        ...ASSISTANT_TOOL_NAMES,
      ]);
  });

  it("offers the management tools of P3 but none that delete or author", async () => {
    const provider = await mockProvider([
      {
        toolCall: { name: "ui_project_delete", arguments: { projectId: "x" } },
      },
      { toolCall: { name: "automation_save", arguments: {} } },
      { text: "I can't do that here." },
    ]);
    const hostRequests: PineAgentEvent[] = [];
    const runtime = testRuntime(hostRequests);
    const location = await assistantLocation(provider.port);
    const created = await runtime.createSession(location);
    const session = liveSession(runtime, created.session.id);

    await session.prompt("把旧项目删了，再建个自动化");

    const offered = provider.requests[0]?.tools?.map(
      (tool) => tool.function.name,
    );
    for (const name of [
      "settings_read",
      "automation_list",
      "automation_get",
      "automation_set_enabled",
      "automation_run_now",
      "ui_project_list",
      "ui_project_create",
      "ui_project_update",
      "ui_session_send",
      "ui_session_stop",
      "ui_session_rename",
    ])
      expect(offered).toContain(name);
    const results = session.messages.filter(
      (message) => message.role === "toolResult",
    );
    expect(results.map((result) => text(result.content))).toEqual([
      "Tool ui_project_delete not found",
      "Tool automation_save not found",
    ]);
    expect(hostRequests).toEqual([]);
    for (const request of provider.requests)
      expect(request.tools?.map((tool) => tool.function.name)).toEqual([
        ...ASSISTANT_TOOL_NAMES,
      ]);
  });

  it("works in an empty directory it leaves empty", async () => {
    const provider = await mockProvider([{ text: "OK." }]);
    const runtime = testRuntime();
    const location = await assistantLocation(provider.port);
    const created = await runtime.createSession(location);

    await liveSession(runtime, created.session.id).prompt("hi");

    expect(await readdir(location.cwd)).toEqual([]);
  });
});

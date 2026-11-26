// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PineAgentRuntime } from "../runtime";
import { PINE_CONTEXT_NOTICE } from "../runtime/context-notices";

/** A chat completions request body as the provider receives it. */
interface ProviderRequest {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
  [key: string]: unknown;
}

interface TestSession {
  prompt(text: string): Promise<void>;
  sendCustomMessage(message: {
    customType: string;
    content: string;
    display: boolean;
    details: unknown;
  }): Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** An OpenAI-compatible provider that records requests and answers "OK.". */
async function mockProvider(): Promise<{
  port: number;
  requests: ProviderRequest[];
}> {
  const requests: ProviderRequest[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as ProviderRequest;
      // Conversation turns only; a title request has just its own tool.
      if (payload.tools?.some((tool) => tool.function.name === "read"))
        requests.push(payload);
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const delta of [
        { delta: { role: "assistant", content: "OK." }, finish_reason: null },
        { delta: {}, finish_reason: "stop" },
      ])
        response.write(
          `data: ${JSON.stringify({
            id: "mock",
            object: "chat.completion.chunk",
            created: 0,
            model: "mock",
            choices: [{ index: 0, ...delta }],
          })}\n\n`,
        );
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

async function testLocation(port: number, projectName?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-prefix-runtime-"));
  cleanups.push(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5 }),
  );
  const location = {
    agentDir: path.join(root, "agent"),
    cwd: path.join(root, "source"),
    folders: [{ access: "read-write" as const, path: root }],
    sessionsRoot: path.join(root, "sessions"),
    ...(projectName ? { projectName } : { temporaryWorkspace: true as const }),
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

/** A runtime whose host answers that nothing is known. */
function testRuntime() {
  const runtime: PineAgentRuntime = new PineAgentRuntime({
    emit: (event) => {
      if (event.type !== "host-request") return;
      runtime.resolveHostRequest(
        event.requestId,
        event.request.kind === "live-context"
          ? {
              ok: true,
              response: {
                kind: "live-context",
                result: { op: "increment", increment: null },
              },
            }
          : {
              ok: true,
              response: { kind: "approximate-location", location: null },
            },
      );
    },
  });
  cleanups.push(async () => {
    await runtime.dispose();
  });
  return runtime;
}

function liveSession(runtime: PineAgentRuntime, sessionId: string) {
  const sessions = (
    runtime as unknown as {
      liveSessions: Map<string, { session: TestSession }>;
    }
  ).liveSessions;
  return sessions.get(sessionId)!.session;
}

function text(content: unknown): string {
  return typeof content === "string"
    ? content
    : (content as { text?: string }[]).map((part) => part.text ?? "").join("");
}

function systemPrompt(request: ProviderRequest): string {
  return text(
    request.messages.find((message) => message.role === "system")?.content,
  );
}

function contextNotice(request: ProviderRequest): string {
  return request.messages
    .map((message) => text(message.content))
    .filter((content) => content.startsWith("Pine context notice."))
    .join("\n");
}

async function firstRequest(projectName?: string): Promise<ProviderRequest> {
  const provider = await mockProvider();
  const runtime = testRuntime();
  const created = await runtime.createSession(
    await testLocation(provider.port, projectName),
  );
  await liveSession(runtime, created.session.id).prompt("hi");
  return provider.requests[0];
}

describe("the prompt prefix new sessions share", () => {
  it("is the same in every project up to the working directory", async () => {
    const first = await firstRequest("Thesis");
    const second = await firstRequest();

    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));
    const prompt = systemPrompt(first);
    const cwd = prompt.indexOf("<cwd>");
    expect(cwd).toBeGreaterThan(0);
    expect(systemPrompt(second).slice(0, cwd)).toBe(prompt.slice(0, cwd));
    // What differs per project arrives in the workspace notice.
    expect(contextNotice(first)).toContain(
      'This session runs in the Pine project "Thesis".',
    );
    expect(contextNotice(second)).toContain("This session runs in No Project");
    expect(contextNotice(first)).toContain("The scratch directory is ");
  });

  it("carries fixed guidance as system sections, not as notices", async () => {
    const request = await firstRequest("Thesis");

    const prompt = systemPrompt(request);
    expect(prompt).toContain(
      "<pine_interface_elements>\n## Interactive blocks",
    );
    expect(prompt).toContain("<pine_memory>\n## Long-term memory");
    const notice = contextNotice(request);
    expect(notice).not.toContain("## Interactive blocks");
    expect(notice).not.toContain("## Long-term memory");
    expect(notice).toContain(
      "<memory>\nNo notes have been saved yet.\n</memory>",
    );
  });

  it("keeps interactive blocks as a notice in a session that was given one", async () => {
    const provider = await mockProvider();
    const runtime = testRuntime();
    const created = await runtime.createSession(
      await testLocation(provider.port, "Thesis"),
    );
    const session = liveSession(runtime, created.session.id);
    await session.sendCustomMessage({
      customType: PINE_CONTEXT_NOTICE,
      content: "earlier notice",
      display: false,
      details: { notices: { interface_elements: "Earlier block guide." } },
    });
    await session.prompt("hi");

    const [request] = provider.requests;
    expect(systemPrompt(request)).not.toContain("<pine_interface_elements>");
    expect(contextNotice(request)).toContain(
      "<interface_elements>\n## Interactive blocks",
    );
  });
});

describe("sub-session guidance in a real request", () => {
  it("reaches the model in the fixed system prompt and the tool description", async () => {
    const request = await firstRequest("Thesis");

    const prompt = systemPrompt(request);
    expect(prompt).toContain("## Sub-sessions");
    expect(prompt).toContain("Use it on your own judgment");
    expect(prompt).toContain("Background research");
    // Fixed guidance, never a per-turn notice.
    expect(contextNotice(request)).not.toContain("## Sub-sessions");
    const tool = (
      request.tools as { function: { name: string; description: string } }[]
    ).find((candidate) => candidate.function.name === "ui_session_new");
    expect(tool?.function.description).toContain(
      "Background research on a substantial task",
    );
  });
});

// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PineAgentRuntime } from "../runtime";
import type { AgentHostRequest } from "../protocol";
import {
  answerLiveContextOperation,
  READ_LIVE_TRANSCRIPT_TOOL_NAME,
  type LiveContextAgentSource,
} from "../../shared/liveContextAgent";
import type {
  LiveContextSegment,
  LiveContextSpeakers,
} from "../../shared/liveContext";

/** A chat completions request body as the provider receives it. */
interface ProviderRequest {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
  [key: string]: unknown;
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

async function testLocation(port: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-live-runtime-"));
  cleanups.push(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5 }),
  );
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

/** Answers host requests from a fake Live Context, like main does. */
function liveRuntime(source: () => LiveContextAgentSource | undefined) {
  const runtime: PineAgentRuntime = new PineAgentRuntime({
    emit: (event) => {
      if (event.type !== "host-request") return;
      const request: AgentHostRequest = event.request;
      if (request.kind === "live-context") {
        const current = source();
        runtime.resolveHostRequest(event.requestId, {
          ok: true,
          response: {
            kind: "live-context",
            result:
              current &&
              (request.operation.op === "increment" ||
                request.operation.op === "read")
                ? answerLiveContextOperation(current, request.operation)
                : request.operation.op === "increment"
                  ? { op: "increment", increment: null }
                  : { op: "read", read: null },
          },
        });
        return;
      }
      runtime.resolveHostRequest(event.requestId, {
        ok: true,
        response: { kind: "approximate-location", location: null },
      });
    },
  });
  cleanups.push(async () => {
    await runtime.dispose();
  });
  return runtime;
}

async function prompt(
  runtime: PineAgentRuntime,
  sessionId: string,
  text: string,
): Promise<void> {
  const sessions = (
    runtime as unknown as {
      liveSessions: Map<
        string,
        { session: { prompt(text: string): Promise<void> } }
      >;
    }
  ).liveSessions;
  await sessions.get(sessionId)!.session.prompt(text);
}

const AT = new Date(2026, 10, 19, 18, 34, 0).getTime();

function segment(index: number, text: string): LiveContextSegment {
  return {
    id: `cap-system-${index}`,
    source: "system",
    start: AT + index * 1_000,
    end: AT + index * 1_000 + 900,
    text,
    final: true,
    turns: [{ offset: 0, speaker: index % 2 ? "system-3" : "system-2" }],
  };
}

/** Everything but the messages, which grow. */
function frame(request: ProviderRequest) {
  return Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== "messages"),
  );
}

/** `next` repeats `previous` byte for byte and only appends after it. */
function expectPrefixExtension(
  previous: ProviderRequest,
  next: ProviderRequest,
): void {
  expect(JSON.stringify(frame(next))).toBe(JSON.stringify(frame(previous)));
  expect(next.messages.length).toBeGreaterThan(previous.messages.length);
  expect(JSON.stringify(next.messages.slice(0, previous.messages.length))).toBe(
    JSON.stringify(previous.messages),
  );
}

function liveBlocks(request: ProviderRequest): string[] {
  return request.messages.flatMap((message) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : (message.content as { text?: string }[])
            .map((part) => part.text ?? "")
            .join("");
    return text.includes("<live_context") ? [text] : [];
  });
}

describe("Live Context in provider requests", () => {
  it("keeps every request a strict prefix extension of the one before", async () => {
    const provider = await mockProvider();
    const location = await testLocation(provider.port);
    const segments = [segment(0, "What were you debating back then?")];
    let speakers: LiveContextSpeakers = {
      names: { "system-2": "Interviewer" },
      merges: {},
    };
    const runtime = liveRuntime(() => ({
      transcript: { segments, speakers },
      capture: { state: "listening", sources: ["system"] },
      now: AT + 60_000,
    }));
    const created = await runtime.createSession(location);
    const id = created.session.id;

    await prompt(runtime, id, "他们在说什么？");
    const [first] = provider.requests;
    expect(first.tools?.map((tool) => tool.function.name)).toContain(
      READ_LIVE_TRANSCRIPT_TOOL_NAME,
    );
    expect(liveBlocks(first)).toHaveLength(1);
    expect(liveBlocks(first)[0]).toContain(
      "Interviewer (system audio): What were you debating back then?",
    );

    // New speech between turns: appended, nothing before it changes.
    segments.push(segment(1, "That was the open philanthropy project."));
    await prompt(runtime, id, "然后呢？");
    const second = provider.requests[1];
    expectPrefixExtension(first, second);
    const added = liveBlocks(second).slice(liveBlocks(first).length);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("open philanthropy");
    expect(added[0]).not.toContain("debating");

    // A rename rewrites no earlier block; a delta note comes with new speech.
    speakers = { names: { "system-2": "Daniela" }, merges: {} };
    segments.push(segment(2, "What really happened?"));
    await prompt(runtime, id, "谁在说话？");
    const third = provider.requests[2];
    expectPrefixExtension(second, third);
    const renamed = liveBlocks(third).at(-1);
    expect(renamed).toContain(
      'Renamed: "Interviewer (system audio)" is now "Daniela (system audio)".',
    );
    expect(renamed).toContain("Daniela (system audio): What really happened?");

    // Nothing new: no block at all.
    await prompt(runtime, id, "好的");
    const fourth = provider.requests[3];
    expectPrefixExtension(third, fourth);
    expect(liveBlocks(fourth)).toHaveLength(liveBlocks(third).length);

    // Reopened from the session file: notices replay byte for byte.
    await runtime.disposeSession(id);
    const reopened = await runtime.openSession(location, created.sessionFile!);
    await prompt(runtime, reopened.session.id, "继续");
    const fifth = provider.requests[4];
    expectPrefixExtension(fourth, fifth);
    expect(liveBlocks(fifth)).toHaveLength(liveBlocks(fourth).length);
  });

  it("sends the same system prompt and tools with or without live context", async () => {
    const provider = await mockProvider();
    const location = await testLocation(provider.port);
    const without = liveRuntime(() => undefined);
    const plain = await without.createSession(location);
    await prompt(without, plain.session.id, "hi");
    const withLive = liveRuntime(() => ({
      transcript: {
        segments: [segment(0, "Hello.")],
        speakers: { names: {}, merges: {} },
      },
      now: AT,
    }));
    const live = await withLive.createSession(location);
    await prompt(withLive, live.session.id, "hi");
    const [a, b] = provider.requests;
    expect(liveBlocks(a)).toHaveLength(0);
    expect(liveBlocks(b)).toHaveLength(1);
    expect(JSON.stringify(b.tools)).toBe(JSON.stringify(a.tools));
    expect(JSON.stringify(b.messages[0])).toBe(JSON.stringify(a.messages[0]));
  });
});

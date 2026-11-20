// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PineAgentRuntime } from "../../agent/runtime";
import { writeLiveTranslationModelSelection } from "../../agent/pineSettings";
import type { LiveContextEvent } from "../../shared/liveContext";
import {
  LiveContextService,
  liveTranslationsPath,
  type LiveContextHelperProcess,
} from "../liveContext";

/**
 * Live Context translation end to end: a scripted helper's final segments
 * go through the real service, the agent runtime and pi-ai's
 * OpenAI-compatible client to a local mock provider, and back into the
 * translations file.
 */

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const target = { projectId: PROJECT_ID, sessionId: "session-1" };

class ScriptedHelper extends EventEmitter implements LiveContextHelperProcess {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor() {
    super();
    this.stdin.on("finish", () => setTimeout(() => this.emit("exit", 0), 0));
  }
  write(event: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }
  kill(): boolean {
    this.emit("exit", null);
    return true;
  }
}

function replyWithText(response: http.ServerResponse, text: string): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of [
    { delta: { content: text, role: "assistant" }, finish_reason: null },
    { delta: {}, finish_reason: "stop" },
  ])
    response.write(
      `data: ${JSON.stringify({
        choices: [{ ...chunk, index: 0 }],
        created: 0,
        id: "mock",
        model: "mock",
        object: "chat.completion.chunk",
      })}\n\n`,
    );
  response.write("data: [DONE]\n\n");
  response.end();
}

/** A "translator" that numbers its answers the way the prompt asks. */
const FRENCH: Record<string, string> = {
  "Hello everyone, welcome to the design review.":
    "Bonjour à tous, bienvenue à la revue de conception.",
  "Ana will walk us through App.vue first.":
    "Ana va d’abord nous présenter App.vue.",
  "Any questions before we start?": "Des questions avant de commencer ?",
};

describe("Live Context translation, end to end", () => {
  let server: http.Server;
  let bodies: {
    model: string;
    messages: { role: string; content: unknown }[];
  }[];
  let root: string;
  let agentDir: string;
  let helper: ScriptedHelper;
  let service: LiveContextService;
  let events: LiveContextEvent[];

  beforeEach(async () => {
    bodies = [];
    server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const payload = JSON.parse(body) as (typeof bodies)[number];
        bodies.push(payload);
        const user = payload.messages.find(({ role }) => role === "user");
        const text = typeof user?.content === "string" ? user.content : "";
        const segments = [
          ...text
            .split("<segments>")[1]
            .matchAll(/<s n="(\d+)">([\s\S]*?)<\/s>/g),
        ];
        replyWithText(
          response,
          segments
            .map(([, n, source]) => `<t n="${n}">${FRENCH[source] ?? ""}</t>`)
            .join("\n"),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;

    root = await mkdtemp(path.join(os.tmpdir(), "pine-live-translation-"));
    agentDir = path.join(root, "agent");
    await mkdir(path.join(agentDir, "sessions"), { recursive: true });
    await writeFile(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          mock: {
            api: "openai-completions",
            apiKey: "mock-key",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            name: "Mock",
            models: [
              {
                id: "chat-model",
                name: "Chat",
                contextWindow: 128_000,
                maxTokens: 8_192,
                input: ["text"],
              },
              {
                id: "fast-model",
                name: "Fast",
                contextWindow: 128_000,
                maxTokens: 4_096,
                input: ["text"],
              },
            ],
          },
        },
      }),
    );
    await writeFile(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "mock", defaultModel: "chat-model" }),
    );
    await writeLiveTranslationModelSelection(agentDir, {
      providerId: "mock",
      modelId: "fast-model",
    });

    const runtime = new PineAgentRuntime({ emit: () => undefined });
    events = [];
    service = new LiveContextService({
      unavailableReason: () => null,
      spawnHelper: () => {
        helper = new ScriptedHelper();
        return helper;
      },
      projectRoot: () => root,
      emit: (event) => events.push(event),
      volatileIntervalMs: 1,
      stopTimeoutMs: 100,
      translate: (request) => runtime.translateLiveContext(agentDir, request),
      translationTiming: { settleMs: 20, maxWaitMs: 50, minIntervalMs: 0 },
    });
  });

  afterEach(async () => {
    service.dispose();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  it("translates a fixture transcript's final segments with the chosen model", async () => {
    await service.start({
      ...target,
      sources: ["system"],
      locale: "en-US",
      translation: "fr-FR",
    });
    helper.write({
      type: "status",
      state: "listening",
      startedAt: 1_000_000,
      sources: ["system"],
      locale: "en-US",
    });
    const fixture = Object.keys(FRENCH);
    fixture.forEach((text, index) => {
      helper.write({
        type: "segment",
        id: `system-${index}`,
        source: "system",
        t0: index * 1000,
        t1: index * 1000 + 900,
        text: text.slice(0, 12),
        final: false,
      });
      helper.write({
        type: "segment",
        id: `system-${index}`,
        source: "system",
        t0: index * 1000,
        t1: index * 1000 + 900,
        text,
        final: true,
      });
    });

    const deadline = Date.now() + 10_000;
    const done = () =>
      events
        .filter((event) => event.kind === "translation")
        .flatMap((event) => Object.keys(event.translations)).length;
    while (done() < fixture.length && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));

    // One batch, to the live translation model, never the volatile text.
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe("fast-model");
    const system = bodies[0].messages.find(({ role }) => role === "system");
    expect(String(system?.content)).toContain("into French");
    const user = String(
      bodies[0].messages.find(({ role }) => role === "user")?.content,
    );
    expect(user).not.toContain('<s n="4">');
    expect(user).not.toMatch(/<s n="\d">Hello everyo<\/s>/);

    await service.stop();
    const transcript = await service.transcript(target);
    expect(
      transcript.segments.map(
        ({ id }) => transcript.translations?.["fr-FR"]?.[id],
      ),
    ).toEqual(Object.values(FRENCH));
    const lines = (
      await readFile(liveTranslationsPath(root, "session-1"), "utf8")
    )
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3);
  });
});

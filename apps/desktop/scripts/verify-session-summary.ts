#!/usr/bin/env bun
/**
 * Boots a real agent session against a local mock provider, runs two turns and
 * a compaction, and asserts that the compaction request is the conversation's
 * next request: same tools, same request parameters, and the previous
 * request's messages as an exact prefix, with the summary instruction as the
 * only addition.
 *
 * Prompt caches match prefixes byte for byte, so this is the property that
 * lets the compaction call hit the cache. A mock provider cannot report cache
 * hits; the identical prefix is the proof.
 *
 * Usage: bun run verify:summary
 */
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createSessionSummaryCompactionExtension,
  createSubmitSessionSummaryToolDefinition,
  SUBMIT_SESSION_SUMMARY_TOOL_NAME,
} from "../src/agent/runtime/session-summary";

const SUMMARY = "## Goal\nverify the compaction request";
const COMPACTION_MARKER = "Pine is compacting this conversation";

type Payload = Record<string, unknown> & { messages: unknown[] };

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        reject(new Error("The mock provider did not bind a TCP port."));
        return;
      }
      resolve(address.port);
    });
  });
}

function sse(response: http.ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  for (const choice of chunks) {
    response.write(
      `data: ${JSON.stringify({
        choices: [{ index: 0, ...(choice as object) }],
        created: 0,
        id: "mock",
        model: "mock",
        object: "chat.completion.chunk",
      })}\n\n`,
    );
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

function containsMarker(message: unknown): boolean {
  return JSON.stringify(message).includes(COMPACTION_MARKER);
}

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  const requests: Payload[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const payload = JSON.parse(body) as Payload;
      requests.push(payload);
      const last = payload.messages.at(-1);
      if (containsMarker(last)) {
        sse(response, [
          {
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_summary",
                  type: "function",
                  function: {
                    name: SUBMIT_SESSION_SUMMARY_TOOL_NAME,
                    arguments: JSON.stringify({ summary: SUMMARY }),
                  },
                },
              ],
            },
            finish_reason: null,
          },
          { delta: {}, finish_reason: "tool_calls" },
        ]);
        return;
      }
      sse(response, [
        { delta: { role: "assistant", content: "ok" }, finish_reason: null },
        { delta: {}, finish_reason: "stop" },
      ]);
    });
  });
  const port = await listen(server);

  const agentDir = await mkdtemp(path.join(os.tmpdir(), "pine-summary-agent-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pine-summary-project-"));
  await mkdir(path.join(agentDir, "sessions"), { recursive: true });
  await writeFile(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        verify: {
          api: "openai-completions",
          apiKey: "verify-key",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          models: [
            {
              contextWindow: 128_000,
              id: "verify-model",
              input: ["text"],
              maxTokens: 8_192,
              name: "Verify Model",
            },
          ],
          name: "Verify Provider",
        },
      },
    }),
  );
  await writeFile(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      defaultModel: "verify-model",
      defaultProvider: "verify",
      // A tiny tail so the short conversation has something to summarize.
      compaction: { enabled: true, keepRecentTokens: 20, reserveTokens: 2000 },
    }),
  );

  try {
    const modelRuntime = await ModelRuntime.create({
      allowModelNetwork: false,
      authPath: path.join(agentDir, "auth.json"),
      modelsPath: path.join(agentDir, "models.json"),
      modelsStorePath: path.join(agentDir, "models-store.json"),
    });
    const settingsManager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: false,
    });
    // eslint-disable-next-line prefer-const -- assigned once the session exists
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
    const resourceLoader = new DefaultResourceLoader({
      agentDir,
      cwd,
      extensionFactories: [
        createSessionSummaryCompactionExtension({
          getSession: () => session,
          isEnabled: () => true,
        }),
      ],
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      settingsManager,
    });
    await resourceLoader.reload();
    const probe = defineTool({
      description: "Tool used by the summary verification.",
      execute: () =>
        Promise.resolve({
          content: [{ text: "ok", type: "text" as const }],
          details: {},
        }),
      label: "Verify Probe",
      name: "verify_probe",
      parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    });
    ({ session } = await createAgentSession({
      agentDir,
      cwd,
      customTools: [probe, createSubmitSessionSummaryToolDefinition()],
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.create(
        cwd,
        path.join(agentDir, "sessions"),
      ),
      settingsManager,
    }));

    if (
      !session.getActiveToolNames().includes(SUBMIT_SESSION_SUMMARY_TOOL_NAME)
    ) {
      fail(`${SUBMIT_SESSION_SUMMARY_TOOL_NAME} is not an active tool.`);
    }

    const filler =
      " The project has many moving parts that need a careful look.".repeat(30);
    await session.prompt(`First question about the project.${filler}`);
    await session.prompt(`Second question about the project.${filler}`);
    if (requests.length !== 2) {
      fail(`Expected 2 conversation requests, saw ${requests.length}.`);
    }
    const mainRequest = requests[1];

    await session.compact();
    if (requests.length !== 3) {
      fail(
        `Compaction made ${requests.length - 2} requests; expected exactly 1 (a fallback to pi's summarizer means the continuation request failed).`,
      );
    }
    const compaction = requests[2];

    const withoutMessages = (payload: Payload) => ({
      ...payload,
      messages: undefined,
    });
    if (
      !isDeepStrictEqual(
        withoutMessages(mainRequest),
        withoutMessages(compaction),
      )
    ) {
      fail(
        `Request parameters differ from the conversation's:\n${JSON.stringify(withoutMessages(mainRequest))}\n${JSON.stringify(withoutMessages(compaction))}`,
      );
    }
    mainRequest.messages.forEach((message, index) => {
      if (!isDeepStrictEqual(message, compaction.messages[index])) {
        fail(`Message ${index} differs from the conversation's request.`);
      }
    });
    if (!containsMarker(compaction.messages.at(-1))) {
      fail("The summary instruction is not the last message.");
    }
    const compactionEntry = session.sessionManager
      .getEntries()
      .find((entry) => entry.type === "compaction");
    if (!compactionEntry || compactionEntry.summary !== SUMMARY) {
      fail("The submitted summary was not recorded as the compaction.");
    }
    process.stdout.write(
      `[summary-verify] ok: the compaction request reuses ${mainRequest.messages.length} messages and the tool list of the previous request\n`,
    );
  } finally {
    server.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `[summary-verify] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

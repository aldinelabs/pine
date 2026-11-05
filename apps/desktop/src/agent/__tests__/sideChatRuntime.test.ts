import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { afterEach, describe, expect, it } from "vitest";
import { PineAgentRuntime } from "../runtime";
import {
  PINE_SIDE_CHAT_NOTICE,
  SIDE_CHAT_BLOCKED_TOOL_REASON,
} from "../sideChat";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function reply(
  context: Context,
  content: AssistantMessage["content"],
  model: { api: string; provider: string; id: string },
) {
  const stopReason = content.some((block) => block.type === "toolCall")
    ? "toolUse"
    : "stop";
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
  void context;
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: stopReason, message });
  stream.end();
  return stream;
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-side-chat-"));
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
          models: [{ id: "side-chat", input: ["text"] }],
        },
      },
    }),
  );
  await writeFile(
    path.join(location.agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "verify",
      defaultModel: "side-chat",
      approximateLocationEnabled: false,
    }),
  );
  const runtime = new PineAgentRuntime({ emit: () => undefined });
  const live = (id: string) =>
    (
      runtime as unknown as {
        liveSessions: Map<string, { session: AgentSession }>;
      }
    ).liveSessions.get(id)!.session;
  return { root, location, runtime, live };
}

function toolSignature(context: Context) {
  return JSON.stringify(
    (context.tools ?? []).map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
  );
}

describe("side chats on a real Pi session", () => {
  it("keeps the parent's prefix and refuses tools that write", async () => {
    const { root, location, runtime, live } = await setup();
    try {
      const parent = await runtime.createSession(location);
      const parentSession = live(parent.session.id);
      parentSession.setSessionName("Side chat test");
      const parentContexts: Context[] = [];
      parentSession.agent.streamFunction = (model, context) => {
        parentContexts.push(structuredClone(context));
        return reply(context, [{ type: "text", text: "It is 42." }], model);
      };
      await parentSession.prompt("What is the answer?");
      const parentMessageCount = parentSession.messages.length;

      const side = await runtime.openSideChat({
        location,
        parentSessionId: parent.session.id,
        sideChatsDirectory: path.join(root, "side-chats"),
      });
      expect(side.messages).toEqual([]);
      const sideSession = live(side.session.id);
      const sideContexts: Context[] = [];
      const target = path.join(location.cwd, "written.txt");
      sideSession.agent.streamFunction = (model, context) => {
        sideContexts.push(structuredClone(context));
        return reply(
          context,
          sideContexts.length === 1
            ? [
                {
                  type: "toolCall",
                  id: "write-1",
                  name: "write",
                  arguments: { path: target, content: "nope" },
                },
              ]
            : [{ type: "text", text: "Because." }],
          model,
        );
      };
      await runtime.prompt(side.session.id, "Why?");
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (!sideSession.isIdle)
        await new Promise((resolve) => setTimeout(resolve, 10));

      const [parentContext] = parentContexts;
      const [first, second] = sideContexts;
      expect(first.systemPrompt).toBe(parentContext.systemPrompt);
      expect(toolSignature(first)).toBe(toolSignature(parentContext));
      // The parent's whole request, then its reply, start the side chat's.
      expect(first.messages.slice(0, parentContext.messages.length)).toEqual(
        parentContext.messages,
      );
      expect(first.messages[parentContext.messages.length]).toMatchObject({
        role: "assistant",
      });
      expect(JSON.stringify(first.messages.slice(-2))).toContain(
        "read-only tools",
      );
      const blocked = second.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(blocked).toMatchObject({ isError: true });
      expect(JSON.stringify(blocked)).toContain(SIDE_CHAT_BLOCKED_TOOL_REASON);
      expect(existsSync(target)).toBe(false);
      expect(
        sideSession.messages.some(
          (message) =>
            message.role === "custom" &&
            message.customType === PINE_SIDE_CHAT_NOTICE,
        ),
      ).toBe(true);
      // The parent conversation is untouched.
      expect(parentSession.messages).toHaveLength(parentMessageCount);
      // A plain side chat is never written to disk.
      expect(existsSync(path.join(root, "side-chats"))).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("saves a follow-up and reopens it with its messages", async () => {
    const { root, location, runtime, live } = await setup();
    try {
      const parent = await runtime.createSession(location);
      const parentSession = live(parent.session.id);
      parentSession.setSessionName("Side chat test");
      parentSession.agent.streamFunction = (model, context) =>
        reply(context, [{ type: "text", text: "It is 42." }], model);
      await parentSession.prompt("What is the answer?");
      const assistantEntry = parentSession.sessionManager
        .getBranch()
        .filter(
          (entry) =>
            entry.type === "message" && entry.message.role === "assistant",
        )
        .at(-1)!;
      const anchor = {
        messageId: assistantEntry.id,
        start: 6,
        end: 8,
        text: "42",
        quote: "42",
      };
      const directory = path.join(root, "side-chats", parent.session.id);
      const side = await runtime.openSideChat({
        location,
        parentSessionId: parent.session.id,
        sideChatsDirectory: directory,
        anchor,
      });
      expect(side.anchor).toEqual(anchor);
      const sideSession = live(side.session.id);
      const sideContexts: Context[] = [];
      sideSession.agent.streamFunction = (model, context) => {
        sideContexts.push(structuredClone(context));
        return reply(
          context,
          [{ type: "text", text: "Douglas Adams." }],
          model,
        );
      };
      await sideSession.prompt("Who said so?");
      // The model is told which passage the follow-up asks about.
      const asked = JSON.stringify(sideContexts.at(-1)!.messages);
      expect(asked).toContain("<quoted_passage>\\n42\\n</quoted_passage>");
      expect(asked).toContain("one of your replies");
      await runtime.disposeSession(side.session.id);

      const [file] = await readdir(directory);
      const reopened = await runtime.openSideChat({
        location,
        parentSessionId: parent.session.id,
        sideChatsDirectory: directory,
        sideChatFile: path.join(directory, file),
      });
      expect(reopened.anchor).toEqual(anchor);
      expect(
        reopened.messages.map(
          ({ message }) => (message as { role: string }).role,
        ),
      ).toEqual(["user", "assistant"]);
    } finally {
      await runtime.dispose();
    }
  });
  it("edits its own questions but never the conversation's", async () => {
    const { root, location, runtime, live } = await setup();
    try {
      const parent = await runtime.createSession(location);
      const parentSession = live(parent.session.id);
      parentSession.setSessionName("Side chat test");
      parentSession.agent.streamFunction = (model, context) =>
        reply(context, [{ type: "text", text: "It is 42." }], model);
      await parentSession.prompt("What is the answer?");
      const parentQuestion = parentSession.sessionManager
        .getBranch()
        .find(
          (entry) => entry.type === "message" && entry.message.role === "user",
        )!;

      const side = await runtime.openSideChat({
        location,
        parentSessionId: parent.session.id,
        sideChatsDirectory: path.join(root, "side-chats"),
      });
      const sideSession = live(side.session.id);
      const sideContexts: Context[] = [];
      sideSession.agent.streamFunction = (model, context) => {
        sideContexts.push(structuredClone(context));
        return reply(context, [{ type: "text", text: "Because." }], model);
      };
      const idle = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        while (!sideSession.isIdle)
          await new Promise((resolve) => setTimeout(resolve, 10));
      };
      await runtime.prompt(side.session.id, "Why?");
      await idle();
      const question = sideSession.sessionManager
        .getBranch()
        .filter(
          (entry) => entry.type === "message" && entry.message.role === "user",
        )
        .at(-1)!;

      await expect(
        runtime.prompt(
          side.session.id,
          "Rewritten parent",
          undefined,
          undefined,
          undefined,
          undefined,
          { messageId: parentQuestion.id, userMessagesAfter: 1 },
        ),
      ).rejects.toThrow();

      await runtime.prompt(
        side.session.id,
        "Why, exactly?",
        undefined,
        undefined,
        undefined,
        undefined,
        { messageId: question.id, userMessagesAfter: 0 },
      );
      await idle();
      const edited = JSON.stringify(sideContexts.at(-1)!.messages);
      expect(edited).toContain("Why, exactly?");
      expect(edited).not.toContain('"Why?"');
      expect(edited).toContain("What is the answer?");
      expect(edited).toContain("read-only tools");
      // The edit asks with the tools the first question had.
      expect(toolSignature(sideContexts.at(-1)!)).toBe(
        toolSignature(sideContexts[0]),
      );
    } finally {
      await runtime.dispose();
    }
  });
});

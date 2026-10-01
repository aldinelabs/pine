// @vitest-environment node
import {
  BACKGROUND_CONTEXT,
  branchTip,
  insertEntry,
  JsonlSessionRepo,
  setValue,
  type AgentMessage,
  type JsonlSessionMetadata,
  type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PINE_APPROVAL_DECISION_ENTRY,
  PINE_APPROVAL_MODE_ENTRY,
  type PineTextMessage,
} from "../../shared/sessions";
import { ProjectSessionService } from "../sessions";

const temporaryDirectories: string[] = [];

async function createTemporaryProjectData(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pine-sessions-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function serviceOptions(rootPath: string) {
  return {
    cacheRoot: path.join(rootPath, "cache"),
    cwd: path.join(rootPath, "source"),
    sessionsRoot: path.join(rootPath, "sessions"),
  };
}

function textOf(message: Pick<PineTextMessage, "blocks">): string {
  return message.blocks
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");
}

function createRepository(
  environment: NodeExecutionEnv,
  sessionsRoot: string,
): JsonlSessionRepo {
  return new JsonlSessionRepo({ fileSystem: environment, sessionsRoot });
}

async function createSession(
  repository: JsonlSessionRepo,
  cwd: string,
): Promise<Session<JsonlSessionMetadata>> {
  const session = await repository.create({ cwd }, BACKGROUND_CONTEXT);
  await session.createBranch("main", null, BACKGROUND_CONTEXT);
  return session;
}

async function mainBranch(
  session: Session<JsonlSessionMetadata>,
): Promise<NonNullable<Awaited<ReturnType<typeof session.branch>>>> {
  const branch = await session.branch("main", BACKGROUND_CONTEXT);
  if (!branch) throw new Error("Expected a main session branch.");
  return branch;
}

async function appendMessage(
  session: Session<JsonlSessionMetadata>,
  message: AgentMessage,
): Promise<void> {
  await (await mainBranch(session)).appendMessage(message, BACKGROUND_CONTEXT);
}

async function appendCustomEntry(
  session: Session<JsonlSessionMetadata>,
  customType: string,
  data: Record<string, string>,
): Promise<void> {
  await (
    await mainBranch(session)
  ).appendCustomEntry(customType, data, BACKGROUND_CONTEXT);
}

async function appendCompaction(
  session: Session<JsonlSessionMetadata>,
  summary: string,
  tokensBefore: number,
): Promise<void> {
  const branch = await mainBranch(session);
  const parentId = await branch.getTipId(BACKGROUND_CONTEXT);
  const id = session.idGenerator.next();
  await session.mutate(async (mutator) => {
    await mutator.commit(
      [
        insertEntry({
          id,
          parentId,
          type: "compaction",
          summary,
          retainedTail: [],
          tokensBefore,
          fromHook: false,
        }),
        setValue(branchTip("main"), id),
      ],
      BACKGROUND_CONTEXT,
    );
  }, BACKGROUND_CONTEXT);
}

describe("ProjectSessionService", () => {
  it("heals legacy context edits for history reads without changing agent context or the source file", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const manager = SessionManager.create(
      options.cwd,
      path.join(options.sessionsRoot, "legacy"),
    );
    const omittedId = manager.appendMessage({
      role: "user",
      content: "Original omitted message",
      timestamp: Date.now(),
    });
    manager.appendMessage(fauxAssistantMessage("Original reply"));
    manager.appendContextEdit(omittedId, null);
    const replacedId = manager.appendMessage({
      role: "user",
      content: "Original replaced message",
      timestamp: Date.now(),
    });
    manager.appendContextEdit(replacedId, { content: "Replacement context" });
    manager.appendMessage({
      role: "user",
      content: "Latest message",
      timestamp: Date.now(),
    });
    const sessionFile = manager.getSessionFile()!;
    const sessionId = manager.getSessionId();
    const original = await readFile(sessionFile, "utf8");
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.search("Latest message")).resolves.toEqual([
        expect.objectContaining({ id: sessionId }),
      ]);
      const page = await service.loadMessages(sessionId, undefined, 1);
      expect(page.messages.map(textOf)).toEqual(["Latest message"]);
      const earlier = await service.loadMessages(sessionId, page.nextBefore);
      expect(earlier.messages.map(textOf)).toEqual([
        "Original omitted message",
        "Original reply",
        "Original replaced message",
      ]);
      const exported = await service.exportSession(sessionId, "auto-approve");
      expect(exported.markdown).toContain("Original omitted message");
      expect(exported.markdown).toContain("Latest message");
      expect((await service.attachmentForSession(sessionId)).path).toBe(
        sessionFile,
      );
      expect(await readFile(sessionFile, "utf8")).toBe(original);

      const reopened = SessionManager.open(sessionFile);
      expect(reopened.buildSessionContext()).toEqual(
        manager.buildSessionContext(),
      );
      expect(JSON.stringify(reopened.buildSessionContext())).not.toContain(
        "Original omitted message",
      );
      expect(JSON.stringify(reopened.buildSessionContext())).toContain(
        "Replacement context",
      );
      reopened.appendMessage({
        role: "user",
        content: "Continued message",
        timestamp: Date.now(),
      });
      await expect(service.search("Continued message")).resolves.toHaveLength(
        1,
      );
      expect((await service.resumeSession(sessionId)).summary.id).toBe(
        sessionId,
      );
    } finally {
      await service.dispose();
    }
  });

  it("isolates unreadable sessions, retains their last index, and retries after repair", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const damaged = await createSession(repository, options.cwd);
    await appendMessage(damaged, {
      role: "user",
      content: "Previously indexed",
      timestamp: Date.now(),
    });
    const damagedMetadata = damaged.metadata;
    await damaged.close(BACKGROUND_CONTEXT);
    const original = await readFile(damagedMetadata.path, "utf8");
    const service = await ProjectSessionService.create(options);
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await expect(service.search("")).resolves.toHaveLength(1);
      await appendFile(damagedMetadata.path, "{broken json}\n", "utf8");
      const healthy = await createSession(repository, options.cwd);
      await appendMessage(healthy, {
        role: "user",
        content: "New healthy conversation",
        timestamp: Date.now(),
      });
      await healthy.close(BACKGROUND_CONTEXT);
      const unindexed = await createSession(repository, options.cwd);
      const unindexedPath = unindexed.metadata.path;
      await unindexed.close(BACKGROUND_CONTEXT);
      await appendFile(unindexedPath, "{broken json}\n", "utf8");
      const unindexedSource = await readFile(unindexedPath, "utf8");
      await expect(service.search("")).resolves.toHaveLength(2);
      await expect(
        service.search("New healthy conversation"),
      ).resolves.toHaveLength(1);
      await expect(service.loadMessages(damagedMetadata.id)).rejects.toThrow();
      expect(warning).toHaveBeenCalled();
      expect(await readFile(damagedMetadata.path, "utf8")).toBe(
        `${original}{broken json}\n`,
      );
      expect(await readFile(unindexedPath, "utf8")).toBe(unindexedSource);
      await writeFile(damagedMetadata.path, original, "utf8");
      await expect(
        service.loadMessages(damagedMetadata.id),
      ).resolves.toMatchObject({
        messages: [{ blocks: [{ text: "Previously indexed" }] }],
      });
      await expect(service.search("")).resolves.toHaveLength(2);
    } finally {
      await service.dispose();
      await repository.close(BACKGROUND_CONTEXT);
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("keeps healed v3 sessions resumable after renaming and restarting", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const manager = SessionManager.create(
      options.cwd,
      path.join(options.sessionsRoot, "legacy"),
    );
    const targetId = manager.appendMessage({
      role: "user",
      content: "Rename this legacy conversation",
      timestamp: Date.now(),
    });
    manager.appendMessage(fauxAssistantMessage("Reply before context edit"));
    manager.appendContextEdit(targetId, null);
    const sessionFile = manager.getSessionFile()!;
    const original = await readFile(sessionFile, "utf8");
    const sessionId = manager.getSessionId();
    let service = await ProjectSessionService.create(options);

    try {
      // Also exercise invalidation of a cached legacy read handle.
      await service.resumeSession(sessionId);
      expect(
        (await service.renameSession(sessionId, "Recovered conversation")).name,
      ).toBe("Recovered conversation");
      expect((await readFile(sessionFile, "utf8")).startsWith(original)).toBe(
        true,
      );
      const reopened = SessionManager.open(sessionFile);
      expect(reopened.getSessionId()).toBe(sessionId);
      expect(reopened.getSessionName()).toBe("Recovered conversation");
      expect(reopened.buildSessionContext()).toEqual(
        manager.buildSessionContext(),
      );
      reopened.appendMessage({
        role: "user",
        content: "Continue after rename",
        timestamp: Date.now(),
      });
      await service.dispose();
      service = await ProjectSessionService.create(options);
      await expect(service.search("Continue after rename")).resolves.toEqual([
        expect.objectContaining({
          id: sessionId,
          name: "Recovered conversation",
        }),
      ]);
      expect(
        (await service.loadMessages(sessionId)).messages.map(textOf),
      ).toEqual([
        "Rename this legacy conversation",
        "Reply before context edit",
        "Continue after rename",
      ]);
      await appendFile(sessionFile, "{broken json}\n", "utf8");
      const damagedSource = await readFile(sessionFile, "utf8");
      await expect(
        service.renameSession(sessionId, "Should fail"),
      ).rejects.toThrow();
      expect(await readFile(sessionFile, "utf8")).toBe(damagedSource);
    } finally {
      await service.dispose();
    }
  });

  it("creates a new persistent Pi session", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const service = await ProjectSessionService.create(options);

    try {
      const { session, summary } = await service.createSession();

      expect(session.metadata.id).toBe(summary.id);
      expect(summary.messageCount).toBe(0);
      await expect(service.search("")).resolves.toEqual([]);
    } finally {
      await service.dispose();
    }
  });

  it("searches session names and message content in English and Chinese", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    await createSession(repository, path.join(rootPath, "other-source"));
    const session = await createSession(repository, options.cwd);
    await session.setName("Search architecture", BACKGROUND_CONTEXT);
    await appendMessage(session, {
      role: "user",
      content: "Investigate SQLite 全文搜索 for previous sessions",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.search("")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);
      await expect(
        repository.list(undefined, BACKGROUND_CONTEXT),
      ).resolves.toEqual([expect.objectContaining({ id: metadata.id })]);
      await expect(service.search("SQLite")).resolves.toEqual([
        expect.objectContaining({
          id: metadata.id,
          name: "Search architecture",
        }),
      ]);
      await expect(service.search("全文搜索")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);
      await expect(service.search("全")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);

      const resumed = await service.resumeSession(metadata.id);
      expect(resumed.session.metadata.path).toBe(metadata.path);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("keeps sessions visible after the project's default folder changes", async () => {
    const rootPath = await createTemporaryProjectData();
    const previousCwd = path.join(rootPath, "previous-source");
    const nextCwd = path.join(rootPath, "next-source");
    const sessionsRoot = path.join(rootPath, "sessions");
    await Promise.all([
      mkdir(previousCwd, { recursive: true }),
      mkdir(nextCwd, { recursive: true }),
    ]);
    const environment = new NodeExecutionEnv({ cwd: previousCwd });
    const repository = createRepository(environment, sessionsRoot);
    const previousSession = await createSession(repository, previousCwd);
    await appendMessage(previousSession, {
      role: "user",
      content: "Conversation from the previous default folder",
      timestamp: Date.now(),
    });
    const metadata = previousSession.metadata;
    const service = await ProjectSessionService.create({
      cacheRoot: path.join(rootPath, "cache"),
      cwd: nextCwd,
      sessionsRoot,
    });

    try {
      await expect(service.search("")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);
      await expect(service.loadMessages(metadata.id)).resolves.toEqual(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              blocks: [
                {
                  type: "text",
                  text: "Conversation from the previous default folder",
                },
              ],
            }),
          ],
        }),
      );
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("resolves a session JSONL document as a regular file attachment", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await session.setName("Architecture review", BACKGROUND_CONTEXT);
    await appendMessage(session, {
      role: "user",
      content: "Review the event flow",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.attachmentForSession(metadata.id)).resolves.toEqual(
        expect.objectContaining({
          extension: "jsonl",
          kind: "file",
          name: "Architecture review.jsonl",
          path: metadata.path,
          size: expect.any(Number),
        }),
      );
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("loads text messages backwards with a stable cursor", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    for (const content of ["one", "two", "three", "four"]) {
      await appendMessage(session, {
        role: "user",
        content,
        timestamp: Date.now(),
      });
    }
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const newest = await service.loadMessages(
        metadata.id,
        undefined,
        2,
        true,
      );
      expect(newest.messages.map((message) => textOf(message))).toEqual([
        "three",
        "four",
      ]);
      expect(newest.outline?.map((message) => textOf(message))).toEqual([
        "one",
        "two",
        "three",
        "four",
      ]);
      expect(newest.hasMore).toBe(true);

      const earlier = await service.loadMessages(
        metadata.id,
        newest.nextBefore,
        2,
      );
      expect(earlier.messages.map((message) => textOf(message))).toEqual([
        "one",
        "two",
      ]);
      expect(earlier.hasMore).toBe(false);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("keeps history cursors stable when a legacy session is reopened", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    const sessionId = "019cfe51-7166-79b9-a5b9-c652fcca9eab";
    const sessionDirectory = path.join(
      options.sessionsRoot,
      `--${options.cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`,
    );
    await Promise.all([
      mkdir(options.cwd, { recursive: true }),
      mkdir(sessionDirectory, { recursive: true }),
    ]);
    const records = [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: options.cwd,
      },
      ...["one", "two", "three", "four"].map((content, index) => ({
        type: "message",
        id: `legacy0${index + 1}`,
        parentId: index === 0 ? null : `legacy0${index}`,
        timestamp: `2026-01-01T00:00:0${index + 1}.000Z`,
        message: {
          role: "user",
          content,
          timestamp: Date.UTC(2026, 0, 1, 0, 0, index + 1),
        },
      })),
    ];
    await writeFile(
      path.join(sessionDirectory, `legacy_${sessionId}.jsonl`),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    const service = await ProjectSessionService.create(options);

    try {
      const newest = await service.loadMessages(sessionId, undefined, 2);
      expect(newest.messages.map((message) => textOf(message))).toEqual([
        "three",
        "four",
      ]);
      expect(newest.nextBefore).toBe("seq:3");

      // loadMessages intentionally reopens closed sessions. Legacy imports
      // remint entry IDs on every open, but their sequence numbers are stable.
      const earlier = await service.loadMessages(
        sessionId,
        newest.nextBefore,
        2,
      );
      expect(earlier.messages.map((message) => textOf(message))).toEqual([
        "one",
        "two",
      ]);
      expect(earlier.hasMore).toBe(false);
    } finally {
      await service.dispose();
    }
  });

  it("restores thinking duration and completed tool calls", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    const toolCallId = "call-read-main";
    await appendMessage(
      session,
      fauxAssistantMessage(
        [
          fauxThinking("Find the relevant file."),
          fauxToolCall(
            "read",
            { path: "/project/src/main.ts" },
            {
              id: toolCallId,
            },
          ),
        ],
        { stopReason: "toolUse", timestamp: Date.now() - 1_500 },
      ),
    );
    await appendMessage(session, {
      role: "toolResult",
      toolCallId,
      toolName: "read",
      content: [{ type: "text", text: "export {}" }],
      isError: false,
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.loadMessages(metadata.id);

      expect(result.messages).toEqual([
        expect.objectContaining({
          thinkingDurationMs: expect.any(Number),
          blocks: [
            { type: "thinking", thinking: "Find the relevant file." },
            {
              type: "toolCall",
              toolCall: expect.objectContaining({
                id: toolCallId,
                name: "read",
                status: "complete",
              }),
            },
          ],
        }),
      ]);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("finds only the successful presented path in persisted tool history", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    const presentedPath = path.join(rootPath, "tmp", "tool_probe.txt");
    await appendMessage(
      session,
      fauxAssistantMessage(
        [
          fauxToolCall(
            "ui_present_file",
            { path: presentedPath },
            { id: "present-ok" },
          ),
          fauxToolCall(
            "ui_present_file",
            { path: "/private/file" },
            { id: "present-error" },
          ),
          fauxToolCall("read", { path: "/private/file" }, { id: "read-call" }),
        ],
        { stopReason: "toolUse" },
      ),
    );
    for (const [toolCallId, toolName, isError, filePath] of [
      ["present-ok", "ui_present_file", false, presentedPath],
      ["present-error", "ui_present_file", true, "/private/file"],
      ["read-call", "read", false, "/private/file"],
    ] as const) {
      await appendMessage(session, {
        role: "toolResult",
        toolCallId,
        toolName,
        content: [{ type: "text", text: "done" }],
        details: { path: filePath },
        isError,
        timestamp: Date.now(),
      });
    }
    const service = await ProjectSessionService.create(options);
    try {
      expect(
        await service.presentedFilePath(session.metadata.id, "present-ok"),
      ).toBe(presentedPath);
      expect(
        await service.presentedFilePath(session.metadata.id, "present-error"),
      ).toBeNull();
      expect(
        await service.presentedFilePath(session.metadata.id, "read-call"),
      ).toBeNull();
      expect(
        await service.presentedFilePath(session.metadata.id, "unknown"),
      ).toBeNull();
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("preserves structured tool details when replaying old questionnaires", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    const toolCallId = "call-questionnaire-main";
    const details = {
      answers: [{ questionIndex: 0 }, { questionIndex: 1 }],
      cancelled: false,
    };
    await appendMessage(
      session,
      fauxAssistantMessage(
        [
          fauxToolCall(
            "ask_user_question",
            { questions: [{ question: "Pick one" }] },
            { id: toolCallId },
          ),
        ],
        { stopReason: "toolUse" },
      ),
    );
    await appendMessage(session, {
      role: "toolResult",
      toolCallId,
      toolName: "ask_user_question",
      content: [{ type: "text", text: "User has answered your questions." }],
      details,
      isError: false,
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.loadMessages(metadata.id);
      const toolCall = result.messages[0]?.blocks[0];
      expect(toolCall).toEqual(
        expect.objectContaining({
          type: "toolCall",
          toolCall: expect.objectContaining({
            output: {
              content: [{ type: "text", text: expect.any(String) }],
              details,
            },
          }),
        }),
      );
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("restores denied approval markers from persisted decisions", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    const toolCallId = "call-denied-main";
    await appendMessage(
      session,
      fauxAssistantMessage(
        [
          fauxToolCall(
            "bash",
            { command: "rm -rf important-data" },
            { id: toolCallId },
          ),
        ],
        { stopReason: "toolUse" },
      ),
    );
    await appendCustomEntry(session, PINE_APPROVAL_DECISION_ENTRY, {
      requestId: "judge-1",
      toolCallId,
      verdict: "denied",
      decidedBy: "judge",
      reason: "Use a safer command.",
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.loadMessages(metadata.id)).resolves.toEqual({
        hasMore: false,
        messages: [
          expect.objectContaining({
            blocks: [
              {
                type: "toolCall",
                toolCall: expect.objectContaining({
                  id: toolCallId,
                  approval: {
                    state: "denied",
                    decidedBy: "judge",
                    reason: "Use a safer command.",
                  },
                }),
              },
            ],
          }),
        ],
      });
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("exports the complete conversation with persisted settings", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await session.setName("Export me", BACKGROUND_CONTEXT);
    await appendCustomEntry(session, PINE_APPROVAL_MODE_ENTRY, {
      approvalMode: "YOLO",
    });
    await appendMessage(session, {
      role: "user",
      content: "Inspect the project",
      timestamp: Date.now(),
    });
    await appendMessage(session, {
      ...fauxAssistantMessage([{ type: "text", text: "Done." }]),
      provider: "openai",
      model: "gpt-test",
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.exportSession(metadata.id, "auto-approve");

      expect(result.fileName).toBe("Export me.md");
      expect(result.markdown).toContain("- Approval mode: YOLO");
      expect(result.markdown).toContain("- Models used:\n  - openai/gpt-test");
      expect(result.markdown).toContain("Inspect the project");
      expect(result.markdown).toContain("Done.");
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("uses a portable fallback for Windows-reserved export names", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await session.setName("CON", BACKGROUND_CONTEXT);
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.exportSession(metadata.id, "auto-approve");

      expect(result.fileName).toBe(`conversation-${metadata.id}.md`);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("restores assistant request errors from session history", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(
      session,
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "Provider request failed",
      }),
    );
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.loadMessages(metadata.id)).resolves.toEqual({
        hasMore: false,
        messages: [
          expect.objectContaining({
            blocks: [
              {
                type: "error",
                error: { message: "Provider request failed" },
              },
            ],
          }),
        ],
      });
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("restores completed compaction markers from session history", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(session, {
      role: "user",
      content: "A long conversation",
      timestamp: Date.now(),
    });
    await appendCompaction(
      session,
      "The earlier conversation was summarized.",
      25_000,
    );
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.loadMessages(metadata.id);

      expect(result.messages).toEqual([
        expect.objectContaining({
          blocks: [{ type: "text", text: "A long conversation" }],
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^compaction-/),
          blocks: [
            {
              type: "compaction",
              compaction: {
                id: expect.any(String),
                status: "complete",
              },
            },
          ],
        }),
      ]);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("deletes a session and removes it from search", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(session, {
      role: "user",
      content: "Delete this conversation",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.search("")).resolves.toHaveLength(1);
      await expect(service.deleteSession(metadata.id)).resolves.toBe(true);
      await expect(service.search("")).resolves.toEqual([]);
      await expect(service.deleteSession(metadata.id)).resolves.toBe(false);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("persists a renamed session and refreshes its search title", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(session, {
      role: "user",
      content: "Original first message",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const renamed = await service.renameSession(
        metadata.id,
        "Renamed conversation",
      );

      expect(renamed.name).toBe("Renamed conversation");
      await expect(service.search("Renamed conversation")).resolves.toEqual([
        expect.objectContaining({
          id: metadata.id,
          name: "Renamed conversation",
          preview: "Original first message",
        }),
      ]);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });
});

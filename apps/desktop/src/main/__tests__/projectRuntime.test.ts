// @vitest-environment node
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PineProject } from "../../shared/projects";
import { serializeAttachmentMessage } from "../../shared/attachments";
import type {
  PineContextUsage,
  PineSessionSummary,
} from "../../shared/sessions";
import type { AgentHost } from "../agentProcessHost";
import { ProjectSessionService } from "../sessions";
import { ProjectRuntimeRegistry } from "../projectRuntime";

const temporaryDirectories: string[] = [];
const sessionSummary: PineSessionSummary = {
  id: "0198e338-fb55-7e18-a23e-a7028500f123",
  createdAt: "2026-08-24T12:00:00.000Z",
  updatedAt: "2026-08-24T12:00:00.000Z",
  messageCount: 0,
};

function createAgentHost(): AgentHost {
  return {
    abort: vi.fn().mockResolvedValue({ aborted: false }),
    compact: vi.fn().mockResolvedValue({ compacted: true }),
    dequeueSteering: vi.fn().mockResolvedValue({ removed: false }),
    createSession: vi.fn().mockResolvedValue({ session: sessionSummary }),
    disposeSession: vi.fn().mockResolvedValue({ disposed: true }),
    addCustomModel: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    updateCustomModel: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    deleteCustomModel: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    updateCustomProvider: vi
      .fn()
      .mockResolvedValue({ models: [], providers: [] }),
    deleteCustomProvider: vi
      .fn()
      .mockResolvedValue({ models: [], providers: [] }),
    getModelCatalog: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    refreshModelCatalog: vi
      .fn()
      .mockResolvedValue({ models: [], providers: [] }),
    loginProvider: vi.fn().mockResolvedValue({ credentialType: "api_key" }),
    respondToProviderAuth: vi.fn().mockResolvedValue({ accepted: true }),
    cancelProviderAuth: vi.fn().mockResolvedValue({ cancelled: true }),
    logoutProvider: vi.fn().mockResolvedValue({ disposed: true }),
    selectModel: vi.fn().mockResolvedValue({ disposed: true }),
    selectUtilityModel: vi.fn().mockResolvedValue({ updated: true }),
    selectImageModel: vi.fn().mockResolvedValue({ updated: true }),
    setTinyFishApiKey: vi.fn().mockResolvedValue({ updated: true }),
    setContextCompactionStrategy: vi.fn().mockResolvedValue({ updated: true }),
    openSession: vi.fn().mockResolvedValue({ session: sessionSummary }),
    prompt: vi.fn().mockResolvedValue({
      accepted: true,
      session: { ...sessionSummary, messageCount: 2 },
    }),
    renameSession: vi.fn().mockImplementation((sessionId, name) =>
      Promise.resolve({
        session: { ...sessionSummary, id: sessionId, name },
      }),
    ),
    respondApproval: vi.fn(),
    respondQuestionnaire: vi.fn(),
    setApprovalMode: vi.fn().mockResolvedValue({ updated: true }),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function createRuntimeFixture(): Promise<{
  dataRoot: string;
  project: PineProject;
}> {
  const folderPath = await mkdtemp(
    path.join(os.tmpdir(), "pine-runtime-folder-"),
  );
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "pine-runtime-data-"));
  temporaryDirectories.push(folderPath, dataRoot);
  const now = new Date().toISOString();
  return {
    dataRoot,
    project: {
      createdAt: now,
      defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      folders: [
        {
          access: "read-write",
          id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
          isAvailable: true,
          name: "source",
          path: folderPath,
        },
      ],
      id: "7f48c81c-f1dc-4be6-a8ee-55729ef647ba",
      name: "runtime-test",
      schemaVersion: 1,
      updatedAt: now,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProjectRuntimeRegistry", () => {
  it("keeps background task controls within their owning window", async () => {
    const host = createAgentHost();
    const listTasks = vi.fn().mockResolvedValue({ tasks: [] });
    const stopTask = vi.fn().mockResolvedValue({ task: {} });
    const readOutput = vi.fn().mockResolvedValue({ content: "output" });
    host.listBackgroundTasks = listTasks;
    host.stopBackgroundTask = stopTask;
    host.readBackgroundTaskOutput = readOutput;
    const registry = new ProjectRuntimeRegistry(host, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();
    const paths = {
      attachmentsRoot: path.join(dataRoot, "attachments"),
      cacheRoot: path.join(dataRoot, "cache"),
      projectRoot: dataRoot,
      sessionsRoot: path.join(dataRoot, "sessions"),
    };
    await registry.open(1, project, paths);
    await registry.open(2, project, paths);
    try {
      expect(await registry.listBackgroundTasks(1, sessionSummary.id)).toEqual({
        tasks: [],
      });
      expect(listTasks).not.toHaveBeenCalled();
      await registry.prompt(1, { message: "Start", target: { kind: "new" } });
      const request = { sessionId: sessionSummary.id, taskId: "b1234abcd" };
      await registry.listBackgroundTasks(1, request.sessionId);
      await registry.stopBackgroundTask(1, request);
      await registry.readBackgroundTaskOutput(1, request);
      expect(stopTask).toHaveBeenCalledWith(request.sessionId, request.taskId);
      expect(readOutput).toHaveBeenCalledWith(
        request.sessionId,
        request.taskId,
        128 * 1024,
      );
      for (const method of [
        "stopBackgroundTask",
        "readBackgroundTaskOutput",
      ] as const) {
        await expect(registry[method](2, request)).rejects.toThrow(
          "Session does not belong to this window",
        );
      }
      expect(await registry.listBackgroundTasks(2, request.sessionId)).toEqual({
        tasks: [],
      });
    } finally {
      await registry.dispose(1);
      await registry.dispose(2);
    }
  });

  it("routes questionnaire answers only from the owning window", () => {
    const agentHost = createAgentHost();
    const respondQuestionnaire = vi.fn();
    agentHost.respondQuestionnaire = respondQuestionnaire;
    const registry = new ProjectRuntimeRegistry(agentHost, "/tmp/pine-agent");
    const requestId = "019cfe51-7166-79b9-a5b9-c652fcca9eab";
    const submission = {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          selectedOptionIndexes: [1],
        },
      ],
    };
    registry.trackQuestionnaire(requestId, 7);

    expect(() =>
      registry.respondQuestionnaire(8, { requestId, submission }),
    ).toThrow("Questionnaire does not belong to this window.");
    expect(registry.respondQuestionnaire(7, { requestId, submission })).toEqual(
      { accepted: true },
    );
    expect(respondQuestionnaire).toHaveBeenCalledWith(requestId, submission);
  });

  it("returns the latest usage when resuming the active session", async () => {
    const registry = new ProjectRuntimeRegistry(
      createAgentHost(),
      "/pine/agent",
    );
    const { dataRoot, project } = await createRuntimeFixture();
    const contextUsage: PineContextUsage = {
      tokens: 86_400,
      contextWindow: 200_000,
      percent: 43.2,
      cost: 0.1234,
      cacheHitRate: null,
    };

    try {
      await registry.open(1, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      const prompted = await registry.prompt(1, {
        message: "Start",
        target: { kind: "new" },
      });
      registry.updateContextUsage(prompted.session.id, contextUsage);

      await expect(registry.resume(1, prompted.session.id)).resolves.toEqual({
        session: prompted.session,
        contextUsage,
      });
    } finally {
      await registry.dispose(1);
    }
  });

  it("resolves a presented path into a project or presented tab target", async () => {
    const registry = new ProjectRuntimeRegistry(
      createAgentHost(),
      "/pine/agent",
    );
    const { dataRoot, project } = await createRuntimeFixture();
    const folderPath = project.folders[0].path;
    const externalPath = path.join(dataRoot, "report.pdf");

    try {
      await registry.open(1, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      const prompted = await registry.prompt(1, {
        message: "Start",
        target: { kind: "new" },
      });
      const sessionId = prompted.session.id;

      await mkdir(path.join(folderPath, "docs"));
      await Promise.all([
        writeFile(path.join(folderPath, "docs", "notes.md"), "# Notes"),
        writeFile(externalPath, "pdf"),
      ]);

      // A project file stays inside the validated project-entry channel.
      await expect(
        registry.resolvePresentTarget(
          sessionId,
          path.join(folderPath, "docs", "notes.md"),
        ),
      ).resolves.toEqual({
        folderId: project.defaultFolderId,
        projectId: project.id,
        relativePath: "docs/notes.md",
        source: "project",
      });

      // Anything else is reported as presented, with the canonical path main
      // will have to grant before the renderer can read it.
      await expect(
        registry.resolvePresentTarget(sessionId, externalPath),
      ).resolves.toEqual({
        path: await realpath(externalPath),
        source: "presented",
      });

      const historicalPath = vi
        .spyOn(ProjectSessionService.prototype, "presentedFilePath")
        .mockResolvedValue(await realpath(externalPath));
      const historicalSessionId = "0198e338-fb55-7e18-a23e-a7028500f999";
      await expect(
        registry.reopenPresentedToolFile(
          1,
          historicalSessionId,
          "old-present-call",
        ),
      ).resolves.toEqual({
        path: await realpath(externalPath),
        source: "presented",
      });
      expect(historicalPath).toHaveBeenCalledWith(
        historicalSessionId,
        "old-present-call",
      );
      historicalPath.mockResolvedValue(path.join(dataRoot, "missing.txt"));
      await expect(
        registry.reopenPresentedToolFile(1, sessionId, "missing-present-call"),
      ).resolves.toBeNull();
      // A symlink inside the folder must not launder an outside file.
      const linkPath = path.join(folderPath, "escape.md");
      await symlink(externalPath, linkPath);
      await expect(
        registry.resolvePresentTarget(sessionId, linkPath),
      ).resolves.toEqual({
        path: await realpath(externalPath),
        source: "presented",
      });
      historicalPath.mockResolvedValue(linkPath);
      await expect(
        registry.reopenPresentedToolFile(1, sessionId, "changed-link-call"),
      ).resolves.toBeNull();
      historicalPath.mockRestore();

      // Deleted files and unknown sessions never become a tab.
      await expect(
        registry.resolvePresentTarget(
          sessionId,
          path.join(folderPath, "gone.md"),
        ),
      ).resolves.toBeNull();
      await expect(
        registry.resolvePresentTarget(
          "0198e338-fb55-7e18-a23e-a7028500f999",
          externalPath,
        ),
      ).resolves.toBeNull();
    } finally {
      await registry.dispose(1);
    }
  });

  it("reuses an explicitly targeted active session", async () => {
    const agentHost = createAgentHost();
    const createSession = vi.spyOn(agentHost, "createSession");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(1, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(1, {
        message: "Start",
        target: { kind: "new" },
      });
      await registry.prompt(1, {
        message: "Continue",
        target: { kind: "session", sessionId: sessionSummary.id },
      });
      expect(createSession).toHaveBeenCalledOnce();
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: project.folders[0].path,
          folders: [
            {
              access: "read-write",
              path: project.folders[0].path,
            },
          ],
        }),
      );
    } finally {
      await registry.dispose(1);
    }
  });

  it("keeps draft defaults separate from an active conversation model", async () => {
    const agentHost = createAgentHost();
    const selectModel = vi.spyOn(agentHost, "selectModel");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(1, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(1, {
        message: "Conversation A",
        target: { kind: "new" },
      });

      await registry.selectModel(1, {
        providerId: "provider",
        modelId: "model-b",
        thinkingLevel: "high",
      });
      await registry.selectModel(1, {
        providerId: "provider",
        modelId: "model-c",
        sessionId: sessionSummary.id,
        thinkingLevel: "medium",
      });

      expect(selectModel).toHaveBeenNthCalledWith(
        1,
        "/pine/agent",
        "provider",
        "model-b",
        "high",
        undefined,
      );
      expect(selectModel).toHaveBeenNthCalledWith(
        2,
        "/pine/agent",
        "provider",
        "model-c",
        "medium",
        sessionSummary.id,
      );
    } finally {
      await registry.dispose(1);
    }
  });

  it("dequeues steering from the active agent session", async () => {
    const agentHost = createAgentHost();
    const dequeueSteering = vi
      .spyOn(agentHost, "dequeueSteering")
      .mockResolvedValue({ message: "Change direction", removed: true });
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(1, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(1, {
        message: "Start",
        target: { kind: "new" },
      });

      await expect(
        registry.dequeueSteering(1, "Change direction"),
      ).resolves.toEqual({ message: "Change direction", removed: true });
      expect(dequeueSteering).toHaveBeenCalledWith(
        sessionSummary.id,
        "Change direction",
      );
    } finally {
      await registry.dispose(1);
    }
  });

  it("renames an active session through the agent worker", async () => {
    const agentHost = createAgentHost();
    const renameSession = vi.spyOn(agentHost, "renameSession");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(7, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(7, {
        message: "Start",
        target: { kind: "new" },
      });

      await expect(
        registry.renameSession(7, sessionSummary.id, "Renamed session"),
      ).resolves.toEqual(
        expect.objectContaining({
          id: sessionSummary.id,
          name: "Renamed session",
        }),
      );
      expect(renameSession).toHaveBeenCalledWith(
        sessionSummary.id,
        "Renamed session",
      );
    } finally {
      await registry.dispose(7);
    }
  });

  it("lists files through a folder ID from the active project", async () => {
    const registry = new ProjectRuntimeRegistry(
      createAgentHost(),
      "/pine/agent",
    );
    const { dataRoot, project } = await createRuntimeFixture();
    await writeFile(path.join(project.folders[0].path, "README.md"), "Pine");

    try {
      await registry.open(2, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await expect(
        registry.listDirectory(2, project.folders[0].id, ""),
      ).resolves.toEqual([
        { kind: "file", name: "README.md", relativePath: "README.md" },
      ]);
      await expect(
        registry.listDirectory(2, crypto.randomUUID(), ""),
      ).rejects.toThrow("Folder not found in the active project.");
    } finally {
      await registry.dispose(2);
    }
  });

  it("creates the active session before forwarding the first prompt", async () => {
    const agentHost = createAgentHost();
    const createSession = vi.spyOn(agentHost, "createSession");
    const prompt = vi.spyOn(agentHost, "prompt");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(3, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });

      await expect(
        registry.prompt(3, {
          message: "Imagine what is possible",
          target: { kind: "new" },
        }),
      ).resolves.toEqual({
        accepted: true,
        session: { ...sessionSummary, messageCount: 2 },
      });
      expect(createSession).toHaveBeenCalledOnce();
      expect(prompt).toHaveBeenCalledWith(
        sessionSummary.id,
        "Imagine what is possible",
        undefined,
        undefined,
        "auto-approve",
      );
    } finally {
      await registry.dispose(3);
    }
  });

  it("forwards direct attachment paths as read-only agent grants", async () => {
    const agentHost = createAgentHost();
    const prompt = vi.spyOn(agentHost, "prompt");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();
    const message = serializeAttachmentMessage(
      [
        {
          extension: "",
          kind: "directory",
          modifiedAt: "2026-09-02T12:00:00.000Z",
          name: "references",
          path: "/Users/example/references",
          size: 96,
        },
      ],
      "Review these references.",
    );

    try {
      await registry.open(8, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(8, {
        message,
        target: { kind: "new" },
      });

      expect(prompt).toHaveBeenCalledWith(
        sessionSummary.id,
        message,
        undefined,
        ["/Users/example/references"],
        "auto-approve",
      );
    } finally {
      await registry.dispose(8);
    }
  });

  it("creates a fresh session when a prompt does not target a session", async () => {
    const nextSession = {
      ...sessionSummary,
      id: "0198e338-fb55-7e18-a23e-a7028500f124",
    };
    const agentHost = createAgentHost();
    const createSession = vi
      .spyOn(agentHost, "createSession")
      .mockResolvedValueOnce({ session: sessionSummary })
      .mockResolvedValueOnce({ session: nextSession });
    const disposeSession = vi.spyOn(agentHost, "disposeSession");
    const prompt = vi.spyOn(agentHost, "prompt").mockResolvedValue({
      accepted: true,
      session: { ...nextSession, messageCount: 2 },
    });
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(5, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(5, {
        message: "First conversation",
        target: { kind: "new" },
      });

      await registry.prompt(5, {
        message: "Start over",
        target: { kind: "new" },
      });

      expect(disposeSession).not.toHaveBeenCalled();
      expect(registry.ownerOfSession(sessionSummary.id)).toBe(5);
      expect(registry.ownerOfSession(nextSession.id)).toBe(5);
      await registry.resume(5, sessionSummary.id);
      expect(disposeSession).not.toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(prompt).toHaveBeenCalledWith(
        nextSession.id,
        "Start over",
        undefined,
        undefined,
        "auto-approve",
      );
    } finally {
      await registry.dispose(5);
    }
  });

  it("continues the session explicitly targeted by a prompt", async () => {
    const agentHost = createAgentHost();
    const createSession = vi.spyOn(agentHost, "createSession");
    const prompt = vi.spyOn(agentHost, "prompt");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(6, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(6, {
        message: "Start here",
        target: { kind: "new" },
      });

      await registry.prompt(6, {
        message: "Continue here",
        target: { kind: "session", sessionId: sessionSummary.id },
        approvalMode: "let-me-review",
      });

      expect(createSession).toHaveBeenCalledOnce();
      expect(prompt).toHaveBeenCalledWith(
        sessionSummary.id,
        "Continue here",
        undefined,
        undefined,
        "let-me-review",
      );
    } finally {
      await registry.dispose(6);
    }
  });

  it("updates the active worker session when approval mode changes", async () => {
    const agentHost = createAgentHost();
    const setApprovalMode = vi.spyOn(agentHost, "setApprovalMode");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    try {
      await registry.open(9, project, {
        attachmentsRoot: path.join(dataRoot, "attachments"),
        cacheRoot: path.join(dataRoot, "cache"),
        projectRoot: dataRoot,
        sessionsRoot: path.join(dataRoot, "sessions"),
      });
      await registry.prompt(9, {
        message: "Start here",
        target: { kind: "new" },
      });

      await expect(
        registry.setApprovalMode(9, "let-me-review"),
      ).resolves.toEqual({ updated: true });
      expect(setApprovalMode).toHaveBeenCalledWith(
        sessionSummary.id,
        "let-me-review",
      );
    } finally {
      await registry.dispose(9);
    }
  });

  it("disposes a session that finishes creating after its project closes", async () => {
    const creationDeferred = deferred<{
      session: PineSessionSummary;
    }>();
    const agentHost = createAgentHost();
    const createSession = vi
      .spyOn(agentHost, "createSession")
      .mockReturnValue(creationDeferred.promise);
    const disposeSession = vi.spyOn(agentHost, "disposeSession");
    const registry = new ProjectRuntimeRegistry(agentHost, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();

    await registry.open(4, project, {
      attachmentsRoot: path.join(dataRoot, "attachments"),
      cacheRoot: path.join(dataRoot, "cache"),
      projectRoot: dataRoot,
      sessionsRoot: path.join(dataRoot, "sessions"),
    });
    const creation = registry.prompt(4, {
      message: "Start",
      target: { kind: "new" },
    });
    await Promise.resolve();
    const disposal = registry.dispose(4);
    creationDeferred.resolve({ session: sessionSummary });

    await expect(creation).rejects.toThrow(
      "The active project changed while creating a session.",
    );
    await disposal;
    expect(createSession).toHaveBeenCalledOnce();
    expect(disposeSession).toHaveBeenCalledWith(sessionSummary.id);
  });
  it("creates concurrent sessions independently and targets controls without changing siblings", async () => {
    const host = createAgentHost();
    const setApprovalMode = vi.spyOn(host, "setApprovalMode");
    const compact = vi.spyOn(host, "compact");
    const abort = vi.spyOn(host, "abort");
    const disposeSession = vi.spyOn(host, "disposeSession");
    const first = deferred<{ session: PineSessionSummary }>();
    const second = deferred<{ session: PineSessionSummary }>();
    const other = {
      ...sessionSummary,
      id: "0198e338-fb55-7e18-a23e-a7028500f124",
    };
    const createSession = vi
      .spyOn(host, "createSession")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.spyOn(host, "prompt").mockImplementation((sessionId) =>
      Promise.resolve({
        accepted: true,
        session: { ...sessionSummary, id: sessionId },
      }),
    );
    const registry = new ProjectRuntimeRegistry(host, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();
    await registry.open(1, project, {
      attachmentsRoot: path.join(dataRoot, "attachments"),
      cacheRoot: path.join(dataRoot, "cache"),
      projectRoot: dataRoot,
      sessionsRoot: path.join(dataRoot, "sessions"),
    });
    try {
      const creatingA = registry.prompt(1, {
        message: "A",
        target: { kind: "new" },
        approvalMode: "let-me-review",
      });
      const creatingB = registry.prompt(1, {
        message: "B",
        target: { kind: "new" },
        approvalMode: "YOLO",
      });
      second.resolve({ session: other });
      await creatingB;
      first.resolve({ session: sessionSummary });
      await creatingA;
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(disposeSession).not.toHaveBeenCalled();
      expect(registry.ownerOfSession(sessionSummary.id)).toBe(1);
      expect(registry.ownerOfSession(other.id)).toBe(1);
      await registry.resume(1, other.id);
      await registry.abort(1, sessionSummary.id);
      await registry.compact(1, sessionSummary.id);
      await registry.setApprovalMode(1, "autonomous", sessionSummary.id);
      expect(abort).toHaveBeenCalledWith(sessionSummary.id);
      expect(compact).toHaveBeenCalledWith(sessionSummary.id);
      expect(setApprovalMode).toHaveBeenCalledWith(
        sessionSummary.id,
        "autonomous",
      );
      await expect(registry.abort(1, "unknown")).rejects.toThrow(
        "does not belong",
      );
      expect(disposeSession).not.toHaveBeenCalled();
    } finally {
      await registry.dispose(1);
    }
    expect(disposeSession).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent opens and releases a late open when the project closes", async () => {
    const host = createAgentHost();
    const disposeSession = vi.spyOn(host, "disposeSession");
    const opening = deferred<{ session: PineSessionSummary }>();
    const openSession = vi
      .spyOn(host, "openSession")
      .mockReturnValue(opening.promise);
    const registry = new ProjectRuntimeRegistry(host, "/pine/agent");
    const { dataRoot, project } = await createRuntimeFixture();
    await registry.open(2, project, {
      attachmentsRoot: path.join(dataRoot, "attachments"),
      cacheRoot: path.join(dataRoot, "cache"),
      projectRoot: dataRoot,
      sessionsRoot: path.join(dataRoot, "sessions"),
    });
    const describe = vi
      .spyOn(ProjectSessionService.prototype, "describeSession")
      .mockResolvedValue({
        sessionFile: "/tmp/session.jsonl",
        summary: sessionSummary,
      });
    const first = registry.resume(2, sessionSummary.id);
    const second = registry.resume(2, sessionSummary.id);
    const outcomes = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledOnce());
    const closing = registry.dispose(2);
    opening.resolve({ session: sessionSummary });
    const results = await outcomes;
    await closing;
    expect(describe).toHaveBeenCalledOnce();
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(disposeSession).toHaveBeenCalledExactlyOnceWith(sessionSummary.id);
    expect(registry.ownerOfSession(sessionSummary.id)).toBeUndefined();
  });

  it("expires only the terminated session's pending interactions", () => {
    const host = createAgentHost();
    const respondApproval = vi.spyOn(host, "respondApproval");
    const registry = new ProjectRuntimeRegistry(host, "/pine/agent");
    registry.trackApproval("a", 1, "session-a");
    registry.trackApproval("b", 1, "session-b");
    registry.trackQuestionnaire("q-a", 1, "session-a");
    registry.clearSessionInteractions("session-a");
    expect(() =>
      registry.respondApproval(1, { requestId: "a", action: "approve" }),
    ).toThrow("no longer pending");
    expect(() =>
      registry.respondQuestionnaire(1, {
        requestId: "q-a",
        submission: { answers: [], cancelled: true },
      }),
    ).toThrow("no longer pending");
    expect(
      registry.respondApproval(1, { requestId: "b", action: "approve" }),
    ).toEqual({ accepted: true });
    expect(respondApproval).toHaveBeenCalledExactlyOnceWith("b", {
      kind: "allow",
    });
  });
});

import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionLocation } from "../../../agent/protocol";
import { parseAutomationRunMessage } from "../../../shared/automationRunMessage";
import type { PineProject } from "../../../shared/projects";
import { AutomationSecretStore } from "../secrets";
import {
  AutomationService,
  type AutomationAgentPort,
  type AutomationNotification,
} from "../service";
import { AutomationStore } from "../store";
import {
  PROJECT_ID,
  fakeStorage,
  manualSpec,
  temporaryProject,
} from "./fixtures";

let root: string;
let docs: string;
let project: PineProject;
let service: AutomationService;
let locations: AgentSessionLocation[];
let prompts: string[];
let notifications: AutomationNotification[];
let finishRun: (sessionId: string, location: AgentSessionLocation) => void;

function createService(agent?: Partial<AutomationAgentPort>) {
  let sessions = 0;
  const port: AutomationAgentPort = {
    createSession: vi.fn((location: AgentSessionLocation) => {
      locations.push(location);
      sessions += 1;
      return Promise.resolve({ sessionId: `session-${sessions}` });
    }),
    selectModel: vi.fn(() => Promise.resolve()),
    prompt: vi.fn((sessionId: string, message: string) => {
      prompts.push(message);
      const location = locations.at(-1)!;
      setTimeout(() => finishRun(sessionId, location), 0);
      return Promise.resolve();
    }),
    abort: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(() => Promise.resolve()),
    ...agent,
  };
  return new AutomationService({
    store: new AutomationStore(path.join(root, "projects")),
    secrets: new AutomationSecretStore(
      () => path.join(root, "projects", PROJECT_ID, "automation-secrets.json"),
      fakeStorage,
    ),
    projects: {
      list: () => Promise.resolve([project]),
      dataPaths: () => ({
        projectRoot: path.join(root, "projects", PROJECT_ID),
        sessionsRoot: path.join(root, "projects", PROJECT_ID, "sessions"),
        attachmentsRoot: path.join(root, "attachments"),
        cacheRoot: path.join(root, "cache"),
      }),
    },
    agent: port,
    agentDirectory: path.join(root, "agent"),
    tinyFishApiKey: () => undefined,
    fetch: vi.fn(),
    notify: (notification) => notifications.push(notification),
    changed: vi.fn(),
    locale: () => "en-US",
    mcpServers: () => Promise.resolve(["github"]),
    platform: "darwin",
  });
}

async function approveNext(): Promise<void> {
  await vi.waitFor(() => expect(service.pendingApprovals()).toHaveLength(1));
  service.respondApproval(
    "desktop",
    service.pendingApprovals()[0].requestId,
    true,
  );
}

async function createApproved(spec = manualSpec()): Promise<string> {
  const created = service.create(
    { projectId: PROJECT_ID, sessionId: "author" },
    spec,
    { afterExternalContent: false },
  );
  await approveNext();
  const result = await created;
  if (!("id" in result)) throw new Error(result.errors.join("\n"));
  return result.id;
}

async function lastRun() {
  const [run] = await service.listRuns({ filter: "all" });
  return run;
}

beforeEach(async () => {
  ({ root, docs, project } = await temporaryProject());
  locations = [];
  prompts = [];
  notifications = [];
  finishRun = (sessionId, location) => {
    void service
      .report(sessionId, {
        op: "report",
        runId: location.automation!.runId,
        status: "findings",
        summary: "Wrote the summary.",
      })
      .then(() =>
        service.observeAgentEvent({
          type: "run-state",
          sessionId,
          state: "idle",
        }),
      );
  };
  service = createService();
  await service.start();
});

afterEach(async () => {
  await service.stop();
  await rm(root, { recursive: true, force: true });
});

describe("AutomationService approvals", () => {
  it("saves a definition only after approval on this computer", async () => {
    const created = service.create(
      { projectId: PROJECT_ID, sessionId: "author" },
      manualSpec(),
      { afterExternalContent: true, explanation: "Summarizes files." },
    );
    await vi.waitFor(() => expect(service.pendingApprovals()).toHaveLength(1));
    const [approval] = service.pendingApprovals();
    expect(approval).toMatchObject({
      kind: "create",
      sessionId: "author",
      explanation: "Summarizes files.",
    });
    expect(approval.warnings.map((warning) => warning.code)).toContain(
      "after-external-content",
    );
    expect(() =>
      service.respondApproval("web", approval.requestId, true),
    ).toThrow(/this computer/);
    service.respondApproval("desktop", approval.requestId, true);
    await expect(created).resolves.toMatchObject({ revision: 1 });
    expect(await service.list(PROJECT_ID)).toHaveLength(1);
  });

  it("saves nothing when the user rejects", async () => {
    const created = service.create(
      { projectId: PROJECT_ID, sessionId: "author" },
      manualSpec(),
      { afterExternalContent: false },
    );
    await vi.waitFor(() => expect(service.pendingApprovals()).toHaveLength(1));
    service.respondApproval(
      "desktop",
      service.pendingApprovals()[0].requestId,
      false,
    );
    await expect(created).rejects.toThrow(/did not approve/);
    expect(await service.list(PROJECT_ID)).toEqual([]);
  });

  it("returns validation errors without asking", async () => {
    const result = await service.create(
      { projectId: PROJECT_ID },
      manualSpec({ triggers: [] }),
      { afterExternalContent: false },
    );
    expect(result).toHaveProperty("errors");
    expect(service.pendingApprovals()).toEqual([]);
  });

  it("drops a pending approval when its session's run ends", async () => {
    const created = service.create(
      { projectId: PROJECT_ID, sessionId: "author" },
      manualSpec(),
      { afterExternalContent: false },
    );
    await vi.waitFor(() => expect(service.pendingApprovals()).toHaveLength(1));
    service.observeAgentEvent({
      type: "run-state",
      sessionId: "author",
      state: "idle",
    });
    await expect(created).rejects.toThrow();
  });

  it("asks before an agent deletes, and refuses the browser", async () => {
    const id = await createApproved();
    await expect(
      service.delete({ projectId: PROJECT_ID, source: "web" }, id),
    ).rejects.toThrow(/this computer/);
    const deleted = service.delete(
      { projectId: PROJECT_ID, sessionId: "author", source: "agent" },
      id,
    );
    await approveNext();
    await deleted;
    expect(await service.list(PROJECT_ID)).toEqual([]);
  });

  it("rejects an update based on an old revision", async () => {
    const id = await createApproved();
    await expect(
      service.update({ projectId: PROJECT_ID }, id, 7, manualSpec(), {
        afterExternalContent: false,
      }),
    ).rejects.toThrow(/revision 7/);
  });
});

describe("AutomationService runs", () => {
  it("runs the agent autonomously inside the approved envelope", async () => {
    const id = await createApproved();
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("findings"),
    );
    const [location] = locations;
    expect(location.approvalMode).toBe("autonomous");
    expect(location.automation).toMatchObject({
      automationId: id,
      network: [],
      toolNames: ["read", "write"],
      secrets: [],
    });
    expect(location.folders).toEqual(
      expect.arrayContaining([
        { access: "read-only", path: docs },
        { access: "read-write", path: path.join(docs, "reports") },
      ]),
    );
    // Runs sit with the project's own sessions, so they open like any other.
    expect(location.sessionsRoot).toBe(
      path.join(root, "projects", PROJECT_ID, "sessions"),
    );
    // The transcript shows this message as a card, so its format must parse.
    expect(parseAutomationRunMessage(prompts[0])).toMatchObject({
      name: manualSpec().name,
      trigger: "manual",
      instructions: manualSpec().action.instructions,
    });
    const run = await lastRun();
    expect(run.summary).toBe("Wrote the summary.");
    expect(run.read).toBe(false);
    expect(notifications.at(-1)).toMatchObject({ body: "Wrote the summary." });
    expect(await service.unreadCount()).toBe(1);
  });

  it("passes secrets to the run and redacts them from its report", async () => {
    await service.options.secrets.set(
      PROJECT_ID,
      "erp-token",
      undefined,
      "s3cret-value",
    );
    const id = await createApproved(
      manualSpec({ secrets: [{ name: "erp-token", env: "ERP_TOKEN" }] }),
    );
    finishRun = (sessionId, location) => {
      void service
        .report(sessionId, {
          op: "report",
          runId: location.automation!.runId,
          status: "findings",
          summary: "Token s3cret-value works.",
        })
        .then(() =>
          service.observeAgentEvent({
            type: "run-state",
            sessionId,
            state: "idle",
          }),
        );
    };
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("findings"),
    );
    expect(locations[0].automation?.secrets).toEqual([
      { name: "erp-token", env: "ERP_TOKEN", value: "s3cret-value" },
    ]);
    expect((await lastRun()).summary).toBe("Token [secret:erp-token] works.");
  });

  it("counts a run that ends without a report or output change as failed", async () => {
    const id = await createApproved(
      manualSpec({
        delivery: {
          notify: "on-findings",
          outputs: [{ folderId: "docs", path: "reports" }],
        },
      }),
    );
    finishRun = (sessionId) =>
      service.observeAgentEvent({
        type: "run-state",
        sessionId,
        state: "idle",
      });
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("failed"),
    );
    expect((await lastRun()).error).toMatch(/automation_report/);
    expect(notifications.at(-1)?.body).toMatch(/Run failed/);
  });

  it("pauses after five failures in a row", async () => {
    const id = await createApproved();
    finishRun = (sessionId) =>
      service.observeAgentEvent({
        type: "run-state",
        sessionId,
        state: "failed",
        error: "provider error",
      });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await vi.waitFor(() => service.runNow(PROJECT_ID, id), {
        timeout: 10_000,
      });
      await vi.waitFor(
        async () =>
          expect(
            (await service.listRuns({ filter: "all" })).filter(
              (run) => run.status === "failed",
            ),
          ).toHaveLength(attempt + 1),
        { timeout: 10_000 },
      );
      await vi.waitFor(async () =>
        expect((await service.list(PROJECT_ID))[0].running).toBe(false),
      );
    }
    await vi.waitFor(async () =>
      expect((await service.list(PROJECT_ID))[0].status).toBe("paused"),
    );
    expect(() => service.runNow(PROJECT_ID, id)).toThrow(/Resume/);
  }, 20_000);

  it("skips runs past the daily limit without pausing, telling the user once", async () => {
    const id = await createApproved(
      manualSpec({ limits: { maxRunsPerDay: 1 } }),
    );
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("findings"),
    );
    await vi.waitFor(async () =>
      expect((await service.list(PROJECT_ID))[0].running).toBe(false),
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await vi.waitFor(() => service.runNow(PROJECT_ID, id));
      await vi.waitFor(() =>
        expect(
          notifications.filter((entry) => /daily limit/.test(entry.body)),
        ).toHaveLength(1),
      );
    }
    expect(await service.listRuns({ filter: "all" })).toHaveLength(1);
    expect((await service.list(PROJECT_ID))[0].status).toBe("active");
  });

  it("passes MCP grants and the project folder to the run", async () => {
    const grants = [{ server: "github", tools: ["list_issues"] }];
    const spec = manualSpec();
    spec.action.permissions.mcp = grants;
    const id = await createApproved(spec);
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("findings"),
    );
    expect(locations[0].automation?.mcp).toEqual({ cwd: docs, grants });
  });

  it("only accepts reports from the run's own session", async () => {
    const id = await createApproved();
    await expect(
      service.report("author", {
        op: "report",
        runId: "x",
        status: "nothing",
        summary: "",
      }),
    ).rejects.toThrow(/only available inside an automation run/);
    expect(id).toBeTruthy();
  });

  it("hands a finished run's session to the user once they write in it", async () => {
    const id = await createApproved();
    let release!: () => void;
    finishRun = (sessionId, location) => {
      release = () =>
        void service
          .report(sessionId, {
            op: "report",
            runId: location.automation!.runId,
            status: "findings",
            summary: "Done.",
          })
          .then(() =>
            service.observeAgentEvent({
              type: "run-state",
              sessionId,
              state: "idle",
            }),
          );
    };
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(() => expect(release).toBeDefined());
    const sessions = await service.runSessions(PROJECT_ID);
    expect(sessions.get("session-1")).toMatchObject({
      automationId: id,
      name: manualSpec().name,
    });
    await expect(
      service.claimRunSession(PROJECT_ID, "session-1"),
    ).rejects.toThrow(/still running/);
    release();
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("findings"),
    );
    await service.claimRunSession(PROJECT_ID, "session-1");
    expect((await service.runSessions(PROJECT_ID)).has("session-1")).toBe(
      false,
    );
    expect((await lastRun()).kept).toBe(true);
  });

  it("deletes the run sessions the user never wrote in with the automation", async () => {
    const sessionsDirectory = path.join(
      root,
      "projects",
      PROJECT_ID,
      "sessions",
    );
    await mkdir(sessionsDirectory, { recursive: true });
    let created = 0;
    await service.stop();
    service = createService({
      createSession: vi.fn((location: AgentSessionLocation) => {
        locations.push(location);
        created += 1;
        const sessionFile = path.join(
          sessionsDirectory,
          `run-${created}.jsonl`,
        );
        return writeFile(sessionFile, "{}\n").then(() => ({
          sessionId: `session-${created}`,
          sessionFile,
        }));
      }),
    });
    await service.start();
    const id = await createApproved();
    service.runNow(PROJECT_ID, id);
    await vi.waitFor(async () =>
      expect((await lastRun())?.status).toBe("findings"),
    );
    const sessionFile = path.join(sessionsDirectory, "run-1.jsonl");
    await access(sessionFile);
    const deleted = service.delete(
      { projectId: PROJECT_ID, sessionId: "author", source: "agent" },
      id,
    );
    await approveNext();
    await deleted;
    await expect(access(sessionFile)).rejects.toThrow();
  });
});

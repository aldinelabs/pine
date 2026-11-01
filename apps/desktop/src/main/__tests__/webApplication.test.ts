// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PineRequestRouter } from "../requestRouter";
import { ProjectRuntimeRegistry } from "../projectRuntime";
import { ProjectRepository } from "../projects/projectRepository";
import { WebApplication } from "../webApplication";
import { WebSessionState } from "../webSessionState";
import type {
  PromptSessionRequest,
  RespondApprovalRequest,
} from "../../shared/agent";
import type { PineAttachment } from "../../shared/attachments";
import { createAgentHost } from "./agentHostFixture";
import { OPEN_PROJECT_CHANNEL } from "../../shared/projects";

const roots: string[] = [];
const applications: WebApplication[] = [];
const registries: ProjectRuntimeRegistry[] = [];
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-web-app-"));
  roots.push(root);
  const summary = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
  };
  const host = createAgentHost(summary);
  const disposeSession = vi.fn().mockResolvedValue({ disposed: true });
  host.disposeSession = disposeSession;
  const registry = new ProjectRuntimeRegistry(host, path.join(root, "agent"));
  registries.push(registry);
  const projects = new ProjectRepository(path.join(root, "projects"));
  const folderId = crypto.randomUUID();
  const project = await projects.create({
    name: "Web test",
    defaultFolderId: folderId,
    folders: [
      { id: folderId, name: "workspace", path: root, access: "read-write" },
    ],
  });
  const router = new PineRequestRouter();
  // Mirrors main's rule for the browser: attach beside whoever holds it.
  router.register(OPEN_PROJECT_CHANNEL, async (context, request) => {
    const { id } = request as { id: string };
    const opened = await projects.open(id);
    await registry.share(context.clientId, opened, projects.dataPaths(id));
    return { opened: true, project: opened };
  });
  router.register("sessions:prompt", (context, request) =>
    registry.prompt(context.clientId, request as PromptSessionRequest),
  );
  router.register("sessions:approval-response", (context, request) =>
    registry.respondApproval(
      context.clientId,
      request as RespondApprovalRequest,
    ),
  );
  const allowed = new Set<string>();
  const persistSettings = vi.fn().mockResolvedValue(undefined);
  const releaseSubscriptions = vi.fn();
  const application = new WebApplication({
    router,
    runtimes: registry,
    state: new WebSessionState(),
    rendererRoot: root,
    previewPath: () => Promise.reject(new Error("Not used")),
    presentedPath: () => Promise.reject(new Error("Not authorized")),
    allowAttachment: (file) => allowed.has(file),
    rememberAttachments: (_owner, files) =>
      files.forEach((file) => allowed.add(file)),
    respondWorkbench: () => undefined,
    persistSettings,
    releaseSubscriptions,
  });
  applications.push(application);
  const status = await application.configure({
    enabled: true,
    port: await freePort(),
  });
  const url = new URL(status.url!);
  const origin = url.origin;
  const login = await fetch(`${origin}/api/connect`, {
    method: "POST",
    headers: { Origin: origin },
    body: JSON.stringify({
      token: new URLSearchParams(url.hash.slice(1)).get("access_token"),
    }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie, Origin: origin };
  const rpc = (channel: string, request: unknown) =>
    fetch(`${origin}/api/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: crypto.randomUUID(), channel, request }),
    });
  return {
    root,
    application,
    registry,
    host,
    disposeSession,
    project,
    projects,
    origin,
    headers,
    rpc,
    persistSettings,
    releaseSubscriptions,
    summary,
  };
}

afterEach(async () => {
  await Promise.all(
    applications
      .splice(0)
      .map((app) => app.configure({ enabled: false, port: 9415 })),
  );
  await Promise.all(
    registries.splice(0).map((registry) => registry.dispose(1)),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("browser application adapter", () => {
  it("controls a desktop-owned session through HTTP and releases only the last runtime reference", async () => {
    const {
      application,
      registry,
      projects,
      project,
      rpc,
      disposeSession,
      summary,
    } = await fixture();
    await registry.open(1, project, projects.dataPaths(project.id));
    await registry.prompt(1, {
      message: "Start",
      target: { kind: "new", projectId: project.id },
    });
    expect((await rpc("project:open", { id: project.id })).status).toBe(200);
    expect(
      (
        await rpc("sessions:prompt", {
          message: "Continue",
          target: {
            kind: "session",
            projectId: project.id,
            sessionId: summary.id,
          },
        })
      ).status,
    ).toBe(200);
    expect(registry.clientsOfSession(summary.id)).toEqual([1, -1]);
    registry.trackApproval(summary.id, 1, summary.id);
    expect(
      (
        await rpc("sessions:approval-response", {
          requestId: summary.id,
          action: "approve",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await rpc("sessions:approval-response", {
          requestId: summary.id,
          action: "approve",
        })
      ).status,
    ).toBe(400);
    await registry.dispose(1);
    expect(disposeSession).not.toHaveBeenCalled();
    await application.configure({ enabled: false, port: 9415 });
    expect(disposeSession).toHaveBeenCalledExactlyOnceWith(summary.id);
  });

  it("stores uploads under managed names and refuses to grant arbitrary attachment paths", async () => {
    const { origin, headers, rpc, project, projects } = await fixture();
    const response = await fetch(
      `${origin}/api/upload?${new URLSearchParams({ projectId: project.id, name: "../../outside.txt" })}`,
      { method: "POST", headers, body: "uploaded" },
    );
    const { attachment } = (await response.json()) as {
      attachment: PineAttachment;
    };
    expect(response.status).toBe(200);
    expect(attachment.name).toBe("outside.txt");
    expect(path.dirname(attachment.path)).toBe(
      projects.dataPaths(project.id).attachmentsRoot,
    );
    expect(await readFile(attachment.path, "utf8")).toBe("uploaded");
    const message =
      '<pine_attachments version="1">\n' +
      JSON.stringify({ attachments: [{ ...attachment, path: "/etc/hosts" }] }) +
      "\n</pine_attachments>\n\nRead this";
    expect(
      (
        await rpc("sessions:prompt", {
          message,
          target: { kind: "new", projectId: project.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (await rpc("web-control:set", { enabled: false, port: 9415 })).status,
    ).toBe(400);
  });

  it("rolls back a listener change when persisting settings fails", async () => {
    const { application, persistSettings, registry, project } = await fixture();
    const previous = application.server.status();
    persistSettings.mockRejectedValueOnce(new Error("Disk is full"));
    await expect(
      application.configure({ enabled: true, port: await freePort() }, true),
    ).rejects.toThrow("Disk is full");
    expect(application.server.status()).toMatchObject({
      enabled: true,
      port: previous.port,
      url: previous.url,
    });
    expect(registry.isOpen(-1, project.id)).toBe(false);
  });
});

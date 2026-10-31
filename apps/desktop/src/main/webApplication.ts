import { webDownload } from "./webDownload";
import {
  SetWatchedProjectDirectoriesRequestSchema,
  SetWatchedFilePreviewRequestSchema,
} from "./fileSubscriptionSchemas";
import { WebSubscriptions } from "./webSubscriptions";
import {
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  SET_WATCHED_FILE_PREVIEW_CHANNEL,
} from "../shared/projectFiles";
import { isWebMutation } from "./webRequestPolicy";
import { webRequestProjects } from "./webRequestPolicy";
import { WORKBENCH_STATE_RESPONSE_CHANNEL } from "../shared/workbench";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { LocalWebServer } from "./localWebServer";
import { WebSessionState } from "./webSessionState";
import type { PineRequestRouter } from "./requestRouter";
import type { ProjectRuntimeRegistry } from "./projectRuntime";
import type { ProjectRepository } from "./projects/projectRepository";
import { serveProjectMediaRequest } from "./projectFilePreview";
import { serveWebAsset } from "./webAssets";
import {
  WEB_CLIENT_ID,
  type WebServerSettings,
  type WebSessionSnapshot,
} from "../shared/webControl";
import { SESSION_EVENT_CHANNEL, type PineSessionEvent } from "../shared/agent";
import {
  parseAttachmentMessage,
  SAVE_PASTED_ATTACHMENT_CHANNEL,
  type PineAttachment,
} from "../shared/attachments";
import { EXPORT_SESSION_CHANNEL } from "../shared/sessions";
import {
  OPEN_PROJECT_CHANNEL,
  CLOSE_PROJECT_CHANNEL,
} from "../shared/projects";
import { LIBRARY_CHANGED_CHANNEL } from "../shared/projects";

interface WebApplicationOptions {
  router: PineRequestRouter;
  runtimes: ProjectRuntimeRegistry;
  projects: ProjectRepository;
  state: WebSessionState;
  rendererRoot: string;
  devUrl?: string;
  previewPath(owner: number, request: unknown): Promise<string>;
  presentedPath(owner: number, request: unknown): Promise<string>;
  allowAttachment(path: string): boolean | Promise<boolean>;
  rememberAttachments(owner: number, paths: string[]): void;
  respondWorkbench(request: unknown): void;
  persistSettings(settings: WebServerSettings): Promise<void>;
  releaseSubscriptions(): void;
}

/** Browser-specific file semantics; business requests use the same handlers as IPC. */
export class WebApplication {
  readonly server: LocalWebServer;
  private settingsQueue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private readonly subscriptions: WebSubscriptions;
  private readonly opening = new Map<string, Promise<void>>();

  constructor(private readonly options: WebApplicationOptions) {
    const context = { clientId: WEB_CLIENT_ID, source: "web" as const };
    this.subscriptions = new WebSubscriptions(
      async (request) =>
        await this.options.router.invoke(
          SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
          context,
          request,
        ),
      async (request) =>
        await this.options.router.invoke(
          SET_WATCHED_FILE_PREVIEW_CHANNEL,
          context,
          request,
        ),
    );
    this.server = new LocalWebServer({
      invoke: (channel, request, clientId) =>
        this.invoke(channel, request, clientId),
      deduplicate: isWebMutation,
      connected: (id) => this.subscriptions.connected(id),
      disconnected: (id) => this.subscriptions.disconnected(id),
      snapshots: () => this.snapshots(),
      asset: (request) =>
        serveWebAsset(request, options.rendererRoot, options.devUrl),
      resource: (request) => this.resource(request),
      upload: (projectId, name, bytes) => this.upload(projectId, name, bytes),
    });
  }

  configure(settings: WebServerSettings, persist = false) {
    const pending = this.settingsQueue.then(async () => {
      const status = await this.server.configure(
        settings,
        persist ? () => this.options.persistSettings(settings) : undefined,
      );
      if (!status.enabled) {
        this.generation++;
        await Promise.allSettled([...this.opening.values()]);
        this.subscriptions.clear();
        this.options.releaseSubscriptions();
        await this.options.runtimes.dispose(WEB_CLIENT_ID);
      }
      return status;
    });
    this.settingsQueue = pending.catch(() => undefined);
    return pending;
  }

  private snapshots(): WebSessionSnapshot[] {
    return this.options.state.snapshots(
      (id) => this.options.runtimes.projectOfLiveSession(id)?.id,
    );
  }

  publishSession(event: PineSessionEvent): void {
    if (event.type === "session-reset")
      this.options.state.forget(event.sessionId);
    const project = this.options.runtimes.projectOfLiveSession(event.sessionId);
    if (project) this.options.state.observe(project.id, event);
    this.server.publish(SESSION_EVENT_CHANNEL, event);
  }

  private async open(projectId: string): Promise<void> {
    z.uuid().parse(projectId);
    if (this.options.runtimes.isOpen(WEB_CLIENT_ID, projectId)) return;
    const pending = this.opening.get(projectId);
    if (pending) return pending;
    const opening = (async () => {
      const project = await this.options.projects.open(projectId);
      await this.options.runtimes.share(
        WEB_CLIENT_ID,
        project,
        this.options.projects.dataPaths(projectId),
      );
    })();
    this.opening.set(projectId, opening);
    try {
      await opening;
    } finally {
      this.opening.delete(projectId);
    }
  }

  private async invoke(
    channel: string,
    request: unknown,
    clientId: string,
  ): Promise<unknown> {
    const generation = this.generation;
    const input =
      request && typeof request === "object"
        ? (request as Record<string, unknown>)
        : {};
    const projectIds = webRequestProjects(channel, request, {
      sessionProject: (id) =>
        this.options.runtimes.projectOfLiveSession(id)?.id,
      interactionProject: (id) =>
        this.options.runtimes.projectOfInteraction(id),
    });
    if (channel === OPEN_PROJECT_CHANNEL) {
      const { id } = z.object({ id: z.uuid() }).parse(request);
      await this.open(id);
      return { opened: true, project: await this.options.projects.get(id) };
    }
    // Closing a browser tab detaches its UI; execution lives until explicitly stopped.
    if (channel === CLOSE_PROJECT_CHANNEL) return;
    for (const projectId of projectIds) await this.open(projectId);
    if (generation !== this.generation || !this.server.status().enabled)
      throw new Error("The local web interface was stopped.");
    if (channel === "project-files:preview-presented")
      await this.options.presentedPath(WEB_CLIENT_ID, request);
    if (channel === SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL)
      return this.subscriptions.directories(
        clientId,
        SetWatchedProjectDirectoriesRequestSchema.parse(request),
      );
    if (channel === SET_WATCHED_FILE_PREVIEW_CHANNEL) {
      const parsed = SetWatchedFilePreviewRequestSchema.parse(request);
      if (parsed.target?.source === "presented")
        await this.options.presentedPath(WEB_CLIENT_ID, parsed.target);
      return this.subscriptions.preview(clientId, parsed);
    }
    if (channel === WORKBENCH_STATE_RESPONSE_CHANNEL) {
      this.options.respondWorkbench(request);
      return;
    }
    if (
      channel === SAVE_PASTED_ATTACHMENT_CHANNEL &&
      typeof input.bytes === "string"
    )
      request = {
        ...input,
        bytes: new Uint8Array(Buffer.from(input.bytes, "base64")),
      };
    if (channel === "attachments:inspect") {
      const { paths } = z
        .object({ paths: z.array(z.string()).max(100) })
        .parse(request);
      for (const file of paths)
        if (!(await this.options.allowAttachment(await realpath(file))))
          throw new Error("This attachment has not been shared with Pine.");
    }
    if (
      channel === "project-files:operate" &&
      ["open", "reveal", "copy-path", "move-external"].includes(
        String(input.action),
      )
    )
      throw new Error("This action belongs to the browser.");
    if (channel === "sessions:prompt" && typeof input.message === "string") {
      for (const attachment of parseAttachmentMessage(input.message)
        .attachments)
        if (
          !(await this.options.allowAttachment(await realpath(attachment.path)))
        )
          throw new Error("This attachment has not been shared with Pine.");
    }
    if (channel === EXPORT_SESSION_CHANNEL) {
      const input = z
        .object({ projectId: z.uuid(), sessionId: z.uuid() })
        .parse(request);
      return this.options.runtimes.exportSession(
        WEB_CLIENT_ID,
        input.projectId,
        input.sessionId,
      );
    }
    return await this.options.router.invoke(
      channel,
      { clientId: WEB_CLIENT_ID, source: "web" },
      request,
    );
  }

  private async upload(
    projectId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ attachment: PineAttachment }> {
    await this.open(projectId);
    const root = this.options.runtimes.attachmentsRootFor(
      WEB_CLIENT_ID,
      projectId,
    );
    if (!root) throw new Error("The project is unavailable.");
    const displayName =
      name.replaceAll("\\", "/").split("/").at(-1)?.slice(0, 200) ||
      "attachment";
    const extension = path
      .extname(displayName)
      .slice(0, 30)
      .replace(/[^a-zA-Z0-9.]/g, "");
    await mkdir(root, { recursive: true });
    const file = path.join(root, `${randomUUID()}${extension}`);
    await writeFile(file, bytes, { flag: "wx" });
    this.options.rememberAttachments(WEB_CLIENT_ID, [file]);
    const metadata = await stat(file);
    return {
      attachment: {
        name: displayName,
        path: file,
        extension: extension.slice(1).toLowerCase(),
        kind: "file",
        size: bytes.length,
        modifiedAt: metadata.mtime.toISOString(),
      },
    };
  }

  private async resource(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/media") {
      const projectId = url.searchParams.get("projectId");
      if (projectId) await this.open(projectId);
      return serveProjectMediaRequest(request, WEB_CLIENT_ID, {
        project: (owner, input) => this.options.previewPath(owner, input),
        presented: (owner, input) => this.options.presentedPath(owner, input),
      });
    }
    if (url.pathname === "/api/attachment") {
      const file = await realpath(url.searchParams.get("p") ?? "");
      if (!(await this.options.allowAttachment(file))) {
        try {
          await this.options.presentedPath(WEB_CLIENT_ID, { path: file });
        } catch {
          return new Response(null, { status: 403 });
        }
      }
      if (url.searchParams.has("download")) return webDownload(request, file);
      const metadata = await stat(file);
      if (!metadata.isFile() || metadata.size > 36 * 1024 * 1024)
        return new Response(null, { status: 413 });
      const images: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
      };
      const image = images[path.extname(file).toLowerCase()];
      return new Response(await readFile(file), {
        headers: {
          "Content-Type": image ?? "application/octet-stream",
          "Content-Disposition": `${url.searchParams.has("download") || !image ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
          "Content-Security-Policy": "sandbox; default-src 'none'",
        },
      });
    }
    return new Response(null, { status: 404 });
  }

  libraryChanged(change: unknown): void {
    this.server.publish(LIBRARY_CHANGED_CHANNEL, change);
  }
}

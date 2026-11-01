import { webDownload } from "./webDownload";
import { WebSubscriptions } from "./webSubscriptions";
import {
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  SET_WATCHED_FILE_PREVIEW_CHANNEL,
} from "../shared/projectFiles";
import {
  createWebChannels,
  webChannel,
  webRequestProjects,
  type WebChannel,
} from "./webRequestPolicy";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { LocalWebServer } from "./localWebServer";
import { WebSessionState } from "./webSessionState";
import type { PineRequestContext, PineRequestRouter } from "./requestRouter";
import type { ProjectRuntimeRegistry } from "./projectRuntime";
import { serveProjectMediaRequest } from "./projectFilePreview";
import { serveWebAsset } from "./webAssets";
import {
  WEB_CLIENT_ID,
  type WebServerSettings,
  type WebSessionSnapshot,
} from "../shared/webControl";
import { SESSION_EVENT_CHANNEL, type PineSessionEvent } from "../shared/agent";
import type { PineAttachment } from "../shared/attachments";
import { OPEN_PROJECT_CHANNEL } from "../shared/projects";
import { LIBRARY_CHANGED_CHANNEL } from "../shared/projects";

interface WebApplicationOptions {
  router: PineRequestRouter;
  runtimes: ProjectRuntimeRegistry;
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

/** Only raster images render inline; everything else downloads. */
const INLINE_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

const WEB_CONTEXT: PineRequestContext = {
  clientId: WEB_CLIENT_ID,
  source: "web",
};

/** Browser-specific file semantics; business requests use the same handlers as IPC. */
export class WebApplication {
  readonly server: LocalWebServer;
  private settingsQueue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private readonly subscriptions: WebSubscriptions;
  private readonly channels: ReadonlyMap<string, WebChannel>;
  private readonly opening = new Map<string, Promise<void>>();

  constructor(private readonly options: WebApplicationOptions) {
    this.subscriptions = new WebSubscriptions(
      async (request) =>
        await this.options.router.invoke(
          SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
          WEB_CONTEXT,
          request,
        ),
      async (request) =>
        await this.options.router.invoke(
          SET_WATCHED_FILE_PREVIEW_CHANNEL,
          WEB_CONTEXT,
          request,
        ),
    );
    this.channels = createWebChannels({
      allowAttachment: (file) => options.allowAttachment(file),
      authorizePresented: (request) =>
        options.presentedPath(WEB_CLIENT_ID, request),
      watchDirectories: (clientId, request) =>
        this.subscriptions.directories(clientId, request),
      watchPreview: (clientId, request) =>
        this.subscriptions.preview(clientId, request),
      respondWorkbench: (request) => options.respondWorkbench(request),
      exportSession: (projectId, sessionId) =>
        options.runtimes.exportSession(WEB_CLIENT_ID, projectId, sessionId),
    });
    this.server = new LocalWebServer({
      invoke: (channel, request, clientId) =>
        this.invoke(channel, request, clientId),
      deduplicate: (channel) => !this.channels.get(channel)?.repeatable,
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
        this.options.state.clear();
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

  /**
   * Live state is only tracked while the service runs, so desktop-only use pays
   * nothing. A run already in progress when access is enabled is recovered from
   * persisted history plus the events that follow.
   */
  publishSession(event: PineSessionEvent): void {
    if (!this.server.isRunning()) return;
    if (event.type === "session-reset")
      this.options.state.forget(event.sessionId);
    const project = this.options.runtimes.projectOfLiveSession(event.sessionId);
    if (project) this.options.state.observe(project.id, event);
    this.server.publish(SESSION_EVENT_CHANNEL, event);
  }

  /** Holds a project for the browser through the same rule windows use. */
  private async open(projectId: string): Promise<void> {
    z.uuid().parse(projectId);
    if (this.options.runtimes.isOpen(WEB_CLIENT_ID, projectId)) return;
    const pending = this.opening.get(projectId);
    if (pending) return pending;
    const opening = (async () => {
      await this.options.router.invoke(OPEN_PROJECT_CHANNEL, WEB_CONTEXT, {
        id: projectId,
      });
    })();
    this.opening.set(projectId, opening);
    try {
      await opening;
    } finally {
      this.opening.delete(projectId);
    }
  }

  private async invoke(
    name: string,
    request: unknown,
    clientId: string,
  ): Promise<unknown> {
    const generation = this.generation;
    const channel = webChannel(this.channels, name);
    const projectIds = webRequestProjects(channel, request, {
      sessionProject: (id) =>
        this.options.runtimes.projectOfLiveSession(id)?.id,
      interactionProject: (id) =>
        this.options.runtimes.projectOfInteraction(id),
    });
    for (const projectId of projectIds) await this.open(projectId);
    if (generation !== this.generation || !this.server.isRunning())
      throw new Error("The local web interface was stopped.");
    const prepared = channel.prepare ? await channel.prepare(request) : request;
    if (channel.handle) return channel.handle(prepared, clientId);
    return await this.options.router.invoke(name, WEB_CONTEXT, prepared);
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
      const image = url.searchParams.has("download")
        ? undefined
        : INLINE_IMAGE_TYPES[path.extname(file).toLowerCase()];
      return webDownload(request, file, image);
    }
    return new Response(null, { status: 404 });
  }

  libraryChanged(change: unknown): void {
    this.server.publish(LIBRARY_CHANGED_CHANNEL, change);
  }
}

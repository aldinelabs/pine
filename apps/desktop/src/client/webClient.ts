import { createPineApi, type PineTransport } from "./pineApi";
import type { PineDesktopApi } from "../shared/projects";
import type {
  PickAttachmentsResult,
  PineAttachment,
} from "../shared/attachments";
import {
  FILE_PREVIEW_CHANGED_CHANNEL,
  PROJECT_FILE_OPERATION_CHANNEL,
  SET_WATCHED_FILE_PREVIEW_CHANNEL,
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
} from "../shared/projectFiles";
import { GET_APP_VERSION_CHANNEL } from "../shared/window";
import { WORKBENCH_STATE_RESPONSE_CHANNEL } from "../shared/workbench";
import {
  decodeWebJson,
  encodeWebJson,
  WEB_SNAPSHOT_CHANNEL,
  type WebEvent,
  type WebSessionSnapshot,
} from "../shared/webControl";
import { EXPORT_SESSION_CHANNEL } from "../shared/sessions";
import type { PineSessionExportDocument } from "../shared/sessionExport";
import { randomId } from "../lib/randomId";

const browserClientId = randomId();

type Listener = (value: unknown) => void;

function saveDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rpc<T>(channel: string, request?: unknown): Promise<T> {
  const body = encodeWebJson({
    channel,
    request,
    id: randomId(),
    client: browserClientId,
  });
  // A retry reuses the ID, so an accepted prompt cannot execute twice.
  let response: Response;
  try {
    response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch {
    response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }
  const text = await response.text();
  let data: { result?: unknown; error?: string } = {};
  try {
    if (text) data = decodeWebJson(text) as typeof data;
  } catch {
    // Proxies and aborted responses may not return Pine's JSON envelope.
  }
  if (response.status === 401) {
    // The signed-in cookie belongs to a listener that is gone; sign in again.
    location.reload();
    throw new Error("Sign in to Pine again.");
  }
  if (!response.ok) throw new Error(data.error ?? "Pine is unavailable.");
  return data.result as T;
}

async function uploadAttachments(
  files: File[],
  projectId: string,
): Promise<PickAttachmentsResult> {
  const attachments: PineAttachment[] = [];
  for (const file of files) {
    const query = new URLSearchParams({ projectId, name: file.name });
    const response = await fetch(`/api/upload?${query}`, {
      method: "POST",
      body: file,
    });
    const result = (await response.json()) as {
      attachment?: PineAttachment;
      error?: string;
    };
    if (!response.ok || !result.attachment)
      throw new Error(result.error ?? "Upload failed.");
    attachments.push(result.attachment);
  }
  return { attachments };
}

export function pickBrowserFiles(
  projectId: string,
): Promise<PickAttachmentsResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve({ attachments: [] });
      },
      { once: true },
    );
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        void uploadAttachments(files, projectId).then(resolve, reject);
      },
      { once: true },
    );
    input.hidden = true;
    document.body.append(input);
    input.click();
  });
}

export interface BrowserClientLifecycle {
  connect(): void;
  dispose(): void;
}

export async function initializeWebClient(): Promise<
  BrowserClientLifecycle | undefined
> {
  if (window.pine) return;
  await rpc(GET_APP_VERSION_CHANNEL);
  const handlers = new Map<string, Set<Listener>>();
  const watches = new Map<string, { channel: string; request: unknown }>();
  const wrappers = new WeakMap<object, Listener>();
  const snapshotListeners = new Set<
    (snapshots: WebSessionSnapshot[]) => void
  >();
  let snapshots: WebSessionSnapshot[] | undefined;
  const transport: PineTransport = {
    platform: navigator.userAgent.includes("Windows")
      ? "win32"
      : navigator.userAgent.includes("Mac")
        ? "darwin"
        : "linux",
    isQuickComposerHandoff: false,
    getPathForFile: () => "",
    invoke: (channel, request) => {
      if (channel === SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL)
        watches.set(channel, { channel, request });
      if (channel === SET_WATCHED_FILE_PREVIEW_CHANNEL) {
        const watch = request as { watchId: string; target: unknown };
        const key = `${channel}/${watch.watchId}`;
        if (watch.target) watches.set(key, { channel, request });
        else watches.delete(key);
      }
      return rpc(channel, request);
    },
    send: (channel, request) => {
      if (channel === WORKBENCH_STATE_RESPONSE_CHANNEL)
        void rpc(channel, request).catch(() => undefined);
    },
    on: <T>(channel: string, listener: (event: unknown, value: T) => void) => {
      const wrapper: Listener = (value) => listener(undefined, value as T);
      wrappers.set(listener, wrapper);
      const set = handlers.get(channel) ?? new Set();
      set.add(wrapper);
      handlers.set(channel, set);
    },
    removeListener: (channel, listener) => {
      const wrapper = wrappers.get(listener);
      if (wrapper) handlers.get(channel)?.delete(wrapper);
    },
  };
  const api: PineDesktopApi = {
    ...createPineApi(transport),
    runtime: "web",
    uploadAttachments,
    pickAttachments: (projectId) => {
      if (!projectId)
        return Promise.reject(
          new Error("Choose a project before uploading files."),
        );
      return pickBrowserFiles(projectId);
    },
    onSessionSnapshot: (listener) => {
      snapshotListeners.add(listener);
      if (snapshots) listener(snapshots);
      return () => snapshotListeners.delete(listener);
    },
    // Native presentation is owned by the browser.
    closeWindow: () => Promise.resolve(),
    setWindowBackground: () => Promise.resolve(),
    setWindowLayout: () => Promise.resolve(),
    planWindowResize: () => Promise.resolve(0),
    commitWindowResize: () => Promise.resolve(),
    setThemeSource: () => Promise.resolve(),
    setAppLocale: () => undefined,
    setSidebarVibrancy: () => Promise.resolve({ applied: false }),
    getQuickComposer: () => Promise.resolve(false),
    checkForUpdate: undefined,
    downloadUpdate: undefined,
    installUpdate: undefined,
    startProjectFileDrag: () => undefined,
    openExternalUrl: (url) => {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "http:")
        window.open(url, "_blank", "noopener,noreferrer");
      return Promise.resolve();
    },
    openProviderAuthUrl: (url) => api.openExternalUrl(url),
    openAttachment: ({ path }) => {
      window.open(
        `/api/attachment?${new URLSearchParams({ p: path, download: "1" })}`,
        "_blank",
        "noopener,noreferrer",
      );
      return Promise.resolve({ opened: true });
    },
    operateProjectFile: async (request) => {
      if (
        request.action === "open" ||
        request.action === "reveal" ||
        request.action === "copy-path"
      ) {
        const { attachments } = await api.inspectProjectAttachments([
          request.target,
        ]);
        const attachment = attachments[0];
        if (!attachment) return;
        if (request.action === "copy-path")
          await navigator.clipboard.writeText(attachment.path);
        else await api.openAttachment({ path: attachment.path });
        return;
      }
      await rpc(PROJECT_FILE_OPERATION_CHANNEL, request);
    },
    operatePresentedFile: async (request) => {
      if (request.action === "copy-path")
        await navigator.clipboard.writeText(request.path);
      else await api.openAttachment(request);
    },
    exportSession: async (request) => {
      const result = await rpc<PineSessionExportDocument>(
        EXPORT_SESSION_CHANNEL,
        request,
      );
      saveDownload(
        new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }),
        result.fileName,
      );
      return { saved: true };
    },
  };
  window.pine = api;
  document.documentElement.dataset.runtime = "web";
  let events: EventSource | undefined;
  function connect(): void {
    events?.close();
    events = new EventSource(`/api/events?client=${browserClientId}`);
    events.onopen = () => {
      for (const watch of watches.values())
        void rpc(watch.channel, watch.request).catch(() => undefined);
    };
    events.onmessage = (message: MessageEvent<string>) => {
      const event = decodeWebJson(message.data) as WebEvent;
      if (event.channel === FILE_PREVIEW_CHANGED_CHANNEL) {
        const change = event.value as { watchId: string };
        if (!change.watchId.startsWith(`${browserClientId}/`)) return;
        event.value = {
          ...change,
          watchId: change.watchId.slice(browserClientId.length + 1),
        };
      }
      if (event.channel === WEB_SNAPSHOT_CHANNEL) {
        snapshots = event.value as WebSessionSnapshot[];
        for (const listener of snapshotListeners) listener(snapshots);
      } else
        for (const listener of handlers.get(event.channel) ?? [])
          listener(event.value);
    };
  }
  const close = () => events?.close();
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) connect();
  };
  window.addEventListener("pagehide", close);
  window.addEventListener("pageshow", restore);
  return {
    connect,
    dispose: () => {
      close();
      handlers.clear();
      snapshotListeners.clear();
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", restore);
    },
  };
}

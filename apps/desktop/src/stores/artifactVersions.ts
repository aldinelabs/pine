import { acceptHMRUpdate, defineStore } from "pinia";
import { ref } from "vue";
import type {
  ArtifactVersion,
  ArtifactVersionDiff,
  ArtifactVersionHistory,
  ArtifactVersionRef,
} from "@/shared/artifacts";
import type {
  FilePreviewTarget,
  SaveArtifactVersionResult,
} from "@/shared/projectFiles";

/** A submitted artifact: the session that submitted it and the path it recorded. */
export interface ArtifactVersionSource {
  projectId: string;
  sessionId: string;
  path: string;
}

/** The version state of one preview: the workbench card, or one file tab. */
export interface ArtifactVersionView {
  source: ArtifactVersionSource;
  history?: ArtifactVersionHistory;
  loading: boolean;
  /** The version shown in place of the file, if any. */
  viewing?: ArtifactVersion;
  /** The written-out copy of `viewing`, once ready. */
  target?: FilePreviewTarget;
  /** Showing the line diff from `viewing` to the current file. */
  comparing: boolean;
  diff?: ArtifactVersionDiff;
  busy: boolean;
  /** The preview's version menu should open once it is shown. */
  menuRequested: boolean;
}

/** The workbench preview's view key in a session. */
export function workbenchVersionKey(sessionId: string): string {
  return `workbench:${sessionId}`;
}

/** A file tab's view key. */
export function tabVersionKey(tabId: string): string {
  return `tab:${tabId}`;
}

function sameSource(
  a: ArtifactVersionSource,
  b: ArtifactVersionSource,
): boolean {
  return (
    a.projectId === b.projectId &&
    a.sessionId === b.sessionId &&
    a.path === b.path
  );
}

/**
 * Plain copies for IPC: views are reactive, and Electron structured-clones
 * every argument, which rejects proxies.
 */
function plainSource(source: ArtifactVersionSource): ArtifactVersionSource {
  return {
    projectId: source.projectId,
    sessionId: source.sessionId,
    path: source.path,
  };
}

function plainRef(ref: ArtifactVersionRef): ArtifactVersionRef {
  return ref.kind === "submission"
    ? { kind: "submission", toolCallId: ref.toolCallId }
    : { kind: "backup", id: ref.id };
}

function sameVersion(a: ArtifactVersionRef, b: ArtifactVersionRef): boolean {
  return a.kind === "submission"
    ? b.kind === "submission" && a.toolCallId === b.toolCallId
    : b.kind === "backup" && a.id === b.id;
}

/**
 * The kept versions of submitted artifacts, as each preview shows them. A
 * preview binds its artifact under a view key; the version it shows, its
 * comparison and the history list live here so the preview's header, its
 * content and the Artifacts list share one state. Nothing is persisted: a
 * version copy's read grant lasts for the window's lifetime only.
 */
export const useArtifactVersionStore = defineStore("artifactVersions", () => {
  const views = ref<Record<string, ArtifactVersionView>>({});

  /** Binds a preview to an artifact, or unbinds it; a different artifact starts over. */
  function bind(key: string, source: ArtifactVersionSource | undefined): void {
    if (!source) {
      delete views.value[key];
      return;
    }
    const existing = views.value[key];
    if (existing && sameSource(existing.source, source)) return;
    views.value[key] = {
      source: plainSource(source),
      loading: false,
      comparing: false,
      busy: false,
      menuRequested: false,
    };
  }

  function viewOf(key: string): ArtifactVersionView | undefined {
    return views.value[key];
  }

  /** Reads the history again. Throws if it cannot be read. */
  async function load(key: string): Promise<void> {
    const view = views.value[key];
    if (!view) return;
    const source = view.source;
    view.loading = true;
    try {
      const history = await window.pine.artifactVersions(plainSource(source));
      const current = views.value[key];
      if (current && sameSource(current.source, source))
        current.history = history;
    } finally {
      const current = views.value[key];
      if (current) current.loading = false;
    }
  }

  /**
   * Reads the history again if it was read before, as when the agent
   * submits the file once more: an open version menu lists the new version
   * at once. A failure keeps the history shown; the menu reads it on open.
   */
  async function refresh(key: string): Promise<void> {
    if (!views.value[key]?.history) return;
    await load(key).catch(() => {});
  }

  function request(view: ArtifactVersionView, version: ArtifactVersion) {
    return { ...plainSource(view.source), version: plainRef(version.ref) };
  }

  /** Shows the file as it is now. */
  function showCurrent(key: string): void {
    const view = views.value[key];
    if (!view) return;
    view.viewing = undefined;
    view.target = undefined;
    view.comparing = false;
    view.diff = undefined;
  }

  /** Shows a kept version in place of the file. Throws if it cannot be opened. */
  async function show(key: string, version: ArtifactVersion): Promise<void> {
    const view = views.value[key];
    if (!view) return;
    view.viewing = version;
    view.target = undefined;
    view.comparing = false;
    view.diff = undefined;
    try {
      const target = await window.pine.openArtifactVersion(
        request(view, version),
      );
      const current = views.value[key];
      if (current?.viewing && sameVersion(current.viewing.ref, version.ref))
        current.target = target;
    } catch (error) {
      const current = views.value[key];
      if (current?.viewing && sameVersion(current.viewing.ref, version.ref))
        showCurrent(key);
      throw error;
    }
  }

  /** Switches the line diff on or off. Throws if the diff cannot be read. */
  async function setComparing(key: string, comparing: boolean): Promise<void> {
    const view = views.value[key];
    if (!view?.viewing) return;
    view.comparing = comparing;
    if (!comparing || view.diff) return;
    const version = view.viewing;
    try {
      const diff = await window.pine.diffArtifactVersion(
        request(view, version),
      );
      const current = views.value[key];
      if (current?.viewing && sameVersion(current.viewing.ref, version.ref))
        current.diff = diff;
    } catch (error) {
      const current = views.value[key];
      if (current) current.comparing = false;
      throw error;
    }
  }

  /**
   * Writes the shown version back to the file and returns to it. Throws if
   * the restore fails; the history is read again either way.
   */
  async function restore(key: string): Promise<void> {
    const view = views.value[key];
    if (!view?.viewing || view.busy) return;
    view.busy = true;
    try {
      await window.pine.restoreArtifactVersion(request(view, view.viewing));
      showCurrent(key);
    } finally {
      const current = views.value[key];
      if (current) current.busy = false;
      await load(key).catch(() => {});
    }
  }

  /** Saves a copy of the shown version where the user picks. */
  async function saveAs(key: string): Promise<SaveArtifactVersionResult> {
    const view = views.value[key];
    if (!view?.viewing) return { saved: false };
    return window.pine.saveArtifactVersion(request(view, view.viewing));
  }

  /** Asks the preview bound under `key` to open its version menu. */
  function requestMenu(key: string): void {
    const view = views.value[key];
    if (view) view.menuRequested = true;
  }

  /** The menu opened as asked. */
  function clearMenuRequest(key: string): void {
    const view = views.value[key];
    if (view) view.menuRequested = false;
  }

  return {
    bind,
    clearMenuRequest,
    load,
    refresh,
    requestMenu,
    restore,
    saveAs,
    setComparing,
    show,
    showCurrent,
    viewOf,
    views,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useArtifactVersionStore, import.meta.hot),
  );
}

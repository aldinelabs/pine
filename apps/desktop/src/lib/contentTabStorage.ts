import { z } from "zod";
import { fileTargetKey } from "@/lib/filePreviewTarget";
import type { ProjectContentTab } from "@/stores/contentTabs";

/**
 * One tab list per window. sessionStorage survives a reload of this window;
 * localStorage carries the most recently changed window into the next launch.
 * The per-project v1 lists are intentionally not migrated.
 */
export const CONTENT_TABS_STORAGE_KEY = "pine.content-tabs.v2";
const id = z.string().min(1);
const stateSchema = z.object({
  activeTabId: z.string().nullable(),
  tabs: z.array(
    z.union([
      z.object({
        id,
        kind: z.literal("file"),
        source: z.literal("project"),
        label: z.string(),
        projectId: id,
        folderId: id,
        relativePath: id,
      }),
      // Accepted so a single presented tab cannot invalidate the whole saved
      // state; the restore pass below drops it deliberately.
      z.object({
        id,
        kind: z.literal("file"),
        source: z.literal("presented"),
        label: z.string(),
        path: z.string().min(1),
        projectId: id,
      }),
      z.object({
        id,
        kind: z.literal("session"),
        state: z.literal("bound"),
        sessionId: id,
        label: z.string().optional(),
        projectId: id,
      }),
      z.object({
        id,
        kind: z.literal("session"),
        state: z.enum(["draft", "creating"]),
        projectId: id,
      }),
    ]),
  ),
});

export interface ContentTabState {
  tabs: ProjectContentTab[];
  activeTabId: string | null;
}

function readStored(storage: () => Storage): unknown {
  try {
    return JSON.parse(storage().getItem(CONTENT_TABS_STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function readContentTabs(): ContentTabState | null {
  try {
    const reloaded = readStored(() => window.sessionStorage);
    const parsed = stateSchema.safeParse(
      reloaded ?? readStored(() => window.localStorage),
    );
    if (!parsed.success) return null;
    const ids = new Set<string>();
    const entries = new Set<string>();
    const tabs: ProjectContentTab[] = [];
    for (const saved of parsed.data.tabs) {
      // A presented file's access grant only covers the run that presented it,
      // so a restart cannot resume that tab without widening what this window
      // may read. Drop it instead of restoring a tab that could never load.
      if (saved.kind === "file" && saved.source === "presented") continue;
      if (ids.has(saved.id)) continue;
      // A process restart cannot continue an unbound in-flight prompt.
      const tab: ProjectContentTab =
        saved.kind === "session" && saved.state !== "bound"
          ? {
              id: saved.id,
              kind: "session",
              projectId: saved.projectId,
              state: "draft",
            }
          : saved;
      const identity =
        tab.kind === "file"
          ? fileTargetKey(tab)
          : tab.state === "bound"
            ? `session:${tab.sessionId}`
            : `draft:${tab.id}`;
      if (entries.has(identity)) continue;
      ids.add(tab.id);
      entries.add(identity);
      tabs.push(tab);
    }
    if (parsed.data.tabs.length && !tabs.length) return null;
    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === parsed.data.activeTabId)
        ? parsed.data.activeTabId
        : (tabs[0]?.id ?? null),
    };
  } catch {
    return null;
  }
}

export function writeContentTabs(state: ContentTabState): void {
  const value = JSON.stringify(state);
  for (const storage of [
    () => window.sessionStorage,
    () => window.localStorage,
  ]) {
    try {
      storage().setItem(CONTENT_TABS_STORAGE_KEY, value);
    } catch {
      // Storage failures must not interrupt tab navigation.
    }
  }
}

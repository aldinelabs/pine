import { watch, type FSWatcher } from "node:fs";
import type {
  ProjectFolderFileChanges,
  SetWatchedProjectDirectoriesRequest,
} from "../shared/projectFiles";

interface WatchedDirectory {
  relativePath: string;
  watcher: FSWatcher;
}

interface FolderWatchers {
  folderId: string;
  projectId: string;
  /** Resolved absolute directory path -> active watcher. */
  directories: Map<string, WatchedDirectory>;
}

/** Folder IDs are only unique within a project, so key by both. */
function folderKey(projectId: string, folderId: string): string {
  return `${projectId}/${folderId}`;
}

interface SenderWatchers {
  /** folderKey → watchers. */
  folders: Map<string, FolderWatchers>;
  /** folderKey → changed relative directories. */
  pending: Map<string, Set<string>>;
  revision: number;
  timer: NodeJS.Timeout | null;
}

export type ProjectDirectoryResolver = (
  senderId: number,
  projectId: string,
  folderId: string,
  relativePath: string,
) => Promise<string>;

export type ProjectFilesChangeListener = (
  senderId: number,
  changes: ProjectFolderFileChanges[],
) => void;

interface WantedFolder {
  /** Resolved absolute directory path -> portable relative path. */
  directories: Map<string, string>;
  folderId: string;
  projectId: string;
}

export interface ProjectFileWatcherOptions {
  changeDebounceMs?: number;
}

/**
 * Maintains the non-recursive directory watchers requested by each renderer.
 * Paths are resolved through the active project runtime, so the renderer never
 * chooses an arbitrary filesystem root. Full-state updates are revisioned: if
 * resolutions overlap, only the newest update is allowed to change watchers.
 */
export class ProjectFileWatcherRegistry {
  private readonly senders = new Map<number, SenderWatchers>();
  private readonly changeDebounceMs: number;

  constructor(
    private readonly resolveDirectory: ProjectDirectoryResolver,
    private readonly onChange: ProjectFilesChangeListener,
    options: ProjectFileWatcherOptions = {},
  ) {
    this.changeDebounceMs = options.changeDebounceMs ?? 100;
  }

  async setWatchedDirectories(
    senderId: number,
    request: SetWatchedProjectDirectoriesRequest,
  ): Promise<void> {
    const state = this.senders.get(senderId) ?? this.createSender(senderId);
    const revision = ++state.revision;
    const wantedFolders = new Map<string, WantedFolder>();

    await Promise.all(
      request.folders.map(async (folder) => {
        const wantedDirectories = new Map<string, string>();
        await Promise.all(
          [...new Set(folder.directories)].map(async (relativePath) => {
            const absolutePath = await this.resolveDirectory(
              senderId,
              folder.projectId,
              folder.folderId,
              relativePath,
            ).catch(() => undefined);
            if (absolutePath) wantedDirectories.set(absolutePath, relativePath);
          }),
        );
        wantedFolders.set(folderKey(folder.projectId, folder.folderId), {
          directories: wantedDirectories,
          folderId: folder.folderId,
          projectId: folder.projectId,
        });
      }),
    );

    if (this.senders.get(senderId) !== state || state.revision !== revision)
      return;
    this.commit(senderId, state, wantedFolders);
  }

  disposeSender(senderId: number): void {
    const state = this.senders.get(senderId);
    if (!state) return;
    state.revision += 1;
    if (state.timer) clearTimeout(state.timer);
    for (const folder of state.folders.values()) this.closeFolder(folder);
    state.pending.clear();
    this.senders.delete(senderId);
  }

  dispose(): void {
    for (const senderId of [...this.senders.keys()])
      this.disposeSender(senderId);
  }

  private createSender(senderId: number): SenderWatchers {
    const state: SenderWatchers = {
      folders: new Map(),
      pending: new Map(),
      revision: 0,
      timer: null,
    };
    this.senders.set(senderId, state);
    return state;
  }

  private commit(
    senderId: number,
    state: SenderWatchers,
    wantedFolders: Map<string, WantedFolder>,
  ): void {
    for (const [key, folder] of state.folders) {
      if (!wantedFolders.has(key)) {
        this.closeFolder(folder);
        state.folders.delete(key);
        state.pending.delete(key);
      }
    }

    for (const [key, wanted] of wantedFolders) {
      const wantedDirectories = wanted.directories;
      const folder = state.folders.get(key) ?? {
        directories: new Map<string, WatchedDirectory>(),
        folderId: wanted.folderId,
        projectId: wanted.projectId,
      };
      state.folders.set(key, folder);

      for (const [absolutePath, watched] of folder.directories) {
        if (wantedDirectories.get(absolutePath) !== watched.relativePath) {
          watched.watcher.close();
          folder.directories.delete(absolutePath);
        }
      }

      for (const [absolutePath, relativePath] of wantedDirectories) {
        if (folder.directories.has(absolutePath)) continue;
        try {
          const watcher = watch(absolutePath, { persistent: false }, () => {
            this.queueChange(senderId, state, key, relativePath);
          });
          const watched = { relativePath, watcher };
          watcher.on("error", () => {
            if (folder.directories.get(absolutePath) !== watched) return;
            watcher.close();
            folder.directories.delete(absolutePath);
            this.queueChange(senderId, state, key, relativePath);
          });
          folder.directories.set(absolutePath, watched);
        } catch {
          // The directory vanished between resolution and watch creation.
          this.queueChange(senderId, state, key, relativePath);
        }
      }
    }
  }

  private queueChange(
    senderId: number,
    state: SenderWatchers,
    key: string,
    relativePath: string,
  ): void {
    if (this.senders.get(senderId) !== state) return;
    const pending = state.pending.get(key) ?? new Set<string>();
    pending.add(relativePath);
    state.pending.set(key, pending);
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (this.senders.get(senderId) !== state || state.pending.size === 0)
        return;
      const changes = [...state.pending]
        .flatMap(([key, directories]) => {
          const folder = state.folders.get(key);
          if (!folder) return [];
          return [
            {
              folderId: folder.folderId,
              projectId: folder.projectId,
              changedDirs: [...directories].sort((left, right) =>
                left.localeCompare(right),
              ),
            },
          ];
        })
        .sort(
          (left, right) =>
            left.projectId.localeCompare(right.projectId) ||
            left.folderId.localeCompare(right.folderId),
        );
      state.pending.clear();
      this.onChange(senderId, changes);
    }, this.changeDebounceMs);
  }

  private closeFolder(folder: FolderWatchers): void {
    for (const watched of folder.directories.values()) watched.watcher.close();
    folder.directories.clear();
  }
}

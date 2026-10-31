import type {
  SetWatchedProjectDirectoriesRequest,
  SetWatchedFilePreviewRequest,
} from "../shared/projectFiles";

interface SubscriptionSet {
  directories: SetWatchedProjectDirectoriesRequest;
  previews: Set<string>;
  cleanup?: ReturnType<typeof setTimeout>;
}

/** Browser tabs share execution, while each tab owns its own file subscriptions. */
export class WebSubscriptions {
  private readonly clients = new Map<string, SubscriptionSet>();

  constructor(
    private readonly setDirectories: (
      request: SetWatchedProjectDirectoriesRequest,
    ) => Promise<unknown>,
    private readonly setPreview: (
      request: SetWatchedFilePreviewRequest,
    ) => Promise<unknown>,
  ) {}

  private client(id: string): SubscriptionSet {
    let subscriptions = this.clients.get(id);
    if (!subscriptions) {
      if (this.clients.size >= 64) throw new Error("Too many browser tabs.");
      subscriptions = { directories: { folders: [] }, previews: new Set() };
      this.clients.set(id, subscriptions);
    }
    clearTimeout(subscriptions.cleanup);
    return subscriptions;
  }

  async directories(
    id: string,
    request: SetWatchedProjectDirectoriesRequest,
  ): Promise<void> {
    this.client(id).directories = request;
    await this.syncDirectories();
  }

  async preview(
    id: string,
    request: SetWatchedFilePreviewRequest,
  ): Promise<void> {
    const subscriptions = this.client(id);
    const watchId = `${id}/${request.watchId}`;
    if (request.target) subscriptions.previews.add(watchId);
    else subscriptions.previews.delete(watchId);
    await this.setPreview({ ...request, watchId });
  }

  connected(id: string): void {
    this.client(id);
  }

  disconnected(id: string): void {
    const subscriptions = this.clients.get(id);
    if (!subscriptions) return;
    clearTimeout(subscriptions.cleanup);
    subscriptions.cleanup = setTimeout(() => {
      this.clients.delete(id);
      void this.syncDirectories().catch(() => undefined);
      for (const watchId of subscriptions.previews)
        void this.setPreview({ watchId, target: null }).catch(() => undefined);
    }, 30_000);
    subscriptions.cleanup.unref();
  }

  clear(): void {
    for (const subscriptions of this.clients.values())
      clearTimeout(subscriptions.cleanup);
    this.clients.clear();
  }

  private async syncDirectories(): Promise<void> {
    const folders = new Map<
      string,
      SetWatchedProjectDirectoriesRequest["folders"][number]
    >();
    for (const { directories } of this.clients.values())
      for (const folder of directories.folders) {
        const key = `${folder.projectId}/${folder.folderId}`;
        const previous = folders.get(key);
        folders.set(key, {
          ...folder,
          directories: [
            ...new Set([
              ...(previous?.directories ?? []),
              ...folder.directories,
            ]),
          ],
        });
      }
    await this.setDirectories({ folders: [...folders.values()] });
  }
}

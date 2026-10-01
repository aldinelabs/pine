import { stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import type {
  FilePreviewTarget,
  SetWatchedFilePreviewRequest,
} from "../shared/projectFiles";

interface PreviewWatch {
  close?: () => void;
}

/**
 * Preview subscriptions are independent of the file tree. Poll the authorized
 * path rather than an inode or parent directory: in-place writes, atomic saves
 * and delete/recreate all keep working even when native directory events drop.
 * Only stat metadata is observed; each content read still rechecks access.
 */
export class FilePreviewWatcherRegistry {
  private readonly senders = new Map<number, Map<string, PreviewWatch>>();

  constructor(
    private readonly resolveFile: (
      senderId: number,
      target: FilePreviewTarget,
    ) => Promise<string>,
    private readonly onChange: (senderId: number, watchId: string) => void,
    private readonly intervalMs = 500,
  ) {}

  async setWatchedPreview(
    senderId: number,
    { watchId, target }: SetWatchedFilePreviewRequest,
  ): Promise<void> {
    const subscriptions = this.senders.get(senderId) ?? new Map();
    subscriptions.get(watchId)?.close?.();
    subscriptions.delete(watchId);
    this.senders.set(senderId, subscriptions);
    if (!target) return;
    if (subscriptions.size >= 256)
      throw new Error("Too many file preview subscriptions.");

    const subscription: PreviewWatch = {};
    subscriptions.set(watchId, subscription);
    try {
      const filePath = await this.resolveFile(senderId, target);
      if (
        this.senders.get(senderId) !== subscriptions ||
        subscriptions.get(watchId) !== subscription
      )
        return;
      let previous: BigIntStats | null = await stat(filePath, {
        bigint: true,
      }).catch(() => null);
      if (
        this.senders.get(senderId) !== subscriptions ||
        subscriptions.get(watchId) !== subscription
      )
        return;
      let polling = false;
      const timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void stat(filePath, { bigint: true })
          .catch(() => null)
          .then((current) => {
            if (subscriptions.get(watchId) !== subscription) return;
            if (
              current?.mtimeNs !== previous?.mtimeNs ||
              current?.ctimeNs !== previous?.ctimeNs ||
              current?.size !== previous?.size ||
              current?.ino !== previous?.ino ||
              current?.nlink !== previous?.nlink
            ) {
              previous = current;
              this.onChange(senderId, watchId);
            }
          })
          .finally(() => {
            polling = false;
          });
      }, this.intervalMs);
      timer.unref();
      subscription.close = () => clearInterval(timer);
    } catch (error) {
      if (subscriptions.get(watchId) === subscription)
        subscriptions.delete(watchId);
      throw error;
    }
  }

  disposeSender(senderId: number): void {
    const subscriptions = this.senders.get(senderId);
    this.senders.delete(senderId);
    for (const subscription of subscriptions?.values() ?? [])
      subscription.close?.();
    subscriptions?.clear();
  }

  dispose(): void {
    for (const senderId of this.senders.keys()) this.disposeSender(senderId);
  }
}

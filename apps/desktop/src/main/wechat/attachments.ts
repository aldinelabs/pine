import type { PineAttachment } from "../../shared/attachments";
import type { InboundAttachmentsApi } from "./ports";
import type { PendingAttachment, StoredMedia, WeChatStateStore } from "./types";

export interface InboundAttachmentsOptions {
  store: WeChatStateStore;
  /** Staging directory, `<dataDirectory>/wechat-inbox`. */
  directory: string;
  now: () => number;
}

/** Media received from WeChat, staged until a prompt uses it. Not implemented yet. */
export class InboundAttachments implements InboundAttachmentsApi {
  constructor(protected readonly options: InboundAttachmentsOptions) {}

  stage(
    media: StoredMedia,
    download: (
      ref: string,
      maxBytes: number,
      signal?: AbortSignal,
    ) => Promise<Buffer>,
  ): Promise<PendingAttachment> {
    void media;
    void download;
    return Promise.reject(new Error("not implemented"));
  }

  list(): readonly PendingAttachment[] {
    throw new Error("not implemented");
  }

  take(attachmentsRoot: string): Promise<PineAttachment[]> {
    void attachmentsRoot;
    return Promise.reject(new Error("not implemented"));
  }

  drop(): Promise<number> {
    return Promise.reject(new Error("not implemented"));
  }

  sweep(nowMs: number): Promise<void> {
    void nowMs;
    return Promise.reject(new Error("not implemented"));
  }
}

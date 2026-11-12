import type { IlinkClient } from "./client";
import type { IlinkTransportOptions } from "./http";
import type { MessageItem } from "./types";

export type OutboundMediaKind = "image" | "video" | "file";

/** How a file is sent, going by its extension. Anything unknown is a file. */
export function mediaKindForFileName(name: string): OutboundMediaKind {
  throw new Error("not implemented");
}

/** Encrypts and uploads a file, and resolves with the item to send. */
export function uploadMedia(options: {
  client: Pick<IlinkClient, "getUploadUrl">;
  transport: IlinkTransportOptions;
  toUserId: string;
  fileName: string;
  data: Uint8Array;
  kind?: OutboundMediaKind;
}): Promise<MessageItem> {
  throw new Error("not implemented");
}

/**
 * Downloads and decrypts the file of an inbound item. Resolves with
 * `undefined` for an item that has no file to fetch.
 */
export function downloadMedia(options: {
  transport: IlinkTransportOptions;
  item: MessageItem;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<
  | {
      data: Buffer;
      kind: "image" | "video" | "file" | "voice";
      fileName?: string;
    }
  | undefined
> {
  throw new Error("not implemented");
}

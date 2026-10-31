import { attachmentImageUrl as desktopAttachmentImageUrl } from "@/shared/attachments";

/** Asset addressing is a client capability; attachment data stays transport-neutral. */
export function attachmentImageUrl(filePath: string): string {
  return typeof window !== "undefined" && window.pine?.runtime === "web"
    ? `${window.location.origin}/api/attachment?p=${encodeURIComponent(filePath)}`
    : desktopAttachmentImageUrl(filePath);
}

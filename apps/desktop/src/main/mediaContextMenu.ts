import path from "node:path";
import { ATTACHMENT_IMAGE_PROTOCOL } from "../shared/attachments";
import { PROJECT_MEDIA_PROTOCOL } from "../shared/projectFiles";
import { isServedPreviewFile } from "../shared/previewFormats";
import { expandHomePath } from "./homePath";
import {
  resolveProjectMediaPath,
  type ProjectMediaResolvers,
} from "./projectFilePreview";

/** Where the bytes of a right-clicked image or video come from. */
export type MediaSource =
  /** A local file the window was already allowed to load. */
  | { kind: "file"; path: string }
  /** A web address the page loaded directly. */
  | { kind: "remote"; url: string }
  /** Bytes with no address worth sharing, such as a decoded blob. */
  | { kind: "inline" };

export interface MediaSourceResolvers extends ProjectMediaResolvers {
  /** The attachment protocol's own grant check. */
  attachment: (resolvedPath: string) => Promise<boolean>;
}

/**
 * Maps a media element's URL back to what it shows. Custom-protocol URLs
 * resolve through the same grants the protocols serve with, and only for the
 * window that owns the URL, so the menu never reaches a file the window could
 * not already load. Undefined when the URL grants nothing.
 */
export async function resolveMediaSource(
  srcUrl: string,
  ownerId: number,
  resolvers: MediaSourceResolvers,
): Promise<MediaSource | undefined> {
  const url = URL.parse(srcUrl);
  if (!url) return undefined;
  const scheme = url.protocol.slice(0, -1);
  if (scheme === "http" || scheme === "https")
    return { kind: "remote", url: url.href };
  if (scheme === "blob" || scheme === "data") return { kind: "inline" };
  try {
    if (scheme === ATTACHMENT_IMAGE_PROTOCOL) {
      const requested = url.searchParams.get("p");
      if (!requested) return undefined;
      const resolved = path.resolve(expandHomePath(requested));
      return (await resolvers.attachment(resolved))
        ? { kind: "file", path: resolved }
        : undefined;
    }
    if (scheme === PROJECT_MEDIA_PROTOCOL) {
      if (url.hostname !== "preview") return undefined;
      // The protocol trusts the owner in the URL; the menu also requires the
      // window that shows the media to be that owner.
      if (url.searchParams.get("owner") !== String(ownerId)) return undefined;
      const resolved = await resolveProjectMediaPath(url, ownerId, resolvers);
      return resolved !== undefined && isServedPreviewFile(resolved)
        ? { kind: "file", path: resolved }
        : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type MediaMenuAction =
  "copy-image" | "save" | "copy-path" | "copy-address" | "reveal";

export type MediaMenuEntry =
  | { type: "action"; action: MediaMenuAction; label: string; enabled: boolean }
  | {
      type: "share";
      label: string;
      sharing: { filePaths: string[] } | { urls: string[] };
    }
  | { type: "separator" };

export interface MediaMenuInput {
  mediaType: "image" | "video";
  source: MediaSource;
  /** Whether the image has decoded pixels to copy. */
  hasImageContents: boolean;
  platform: NodeJS.Platform;
  chinese: boolean;
}

function revealLabel(platform: NodeJS.Platform, chinese: boolean): string {
  if (platform === "darwin") return chinese ? "在访达中显示" : "Show in Finder";
  if (platform === "win32")
    return chinese ? "在资源管理器中显示" : "Show in File Explorer";
  return chinese ? "在文件夹中显示" : "Show in Folder";
}

/** The native menu for a right-clicked image or video, as plain entries. */
export function mediaContextMenu(input: MediaMenuInput): MediaMenuEntry[] {
  const { chinese, source } = input;
  const image = input.mediaType === "image";
  const entries: MediaMenuEntry[] = [];
  const action = (
    name: MediaMenuAction,
    label: string,
    enabled = true,
  ): void => {
    entries.push({ type: "action", action: name, label, enabled });
  };
  if (image)
    action(
      "copy-image",
      chinese ? "拷贝图片" : "Copy Image",
      input.hasImageContents,
    );
  if (source.kind === "inline") return entries;

  if (image) action("save", chinese ? "存储图片为…" : "Save Image As…");
  else action("save", chinese ? "存储视频为…" : "Save Video As…");
  if (source.kind === "file") {
    action("copy-path", chinese ? "拷贝文件路径" : "Copy File Path");
    action("reveal", revealLabel(input.platform, chinese));
  } else if (image) {
    action("copy-address", chinese ? "拷贝图片地址" : "Copy Image Address");
  } else {
    action("copy-address", chinese ? "拷贝视频地址" : "Copy Video Address");
  }
  if (input.platform === "darwin") {
    entries.push(
      { type: "separator" },
      {
        type: "share",
        label: chinese ? "共享" : "Share",
        sharing:
          source.kind === "file"
            ? { filePaths: [source.path] }
            : { urls: [source.url] },
      },
    );
  }
  return entries;
}

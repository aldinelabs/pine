import path from "node:path";
import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  mediaContextMenu,
  resolveMediaSource,
  type MediaSourceResolvers,
} from "../mediaContextMenu";
import { attachmentImageUrl } from "../../shared/attachments";
import { projectMediaUrl } from "../projectFilePreview";

function resolvers(
  overrides: Partial<MediaSourceResolvers> = {},
): MediaSourceResolvers {
  return {
    attachment: vi.fn(() => Promise.resolve(true)),
    project: vi.fn((_owner: number, params: Record<string, string>) =>
      Promise.resolve(path.join("/projects/demo", params.relativePath)),
    ),
    presented: vi.fn((_owner: number, params: Record<string, string>) =>
      Promise.resolve(params.path),
    ),
    ...overrides,
  };
}

describe("resolveMediaSource", () => {
  it("resolves an attachment URL through the attachment grant", async () => {
    const grants = resolvers();
    await expect(
      resolveMediaSource(attachmentImageUrl("/tmp/shot.png"), 3, grants),
    ).resolves.toEqual({ kind: "file", path: "/tmp/shot.png" });
    expect(grants.attachment).toHaveBeenCalledWith("/tmp/shot.png");
  });

  it("expands home and normalizes an attachment path before the check", async () => {
    const grants = resolvers();
    const expected = path.join(homedir(), "pics/a.png");
    await expect(
      resolveMediaSource(attachmentImageUrl("~/pics/../pics/a.png"), 3, grants),
    ).resolves.toEqual({ kind: "file", path: expected });
    expect(grants.attachment).toHaveBeenCalledWith(expected);
  });

  it("refuses an attachment the protocol would not serve", async () => {
    const grants = resolvers({
      attachment: vi.fn(() => Promise.resolve(false)),
    });
    await expect(
      resolveMediaSource(attachmentImageUrl("/etc/secret.png"), 3, grants),
    ).resolves.toBeUndefined();
    await expect(
      resolveMediaSource("pine-attachment://local/", 3, grants),
    ).resolves.toBeUndefined();
  });

  it("resolves a project entry for the window that owns the URL", async () => {
    const grants = resolvers();
    const url = projectMediaUrl(7, {
      projectId: "p",
      folderId: "f",
      relativePath: "clips/demo.mp4",
    });
    await expect(resolveMediaSource(url, 7, grants)).resolves.toEqual({
      kind: "file",
      path: "/projects/demo/clips/demo.mp4",
    });
    expect(grants.project).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ relativePath: "clips/demo.mp4" }),
    );
  });

  it("refuses a project URL owned by another window", async () => {
    const grants = resolvers();
    const url = projectMediaUrl(7, {
      projectId: "p",
      folderId: "f",
      relativePath: "a.png",
    });
    await expect(resolveMediaSource(url, 8, grants)).resolves.toBeUndefined();
    expect(grants.project).not.toHaveBeenCalled();
  });

  it("uses the presented-file grant for presented media", async () => {
    const grants = resolvers();
    const url = projectMediaUrl(
      7,
      { path: "/Users/me/Desktop/out.png" },
      { presented: true },
    );
    await expect(resolveMediaSource(url, 7, grants)).resolves.toEqual({
      kind: "file",
      path: "/Users/me/Desktop/out.png",
    });
    expect(grants.presented).toHaveBeenCalled();
    expect(grants.project).not.toHaveBeenCalled();
  });

  it("refuses when a grant check throws", async () => {
    const grants = resolvers({
      presented: vi.fn(() =>
        Promise.reject(
          new Error("This file was not presented to this window."),
        ),
      ),
    });
    const url = projectMediaUrl(7, { path: "/x.png" }, { presented: true });
    await expect(resolveMediaSource(url, 7, grants)).resolves.toBeUndefined();
  });

  it("resolves a Markdown image relative to its document", async () => {
    const grants = resolvers();
    const url = URL.parse(
      projectMediaUrl(7, {
        projectId: "p",
        folderId: "f",
        relativePath: "docs/readme.md",
      }),
    )!;
    url.searchParams.set("markdownImage", "img/a.png");
    await expect(resolveMediaSource(url.href, 7, grants)).resolves.toEqual({
      kind: "file",
      path: "/projects/demo/docs/img/a.png",
    });
  });

  it("refuses a Markdown image that is not an image", async () => {
    const grants = resolvers();
    const url = URL.parse(
      projectMediaUrl(7, {
        projectId: "p",
        folderId: "f",
        relativePath: "docs/readme.md",
      }),
    )!;
    url.searchParams.set("markdownImage", "notes.txt");
    await expect(
      resolveMediaSource(url.href, 7, grants),
    ).resolves.toBeUndefined();
  });

  it("keeps web and inline media as what they are", async () => {
    const grants = resolvers();
    await expect(
      resolveMediaSource("https://example.com/a.png", 1, grants),
    ).resolves.toEqual({ kind: "remote", url: "https://example.com/a.png" });
    await expect(
      resolveMediaSource("blob:file:///1234", 1, grants),
    ).resolves.toEqual({ kind: "inline" });
    await expect(
      resolveMediaSource("data:image/png;base64,AAAA", 1, grants),
    ).resolves.toEqual({ kind: "inline" });
  });

  it("ignores other schemes and malformed URLs", async () => {
    const grants = resolvers();
    await expect(
      resolveMediaSource("file:///etc/passwd", 1, grants),
    ).resolves.toBeUndefined();
    await expect(
      resolveMediaSource("not a url", 1, grants),
    ).resolves.toBeUndefined();
  });
});

function summary(entries: ReturnType<typeof mediaContextMenu>): string[] {
  return entries.map((entry) =>
    entry.type === "action"
      ? `${entry.action}${entry.enabled ? "" : " (disabled)"}`
      : entry.type,
  );
}

describe("mediaContextMenu", () => {
  const file = { kind: "file", path: "/p/a.png" } as const;

  it("offers copy, save, path, reveal and share for a local image on macOS", () => {
    const entries = mediaContextMenu({
      mediaType: "image",
      source: file,
      hasImageContents: true,
      platform: "darwin",
      chinese: false,
    });
    expect(summary(entries)).toEqual([
      "copy-image",
      "save",
      "copy-path",
      "reveal",
      "separator",
      "share",
    ]);
    expect(entries.at(-1)).toEqual({
      type: "share",
      label: "Share",
      sharing: { filePaths: ["/p/a.png"] },
    });
    expect(entries[3]).toMatchObject({ label: "Show in Finder" });
  });

  it("leaves out copy image for a video and shares its file", () => {
    const entries = mediaContextMenu({
      mediaType: "video",
      source: { kind: "file", path: "/p/a.mp4" },
      hasImageContents: false,
      platform: "darwin",
      chinese: true,
    });
    expect(summary(entries)).toEqual([
      "save",
      "copy-path",
      "reveal",
      "separator",
      "share",
    ]);
    expect(entries[0]).toMatchObject({ label: "存储视频为…" });
  });

  it("copies the address of web media and shares the URL", () => {
    const entries = mediaContextMenu({
      mediaType: "image",
      source: { kind: "remote", url: "https://example.com/a.png" },
      hasImageContents: true,
      platform: "darwin",
      chinese: false,
    });
    expect(summary(entries)).toEqual([
      "copy-image",
      "save",
      "copy-address",
      "separator",
      "share",
    ]);
    expect(entries.at(-1)).toMatchObject({
      sharing: { urls: ["https://example.com/a.png"] },
    });
  });

  it("has no share menu outside macOS", () => {
    const entries = mediaContextMenu({
      mediaType: "image",
      source: file,
      hasImageContents: true,
      platform: "win32",
      chinese: false,
    });
    expect(summary(entries)).toEqual([
      "copy-image",
      "save",
      "copy-path",
      "reveal",
    ]);
    expect(entries[3]).toMatchObject({ label: "Show in File Explorer" });
  });

  it("only copies inline images, and disables copy before pixels load", () => {
    expect(
      summary(
        mediaContextMenu({
          mediaType: "image",
          source: { kind: "inline" },
          hasImageContents: false,
          platform: "darwin",
          chinese: false,
        }),
      ),
    ).toEqual(["copy-image (disabled)"]);
    expect(
      mediaContextMenu({
        mediaType: "video",
        source: { kind: "inline" },
        hasImageContents: false,
        platform: "darwin",
        chinese: false,
      }),
    ).toEqual([]);
  });
});

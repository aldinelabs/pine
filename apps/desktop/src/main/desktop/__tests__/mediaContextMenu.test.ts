import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const popup = vi.fn();
  const buildFromTemplate = vi.fn((template: unknown) => ({ template, popup }));
  return {
    popup,
    buildFromTemplate,
    writeText: vi.fn(),
    showItemInFolder: vi.fn(),
    showSaveDialog: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: { getLocale: () => "en-US", getPath: () => "/Users/me/Downloads" },
  BrowserWindow: { fromWebContents: () => null },
  Menu: { buildFromTemplate: electron.buildFromTemplate },
  Notification: class {},
  clipboard: { writeText: electron.writeText },
  dialog: { showSaveDialog: electron.showSaveDialog },
  shell: { showItemInFolder: electron.showItemInFolder },
}));

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MenuItemConstructorOptions, WebContents } from "electron";
import { attachmentImageUrl } from "../../../shared/attachments";
import type { MediaSourceResolvers } from "../../mediaContextMenu";
import { installMediaContextMenu } from "../mediaContextMenu";

class FakeWebContents extends EventEmitter {
  id = 4;
  isDestroyed = () => false;
  copyImageAt = vi.fn();
  downloadURL = vi.fn();
}

const grants: MediaSourceResolvers = {
  attachment: (resolved) => Promise.resolve(resolved.startsWith("/allowed/")),
  project: () => Promise.resolve("/allowed/x.png"),
  presented: () => Promise.resolve("/allowed/x.png"),
};

function setup(resolvers: MediaSourceResolvers | undefined) {
  const contents = new FakeWebContents();
  installMediaContextMenu(contents as unknown as WebContents, () => resolvers);
  return contents;
}

async function rightClick(
  contents: FakeWebContents,
  params: Partial<Electron.ContextMenuParams>,
): Promise<MenuItemConstructorOptions[] | undefined> {
  electron.buildFromTemplate.mockClear();
  contents.emit(
    "context-menu",
    {},
    { x: 10, y: 20, hasImageContents: true, srcURL: "", ...params },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return electron.buildFromTemplate.mock.calls[0]?.[0] as
    MenuItemConstructorOptions[] | undefined;
}

function item(
  template: MenuItemConstructorOptions[] | undefined,
  label: string,
): MenuItemConstructorOptions {
  const found = template?.find((entry) => entry.label === label);
  if (!found) throw new Error(`No menu item ${label}`);
  return found;
}

describe("installMediaContextMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows no menu for text, links or empty space", async () => {
    const contents = setup(grants);
    expect(await rightClick(contents, { mediaType: "none" })).toBeUndefined();
    expect(electron.popup).not.toHaveBeenCalled();
  });

  it("shows no menu for media the window may not read", async () => {
    const contents = setup(grants);
    expect(
      await rightClick(contents, {
        mediaType: "image",
        srcURL: attachmentImageUrl("/secret/a.png"),
      }),
    ).toBeUndefined();
  });

  it("shows no menu before Pine is ready", async () => {
    const contents = setup(undefined);
    expect(
      await rightClick(contents, {
        mediaType: "image",
        srcURL: attachmentImageUrl("/allowed/a.png"),
      }),
    ).toBeUndefined();
  });

  it("runs each image action against the real file", async () => {
    const contents = setup(grants);
    const template = await rightClick(contents, {
      mediaType: "image",
      srcURL: attachmentImageUrl("/allowed/a.png"),
    });
    expect(electron.popup).toHaveBeenCalled();

    item(template, "Copy Image").click?.({} as never, undefined, {});
    expect(contents.copyImageAt).toHaveBeenCalledWith(10, 20);

    item(template, "Copy File Path").click?.({} as never, undefined, {});
    expect(electron.writeText).toHaveBeenCalledWith("/allowed/a.png");

    const reveal = template?.find((entry) =>
      String(entry.label).startsWith("Show in"),
    );
    reveal?.click?.({} as never, undefined, {});
    expect(electron.showItemInFolder).toHaveBeenCalledWith("/allowed/a.png");

    if (process.platform === "darwin")
      expect(template?.at(-1)).toMatchObject({
        role: "shareMenu",
        sharingItem: { filePaths: ["/allowed/a.png"] },
      });
  });

  it("downloads and copies the address of web media", async () => {
    const contents = setup(grants);
    const template = await rightClick(contents, {
      mediaType: "video",
      srcURL: "https://example.com/clip.mp4",
    });
    item(template, "Save Video As…").click?.({} as never, undefined, {});
    expect(contents.downloadURL).toHaveBeenCalledWith(
      "https://example.com/clip.mp4",
    );
    item(template, "Copy Video Address").click?.({} as never, undefined, {});
    expect(electron.writeText).toHaveBeenCalledWith(
      "https://example.com/clip.mp4",
    );
  });

  it("saves a copy of the real file where the user chooses", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pine-media-menu-"));
    try {
      const source = path.join(directory, "a.png");
      const target = path.join(directory, "copy.png");
      await writeFile(source, "pixels");
      const contents = setup({
        ...grants,
        attachment: (resolved) => Promise.resolve(resolved === source),
      });
      const template = await rightClick(contents, {
        mediaType: "image",
        srcURL: attachmentImageUrl(source),
      });
      electron.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: target,
      });
      item(template, "Save Image As…").click?.({} as never, undefined, {});
      await vi.waitFor(async () =>
        expect(await readFile(target, "utf8")).toBe("pixels"),
      );
      expect(electron.showSaveDialog).toHaveBeenCalledWith({
        defaultPath: path.join("/Users/me/Downloads", "a.png"),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

import { copyFile } from "node:fs/promises";
import path from "node:path";
import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import {
  mediaContextMenu,
  resolveMediaSource,
  type MediaMenuAction,
  type MediaSource,
  type MediaSourceResolvers,
} from "../mediaContextMenu";
import { isChineseLocale } from "./attention";

/**
 * Shows the system's own menu when the user right-clicks an image or video:
 * copy, save, share and reveal the real file behind Pine's media URLs. Every
 * other right-click keeps Electron's default of no menu.
 */
export function installMediaContextMenu(
  webContents: WebContents,
  resolvers: () => MediaSourceResolvers | undefined,
): void {
  webContents.on("context-menu", (_event, params) => {
    const { mediaType } = params;
    if (mediaType !== "image" && mediaType !== "video") return;
    const current = resolvers();
    if (!current) return;
    void (async () => {
      const source = await resolveMediaSource(
        params.srcURL,
        webContents.id,
        current,
      );
      if (!source || webContents.isDestroyed()) return;
      const entries = mediaContextMenu({
        mediaType,
        source,
        hasImageContents: params.hasImageContents,
        platform: process.platform,
        chinese: isChineseLocale(),
      });
      if (!entries.length) return;
      const run = (action: MediaMenuAction) =>
        void runMediaAction(action, {
          webContents,
          source,
          mediaType,
          x: params.x,
          y: params.y,
        }).catch(() => undefined);
      const template = entries.map((entry): MenuItemConstructorOptions => {
        if (entry.type === "separator") return { type: "separator" };
        if (entry.type === "share")
          return {
            role: "shareMenu",
            label: entry.label,
            sharingItem: entry.sharing,
          };
        return {
          label: entry.label,
          enabled: entry.enabled,
          click: () => run(entry.action),
        };
      });
      const window = BrowserWindow.fromWebContents(webContents) ?? undefined;
      Menu.buildFromTemplate(template).popup({ window });
    })();
  });
}

async function runMediaAction(
  action: MediaMenuAction,
  target: {
    webContents: WebContents;
    source: MediaSource;
    mediaType: "image" | "video";
    x: number;
    y: number;
  },
): Promise<void> {
  const { webContents, source } = target;
  if (action === "copy-image") {
    webContents.copyImageAt(target.x, target.y);
    return;
  }
  if (source.kind === "inline") return;
  if (action === "copy-address" && source.kind === "remote") {
    await clipboard.writeText(source.url);
    return;
  }
  if (action === "copy-path" && source.kind === "file") {
    await clipboard.writeText(source.path);
    return;
  }
  if (action === "reveal" && source.kind === "file") {
    shell.showItemInFolder(source.path);
    return;
  }
  if (action !== "save") return;
  // Electron asks where to save a web download itself.
  if (source.kind === "remote") {
    webContents.downloadURL(source.url);
    return;
  }
  const window = BrowserWindow.fromWebContents(webContents);
  const options = {
    defaultPath: path.join(
      app.getPath("downloads"),
      path.basename(source.path),
    ),
  };
  const { canceled, filePath } = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath || filePath === source.path) return;
  await copyFile(source.path, filePath);
}

import { app } from "electron";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const loaded = new Map<string, unknown>();

/**
 * Loads native/<folder>/build/<name>.node, built by scripts/build-native.mjs
 * and only on macOS; packaged apps carry it in their resources. Null where it
 * is missing or does not load.
 */
export function loadNativeAddon<T>(folder: string, name: string): T | null {
  if (loaded.has(name)) return loaded.get(name) as T | null;
  let addon: T | null = null;
  if (process.platform === "darwin") {
    const file = [
      path.join(process.resourcesPath, `${name}.node`),
      path.join(app.getAppPath(), `native/${folder}/build/${name}.node`),
    ].find((candidate) => existsSync(candidate));
    try {
      if (file) addon = createRequire(__filename)(file) as T;
    } catch {
      // Missing or incompatible addon.
    }
  }
  loaded.set(name, addon);
  return addon;
}

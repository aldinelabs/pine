// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The headless server bundles WeChat remote, so none of it may load Electron.

const here = path.dirname(fileURLToPath(import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const source = path.resolve(here, "../../..");
const repository = path.resolve(source, "../../..");

const roots = [
  path.join(source, "main/wechat"),
  path.join(source, "shared/wechatRemote.ts"),
  path.join(source, "server/wechatCli.ts"),
  path.join(repository, "packages/wechat-ilink/src"),
];

const ELECTRON_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']electron(?:\/[^"']*)?["']/;

function sourceFiles(target: string): string[] {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) {
    return /\.(?:ts|mts|cts|js|mjs)$/.test(target) ? [target] : [];
  }
  return readdirSync(target)
    .filter((name) => name !== "node_modules")
    .flatMap((name) => sourceFiles(path.join(target, name)));
}

describe("WeChat remote without Electron", () => {
  const files = roots.flatMap(sourceFiles).filter((file) => file !== thisFile);

  it("finds the sources it checks", () => {
    expect(files).toContain(path.join(source, "shared/wechatRemote.ts"));
    expect(files).toContain(path.join(source, "main/wechat/bridge.ts"));
    expect(
      files.some((file) => file.includes(`wechat-ilink${path.sep}src`)),
    ).toBe(true);
  });

  it("never imports electron", () => {
    const offenders = files.filter((file) =>
      ELECTRON_IMPORT.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises an electron import", () => {
    expect(ELECTRON_IMPORT.test('import { app } from "electron";')).toBe(true);
    expect(ELECTRON_IMPORT.test("const e = require('electron');")).toBe(true);
    expect(ELECTRON_IMPORT.test('await import("electron/main");')).toBe(true);
    expect(ELECTRON_IMPORT.test('import "electron";')).toBe(true);
    expect(ELECTRON_IMPORT.test('from "electron-store"')).toBe(false);
  });
});

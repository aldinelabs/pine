import { describe, expect, it, vi } from "vitest";
import {
  AppUpdater,
  type AppUpdaterOptions,
  compareVersions,
  parseUpdateManifest,
  resolveCurrentAppPath,
  resolveWindowsFeedUrl,
} from "../appUpdater";

const manifestUrl = "https://downloads.example.com/pine/latest/update.json";
const manifest = {
  schemaVersion: 1,
  version: "1.2.0",
  internalVersion: "abc1234",
  publishedAt: "2026-09-10T12:00:00.000Z",
  changelog: "### Added\n\n- Updates.",
  assets: {
    "darwin-arm64": {
      url: "https://downloads.example.com/pine/releases/v1.2.0/Pine-arm64.dmg",
      sha256: "a".repeat(64),
      size: 100,
    },
    "win32-x64": {
      url: "https://downloads.example.com/pine/releases/v1.2.0/Pine-x64.exe",
      sha256: "b".repeat(64),
      size: 120,
    },
  },
};

describe("app updater", () => {
  it("compares stable and prerelease semantic versions", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0-rc.2", "1.2.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.2.0+build.2", "1.2.0+build.1")).toBe(0);
  });

  it("resolves only an application bundle executable", () => {
    expect(
      resolveCurrentAppPath("/Applications/Pine.app/Contents/MacOS/Pine"),
    ).toBe("/Applications/Pine.app");
    expect(resolveCurrentAppPath("/usr/local/bin/pine")).toBeNull();
  });

  it("resolves an architecture-specific Windows Squirrel feed", () => {
    expect(resolveWindowsFeedUrl(manifestUrl, "x64")).toBe(
      "https://downloads.example.com/pine/latest/win32-x64/",
    );
  });

  it("accepts assets on the configured R2 origin and prefix", () => {
    expect(parseUpdateManifest(manifest, manifestUrl).version).toBe("1.2.0");
    expect(() =>
      parseUpdateManifest(
        {
          ...manifest,
          assets: {
            "darwin-arm64": {
              ...manifest.assets["darwin-arm64"],
              url: "https://example.org/Pine.dmg",
            },
          },
        },
        manifestUrl,
      ),
    ).toThrow("configured R2 origin");
  });

  it("keeps per-language notes and ignores unusable ones", () => {
    expect(parseUpdateManifest(manifest, manifestUrl).changelogs).toBe(
      undefined,
    );
    expect(
      parseUpdateManifest(
        {
          ...manifest,
          changelogs: {
            "zh-CN": "- 更新。",
            "en-US": " ",
            "fr-FR": "- Mise à jour.",
          },
        },
        manifestUrl,
      ).changelogs,
    ).toEqual({ "zh-CN": "- 更新。" });
  });

  it("reports a newer compatible release", async () => {
    const updater = new AppUpdater({
      arch: "arm64",
      currentExecutable: "/Applications/Pine.app/Contents/MacOS/Pine",
      currentVersion: "1.1.0",
      emit: vi.fn(),
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
      manifestUrl,
      platform: "darwin",
      quit: vi.fn(),
      tempDirectory: "/tmp",
    });

    await expect(updater.check()).resolves.toEqual({
      status: "available",
      update: {
        changelog: manifest.changelog,
        internalVersion: "abc1234",
        publishedAt: manifest.publishedAt,
        version: "1.2.0",
      },
    });
  });

  it("downloads and installs Windows updates through Squirrel", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const rawWindowsUpdater = {
      checkForUpdates: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return rawWindowsUpdater;
      }),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return rawWindowsUpdater;
      }),
      quitAndInstall: vi.fn(),
      removeListener: vi.fn(
        (event: string, listener: (...args: unknown[]) => void) => {
          if (listeners.get(event) === listener) listeners.delete(event);
          return rawWindowsUpdater;
        },
      ),
      setFeedURL: vi.fn(),
    };
    const windowsUpdater = rawWindowsUpdater as unknown as NonNullable<
      AppUpdaterOptions["windowsUpdater"]
    >;
    const emit = vi.fn();
    const updater = new AppUpdater({
      arch: "x64",
      currentExecutable: "C:\\Users\\pine\\AppData\\Local\\Pine\\Pine.exe",
      currentVersion: "1.1.0",
      emit,
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
      manifestUrl,
      platform: "win32",
      quit: vi.fn(),
      tempDirectory: "C:\\Temp",
      windowsUpdater,
    });

    await expect(updater.check()).resolves.toMatchObject({
      status: "available",
    });
    const download = updater.download();
    expect(rawWindowsUpdater.setFeedURL).toHaveBeenCalledWith({
      url: "https://downloads.example.com/pine/latest/win32-x64/",
    });
    expect(rawWindowsUpdater.checkForUpdates).toHaveBeenCalledOnce();
    listeners.get("update-downloaded")?.();
    await expect(download).resolves.toEqual({ ready: true });
    expect(emit).toHaveBeenCalledWith({ type: "download-ready" });

    await expect(updater.install()).resolves.toEqual({ started: true });
    expect(rawWindowsUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });
});

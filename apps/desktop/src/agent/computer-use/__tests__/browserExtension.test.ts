import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ToolGate } from "../../gate";
import {
  browserExtensionGuide,
  extensionDisconnectedHint,
  PINE_BROWSER_EXTENSION_ID,
  syncBrowserExtension,
} from "../browserExtension";
import { ComputerUseController } from "../tools";

function fakeExtension(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "pine-ext-src-"));
  writeFileSync(path.join(directory, "manifest.json"), '{"version":"1"}');
  mkdirSync(path.join(directory, "icons"));
  writeFileSync(path.join(directory, "icons", "icon-16.png"), "png");
  return directory;
}

function fakeGate(): ToolGate {
  return {
    reviewBashCommand: vi.fn(),
    reviewFileCall: vi.fn(),
    reviewDenial: vi.fn(),
    reviewPrivilegedCall: vi.fn(() =>
      Promise.resolve({ kind: "allow" as const }),
    ),
    isApprovedCommand: vi.fn(() => false),
    resetTurn: vi.fn(),
  };
}

function fakeClient(result: unknown = { content: [], isError: false }) {
  return {
    start: vi.fn(() => Promise.resolve()),
    callTool: vi.fn(() => Promise.resolve(result)),
    dispose: vi.fn(() => Promise.resolve()),
  };
}

describe("syncBrowserExtension", () => {
  it("copies the bundle, rewrites only changed files and drops stale ones", () => {
    const source = fakeExtension();
    const target = path.join(
      mkdtempSync(path.join(tmpdir(), "pine-ext-")),
      "chrome-extension",
    );
    expect(syncBrowserExtension(source, target)).toBe(true);
    expect(
      readFileSync(path.join(target, "icons", "icon-16.png"), "utf8"),
    ).toBe("png");

    const icon = path.join(target, "icons", "icon-16.png");
    const before = statSync(icon).mtimeMs;
    writeFileSync(path.join(target, "stale.js"), "old");
    writeFileSync(path.join(source, "manifest.json"), '{"version":"2"}');
    syncBrowserExtension(source, target);

    expect(readFileSync(path.join(target, "manifest.json"), "utf8")).toBe(
      '{"version":"2"}',
    );
    expect(statSync(icon).mtimeMs).toBe(before);
    expect(existsSync(path.join(target, "stale.js"))).toBe(false);
  });

  it("reports a bundle without an extension", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "pine-ext-none-"));
    expect(syncBrowserExtension(empty, path.join(empty, "out"))).toBe(false);
  });
});

describe("browserExtensionGuide", () => {
  it.each<[NodeJS.Platform, string]>([
    ["darwin", "⌘ + Shift + G"],
    ["win32", "address bar"],
    ["linux", "Ctrl + L"],
  ])("gives %s folder-picker steps with the real path", (platform, tip) => {
    const guide = browserExtensionGuide({
      extensionDirectory: "/support/chrome-extension",
      available: true,
      platform,
    });
    expect(guide).toContain("`/support/chrome-extension`");
    expect(guide).toContain(PINE_BROWSER_EXTENSION_ID);
    expect(guide).toContain(tip);
    expect(guide).toContain("Load unpacked");
    expect(guide).toContain("Never open or drive `chrome://extensions`");
    expect(guide).toContain("browser_list_tabs");
    expect(guide).not.toContain("installation looks incomplete");
  });

  it("says when the build has no extension", () => {
    expect(
      browserExtensionGuide({
        extensionDirectory: "/x",
        available: false,
        platform: "darwin",
      }),
    ).toContain("installation looks incomplete");
  });
});

describe("extensionDisconnectedHint", () => {
  it("matches the runtime's disconnected errors only", () => {
    expect(
      extensionDisconnectedHint(
        "error: the Pine Computer Use Chrome extension is not connected",
      ),
    ).toContain("never by driving chrome://extensions");
    expect(
      extensionDisconnectedHint(
        "browser_navigate could not reach Chrome: this MCP server owns the browser bridge",
      ),
    ).not.toBeNull();
    expect(extensionDisconnectedHint("error: missing tab_id")).toBeNull();
  });
});

describe("ComputerUseController browser extension", () => {
  it("returns the guide with the stable extension path on activation", async () => {
    const support = mkdtempSync(path.join(tmpdir(), "pine-cu-"));
    const controller = new ComputerUseController({
      client: fakeClient(),
      executablePath: "/mock/pine-computer-use",
      supportDirectory: support,
      bundledExtensionDirectory: fakeExtension(),
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(),
    });
    const result = await controller.activate(vi.fn());
    const text = (result.content[0] as { text: string }).text;
    const stable = path.join(support, "chrome-extension");
    expect(text).toContain("<pine_browser_extension_guide>");
    expect(text).toContain(`\`${stable}\``);
    expect(existsSync(path.join(stable, "manifest.json"))).toBe(true);
  });

  it("points disconnected browser errors to the guide", async () => {
    const controller = new ComputerUseController({
      client: fakeClient({
        content: [
          {
            type: "text",
            text: "error: the Pine Computer Use Chrome extension is not connected",
          },
        ],
        isError: true,
      }),
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "YOLO",
      getGate: () => fakeGate(),
    });
    await expect(
      controller.call("c1", "browser_release_tab", { tab_id: 1 }),
    ).rejects.toThrow(/Pine browser extension guide/);
  });

  it.skipIf(process.platform === "win32")(
    "registers the host, then reveals the stable folder",
    async () => {
      const support = mkdtempSync(path.join(tmpdir(), "pine-cu-"));
      const executable = path.join(support, "fake-computer-use");
      writeFileSync(executable, "#!/bin/sh\necho registered\n", {
        mode: 0o755,
      });
      const revealDirectory = vi.fn();
      const controller = new ComputerUseController({
        client: fakeClient(),
        executablePath: executable,
        supportDirectory: support,
        bundledExtensionDirectory: fakeExtension(),
        revealDirectory,
        getApprovalMode: () => "auto-approve",
        getGate: () => fakeGate(),
      });
      const result = await controller.installBrowserExtension("c1");
      const stable = path.join(support, "chrome-extension");
      expect(revealDirectory).toHaveBeenCalledWith(stable);
      expect((result.content[0] as { text: string }).text).toContain(stable);
    },
  );
});

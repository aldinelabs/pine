import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREFERENCES_CHANGED_CHANNEL } from "../../shared/preferenceStorage";
import { notifyPreferenceChange, PreferenceStore } from "../preferenceStore";

const directories: string[] = [];
function fileInTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "pine-preferences-"));
  directories.push(directory);
  return path.join(directory, "nested", "ui-preferences.json");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PreferenceStore", () => {
  it("persists values across instances", () => {
    const file = fileInTemporaryDirectory();
    const first = new PreferenceStore(file);
    first.set("pine.theme-preference", "dark");
    first.set("pine.locale", "ja-JP");
    first.remove("pine.locale");

    expect(new PreferenceStore(file).snapshot()).toEqual({
      "pine.theme-preference": "dark",
    });
  });

  it("ignores keys outside the pine namespace and non-string values", () => {
    const file = fileInTemporaryDirectory();
    const store = new PreferenceStore(file);
    store.set("other.key", "x");
    store.set("pine.count", 3);
    store.set(42, "x");

    expect(store.snapshot()).toEqual({});
  });

  it("starts empty from a damaged file and drops invalid entries", () => {
    const file = fileInTemporaryDirectory();
    const store = new PreferenceStore(file);
    store.set("pine.a", "1");
    writeFileSync(file, "{not json");
    expect(new PreferenceStore(file).snapshot()).toEqual({});

    writeFileSync(file, JSON.stringify({ "pine.a": "1", "pine.b": 2, x: "3" }));
    expect(new PreferenceStore(file).snapshot()).toEqual({ "pine.a": "1" });
    expect(readFileSync(file, "utf8")).toContain("pine.a");
  });
});

describe("preference changes", () => {
  it("reports whether set and remove changed anything", () => {
    const store = new PreferenceStore(fileInTemporaryDirectory());
    expect(store.set("pine.composer-glow", "false")).toBe(true);
    expect(store.set("pine.composer-glow", "false")).toBe(false);
    expect(store.set("other.key", "x")).toBe(false);
    expect(store.remove("pine.composer-glow")).toBe(true);
    expect(store.remove("pine.composer-glow")).toBe(false);
  });

  it("tells every other open window", () => {
    const target = (id: number, destroyed = false) => ({
      id,
      isDestroyed: () => destroyed,
      send: vi.fn(),
    });
    const sender = target(1);
    const other = target(2);
    const closed = target(3, true);
    notifyPreferenceChange(
      [sender, other, closed],
      1,
      "pine.composer-glow",
      "false",
    );
    expect(sender.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
    expect(other.send).toHaveBeenCalledWith(
      PREFERENCES_CHANGED_CHANNEL,
      "pine.composer-glow",
      "false",
    );
    notifyPreferenceChange([other], 1, "pine.composer-glow", null);
    expect(other.send).toHaveBeenLastCalledWith(
      PREFERENCES_CHANGED_CHANNEL,
      "pine.composer-glow",
      null,
    );
  });
});

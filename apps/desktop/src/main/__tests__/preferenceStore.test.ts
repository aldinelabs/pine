import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PreferenceStore } from "../preferenceStore";

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

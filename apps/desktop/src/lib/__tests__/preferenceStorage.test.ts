import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adoptWebStoragePreferences,
  preferenceStorage,
} from "../preferenceStorage";

function installPreferences(snapshot: Record<string, string> = {}) {
  // contextBridge freezes the objects it hands to the renderer.
  const preferences = Object.freeze({
    snapshot: Object.freeze({ ...snapshot }),
    set: vi.fn(),
    remove: vi.fn(),
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { preferences },
  });
  return preferences;
}

afterEach(() => {
  Reflect.deleteProperty(window, "pine");
});

describe("preferenceStorage", () => {
  it("falls back to web storage without a main process", () => {
    preferenceStorage.setItem("pine.a", "1");
    expect(window.localStorage.getItem("pine.a")).toBe("1");
    expect(preferenceStorage.getItem("pine.a")).toBe("1");
    preferenceStorage.removeItem("pine.a");
    expect(preferenceStorage.getItem("pine.a")).toBeNull();
  });

  it("reads and writes through the main process when available", () => {
    const preferences = installPreferences({ "pine.a": "1" });
    expect(preferenceStorage.getItem("pine.a")).toBe("1");

    preferenceStorage.setItem("pine.b", "2");
    expect(preferences.set).toHaveBeenCalledWith("pine.b", "2");
    expect(preferenceStorage.getItem("pine.b")).toBe("2");
    expect(window.localStorage.getItem("pine.b")).toBeNull();

    preferenceStorage.removeItem("pine.a");
    expect(preferences.remove).toHaveBeenCalledWith("pine.a");
    expect(preferenceStorage.getItem("pine.a")).toBeNull();
  });

  it("adopts web storage values the main process lacks", () => {
    window.localStorage.setItem("pine.old", "kept");
    window.localStorage.setItem("pine.both", "web");
    window.localStorage.setItem("unrelated", "x");
    const preferences = installPreferences({ "pine.both": "main" });

    adoptWebStoragePreferences();

    expect(preferences.set).toHaveBeenCalledTimes(1);
    expect(preferences.set).toHaveBeenCalledWith("pine.old", "kept");
    expect(preferenceStorage.getItem("pine.both")).toBe("main");
  });
});

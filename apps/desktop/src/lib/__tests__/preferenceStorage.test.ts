import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adoptWebStoragePreferences,
  preferenceStorage,
  subscribePreference,
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

describe("subscribePreference", () => {
  function installWithChanges(snapshot: Record<string, string> = {}) {
    const listeners = new Set<(key: string, value: string | null) => void>();
    const preferences = Object.freeze({
      snapshot: Object.freeze({ ...snapshot }),
      set: vi.fn(),
      remove: vi.fn(),
      onChange: vi.fn(
        (listener: (key: string, value: string | null) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      ),
    });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { preferences },
    });
    const report = (key: string, value: string | null) => {
      for (const listener of [...listeners]) listener(key, value);
    };
    return { listeners, report };
  }

  it("reports another window's change to its key and keeps it", () => {
    const { listeners, report } = installWithChanges({ "pine.glow": "true" });
    const listener = vi.fn();
    const unsubscribe = subscribePreference("pine.glow", listener);

    report("pine.other", "x");
    expect(listener).not.toHaveBeenCalled();

    report("pine.glow", "false");
    expect(listener).toHaveBeenLastCalledWith("false");
    expect(preferenceStorage.getItem("pine.glow")).toBe("false");

    report("pine.glow", null);
    expect(listener).toHaveBeenLastCalledWith(null);
    expect(preferenceStorage.getItem("pine.glow")).toBeNull();

    unsubscribe();
    expect(listeners.size).toBe(0);
    report("pine.glow", "true");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does nothing without change reports from the main process", () => {
    installPreferences();
    expect(() => subscribePreference("pine.glow", vi.fn())()).not.toThrow();
  });

  it("follows other tabs in a browser", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePreference("pine.glow", listener);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "pine.other", newValue: "x" }),
    );
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "pine.glow", newValue: "false" }),
    );
    expect(listener).toHaveBeenCalledWith("false");
    unsubscribe();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "pine.glow", newValue: "true" }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

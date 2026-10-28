import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVERT_DOCUMENTS_STORAGE_KEY,
  SIDEBAR_VIBRANCY_STORAGE_KEY,
  TRANSCRIPT_SERIF_STORAGE_KEY,
  useAppearanceStore,
} from "../appearance";

const setSidebarVibrancy = vi.fn().mockResolvedValue({ applied: true });

interface MutablePineWindow {
  pine?: {
    platform: string;
    setSidebarVibrancy: typeof setSidebarVibrancy;
  };
}

function installPineApi(platform: string | undefined): void {
  const pineWindow = window as unknown as MutablePineWindow;
  if (platform === undefined) {
    delete pineWindow.pine;
    return;
  }
  pineWindow.pine = { platform, setSidebarVibrancy };
}

describe("appearance store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    setSidebarVibrancy.mockClear();
    installPineApi(undefined);
    setActivePinia(createPinia());
  });

  it("restores and toggles the sidebar vibrancy effect on macOS", () => {
    installPineApi("darwin");
    window.localStorage.setItem(SIDEBAR_VIBRANCY_STORAGE_KEY, "true");

    const store = useAppearanceStore();
    store.initialize();

    expect(store.supportsSidebarVibrancy).toBe(true);
    expect(store.sidebarVibrancy).toBe(true);
    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(true);
    expect(setSidebarVibrancy).toHaveBeenCalledWith({ enabled: true });

    store.setSidebarVibrancy(false);

    expect(store.sidebarVibrancy).toBe(false);
    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY)).toBe(
      "false",
    );
    expect(setSidebarVibrancy).toHaveBeenCalledWith({ enabled: false });
  });

  it("ignores the sidebar vibrancy preference on other platforms", () => {
    installPineApi("win32");
    window.localStorage.setItem(SIDEBAR_VIBRANCY_STORAGE_KEY, "true");

    const store = useAppearanceStore();
    store.initialize();

    expect(store.supportsSidebarVibrancy).toBe(false);
    expect(store.sidebarVibrancy).toBe(false);
    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(false);
    expect(setSidebarVibrancy).not.toHaveBeenCalled();

    store.setSidebarVibrancy(true);

    expect(store.sidebarVibrancy).toBe(false);
    expect(setSidebarVibrancy).not.toHaveBeenCalled();
  });

  it("restores and toggles the serif transcript font", () => {
    window.localStorage.setItem(TRANSCRIPT_SERIF_STORAGE_KEY, "true");

    const store = useAppearanceStore();
    store.initialize();

    expect(store.transcriptSerif).toBe(true);
    expect(
      document.documentElement.classList.contains("transcript-serif"),
    ).toBe(true);

    store.setTranscriptSerif(false);

    expect(store.transcriptSerif).toBe(false);
    expect(
      document.documentElement.classList.contains("transcript-serif"),
    ).toBe(false);
    expect(window.localStorage.getItem(TRANSCRIPT_SERIF_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("inverts documents in dark mode unless turned off", () => {
    const store = useAppearanceStore();
    store.setThemePreference("dark");
    expect(store.invertDocuments).toBe(true);
    expect(store.invertsDocuments).toBe(true);

    store.setInvertDocuments(false);
    expect(store.invertsDocuments).toBe(false);
    expect(window.localStorage.getItem(INVERT_DOCUMENTS_STORAGE_KEY)).toBe(
      "false",
    );
    setActivePinia(createPinia());
    expect(useAppearanceStore().invertDocuments).toBe(false);

    const restored = useAppearanceStore();
    restored.setInvertDocuments(true);
    restored.setThemePreference("light");
    expect(restored.invertsDocuments).toBe(false);
  });
});

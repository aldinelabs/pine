import { isDesktopClient } from "@/lib/clientRuntime";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_PINE_COLOR_THEME,
  PROJECT_COLOR_THEMES,
  type ProjectColorTheme,
} from "@/shared/projects";
import { preferenceStorage } from "@/lib/preferenceStorage";
import { useUserProfileStore } from "@/stores/userProfile";

export const THEME_PREFERENCE_STORAGE_KEY = "pine.theme-preference";
export const PINE_COLOR_THEME_STORAGE_KEY = "pine.color-theme";
/** Set once the stored olive theme has been moved to neutral. */
export const PINE_COLOR_THEME_MIGRATED_STORAGE_KEY =
  "pine.color-theme-neutral-migrated";
export const SIDEBAR_VIBRANCY_STORAGE_KEY = "pine.sidebar-vibrancy";
/** Set once the 0.13.0 migration has turned native sidebar on for everyone. */
export const SIDEBAR_VIBRANCY_MIGRATED_STORAGE_KEY =
  "pine.sidebar-vibrancy-migrated-0.13";
export const SIDEBAR_VIBRANCY_CLASS = "sidebar-vibrancy";
export const READING_FONT_STORAGE_KEY = "pine.reading-font";
export const READING_FONT_CLASS = "reading-font";
/** Before 0.14.1 the reading font was a serif option kept under this key. */
const LEGACY_TRANSCRIPT_SERIF_STORAGE_KEY = "pine.transcript-serif";
export const INVERT_DOCUMENTS_STORAGE_KEY = "pine.invert-documents";

export type ColorScheme = "light" | "dark";
export type ThemePreference = "system" | ColorScheme;

export function isProjectColorTheme(
  value: string | null,
): value is ProjectColorTheme {
  return (
    typeof value === "string" &&
    PROJECT_COLOR_THEMES.includes(value as ProjectColorTheme)
  );
}

export function isThemePreference(
  value: string | null,
): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredThemePreference(): ThemePreference {
  try {
    const storedPreference = preferenceStorage.getItem(
      THEME_PREFERENCE_STORAGE_KEY,
    );
    return isThemePreference(storedPreference) ? storedPreference : "system";
  } catch {
    return "system";
  }
}

/**
 * Olive used to be labelled "Pine Default", so a stored olive meant "use the
 * default". Move it to neutral once; olive chosen afterwards is kept. The
 * marker is written even when nothing is stored, so a later olive pick by a
 * new user is not migrated either.
 */
function migratePineColorThemeOnce(): void {
  try {
    if (
      preferenceStorage.getItem(PINE_COLOR_THEME_MIGRATED_STORAGE_KEY) !== null
    ) {
      return;
    }
    if (preferenceStorage.getItem(PINE_COLOR_THEME_STORAGE_KEY) === "olive") {
      preferenceStorage.setItem(
        PINE_COLOR_THEME_STORAGE_KEY,
        DEFAULT_PINE_COLOR_THEME,
      );
    }
    preferenceStorage.setItem(PINE_COLOR_THEME_MIGRATED_STORAGE_KEY, "true");
  } catch {
    // Without storage the default (neutral) already applies.
  }
}

function readStoredPineColorTheme(): ProjectColorTheme {
  migratePineColorThemeOnce();
  try {
    const storedTheme = preferenceStorage.getItem(PINE_COLOR_THEME_STORAGE_KEY);
    return isProjectColorTheme(storedTheme)
      ? storedTheme
      : DEFAULT_PINE_COLOR_THEME;
  } catch {
    return DEFAULT_PINE_COLOR_THEME;
  }
}

/** On unless the user turned it off; overlays no longer blur it to black. */
function readStoredSidebarVibrancy(): boolean {
  try {
    return preferenceStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * 0.13.0 makes the native sidebar the default: users who had turned it off
 * are switched on once, and may turn it off again afterwards.
 */
function migrateSidebarVibrancyOnce(): void {
  try {
    if (
      preferenceStorage.getItem(SIDEBAR_VIBRANCY_MIGRATED_STORAGE_KEY) !== null
    ) {
      return;
    }
    preferenceStorage.setItem(SIDEBAR_VIBRANCY_STORAGE_KEY, "true");
    preferenceStorage.setItem(SIDEBAR_VIBRANCY_MIGRATED_STORAGE_KEY, "true");
  } catch {
    // Without storage the default (on) already applies.
  }
}

function readStoredReadingFont(): boolean {
  try {
    const stored =
      preferenceStorage.getItem(READING_FONT_STORAGE_KEY) ??
      preferenceStorage.getItem(LEGACY_TRANSCRIPT_SERIF_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/** Documents start inverted in dark mode unless the user turned it off. */
function readStoredInvertDocuments(): boolean {
  try {
    return preferenceStorage.getItem(INVERT_DOCUMENTS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function isMacOSPlatform(): boolean {
  return isDesktopClient() && window.pine?.platform === "darwin";
}

export const useAppearanceStore = defineStore("appearance", () => {
  const themePreference = ref<ThemePreference>(readStoredThemePreference());
  const pineColorTheme = ref<ProjectColorTheme>(readStoredPineColorTheme());
  const colorScheme = ref<ColorScheme>("light");
  const supportsSidebarVibrancy = ref(isMacOSPlatform());
  const sidebarVibrancy = ref(false);
  const readingFont = ref(readStoredReadingFont());
  const invertDocuments = ref(readStoredInvertDocuments());
  /** Whether previews that can invert their pages start inverted. */
  const invertsDocuments = computed(
    () => invertDocuments.value && colorScheme.value === "dark",
  );

  let isInitialized = false;
  let mediaQuery: MediaQueryList | null = null;

  function applyColorScheme(): void {
    const isDark =
      themePreference.value === "dark" ||
      (themePreference.value === "system" && mediaQuery?.matches === true);
    const nextColorScheme: ColorScheme = isDark ? "dark" : "light";

    colorScheme.value = nextColorScheme;
    void window.pine?.setThemeSource?.(themePreference.value);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = nextColorScheme;
  }

  function applySidebarVibrancy(): void {
    document.documentElement.classList.toggle(
      SIDEBAR_VIBRANCY_CLASS,
      sidebarVibrancy.value,
    );
    void window.pine?.setSidebarVibrancy({ enabled: sidebarVibrancy.value });
  }

  function applyReadingFont(): void {
    document.documentElement.classList.toggle(
      READING_FONT_CLASS,
      readingFont.value,
    );
  }

  function handleSystemColorSchemeChange(): void {
    if (themePreference.value === "system") applyColorScheme();
  }

  /**
   * The reading font belongs to Monet mode, which lives in the user profile.
   * The stored value only avoids a flash of the interface font while the
   * profile loads; once it is known the profile decides.
   */
  function followMonetMode(): void {
    if (typeof window.pine?.getUserProfile !== "function") return;
    const profileStore = useUserProfileStore();
    void profileStore
      .load()
      .then(() => setReadingFont(profileStore.profile.monetMode))
      .catch(() => {
        // Keep the stored value if the profile cannot be read.
      });
  }

  function initialize(): void {
    if (isInitialized) return;

    isInitialized = true;
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", handleSystemColorSchemeChange);
    applyColorScheme();
    applyReadingFont();
    followMonetMode();
    if (supportsSidebarVibrancy.value) {
      migrateSidebarVibrancyOnce();
      sidebarVibrancy.value = readStoredSidebarVibrancy();
      applySidebarVibrancy();
    }
  }

  function setThemePreference(preference: ThemePreference): void {
    themePreference.value = preference;
    applyColorScheme();

    try {
      preferenceStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
    } catch {
      // The selected theme still applies for this session if storage is unavailable.
    }
  }

  function setPineColorTheme(theme: ProjectColorTheme): void {
    pineColorTheme.value = theme;

    try {
      preferenceStorage.setItem(PINE_COLOR_THEME_STORAGE_KEY, theme);
    } catch {
      // The selected color theme still applies for this session if storage is unavailable.
    }
  }

  function setSidebarVibrancy(enabled: boolean): void {
    if (!supportsSidebarVibrancy.value) return;

    sidebarVibrancy.value = enabled;
    applySidebarVibrancy();

    try {
      preferenceStorage.setItem(
        SIDEBAR_VIBRANCY_STORAGE_KEY,
        enabled ? "true" : "false",
      );
    } catch {
      // The selected vibrancy state still applies for this session if storage
      // is unavailable.
    }
  }

  function setReadingFont(enabled: boolean): void {
    readingFont.value = enabled;
    applyReadingFont();

    try {
      preferenceStorage.setItem(
        READING_FONT_STORAGE_KEY,
        enabled ? "true" : "false",
      );
    } catch {
      // The selected font still applies for this session if storage is
      // unavailable.
    }
  }

  function setInvertDocuments(enabled: boolean): void {
    invertDocuments.value = enabled;

    try {
      preferenceStorage.setItem(
        INVERT_DOCUMENTS_STORAGE_KEY,
        enabled ? "true" : "false",
      );
    } catch {
      // The choice still applies for this session if storage is unavailable.
    }
  }

  return {
    colorScheme,
    invertDocuments,
    invertsDocuments,
    setInvertDocuments,
    initialize,
    pineColorTheme,
    setPineColorTheme,
    setThemePreference,
    sidebarVibrancy,
    setSidebarVibrancy,
    setReadingFont,
    supportsSidebarVibrancy,
    themePreference,
    readingFont,
  };
});

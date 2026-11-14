import { initializeWebClient } from "./client/webClient";
import { browserNeedsSignIn } from "./client/webSignIn";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import {
  APP_LOCALE_STORAGE_KEY,
  createAppI18n,
  resolveAppLocale,
} from "./app/i18n";
import { isWebClient } from "./lib/clientRuntime";
import { playCompletionSound } from "./lib/completionSound";
import { trackModalOverlays } from "./lib/modalOverlayState";
import { dismissSplash, holdSplash } from "./lib/splash";
import { syncThemeColor } from "./lib/themeColor";
import { createAppRouter } from "./router";
import { useAppearanceStore } from "./stores/appearance";
import { QUICK_COMPOSER_ROUTE_HASH } from "./shared/quickComposer";
import { useQuickComposerHandoffStore } from "./stores/quickComposerHandoff";
import { useUpdaterStore } from "./stores/updater";
import "./index.css";
import "vue-sonner/style.css";
import {
  adoptWebStoragePreferences,
  preferenceStorage,
} from "@/lib/preferenceStorage";

async function startRenderer(): Promise<void> {
  // The splash stays until the app has mounted and its views have loaded.
  const releaseSplash = holdSplash();
  adoptWebStoragePreferences();
  // A browser that is not signed in loads only the sign-in view; Pine's data
  // stays behind the password.
  const needsSignIn = !window.pine && (await browserNeedsSignIn());
  const browserClient = needsSignIn ? undefined : await initializeWebClient();
  let storedLocale: string | null = null;

  try {
    storedLocale = preferenceStorage.getItem(APP_LOCALE_STORAGE_KEY);
  } catch {
    // Fall back to the operating system language if storage is unavailable.
  }

  const locale = resolveAppLocale(navigator.languages, storedLocale);
  const pinia = createPinia();
  const i18n = createAppI18n(locale);
  window.pine?.setAppLocale?.(locale);

  document.documentElement.lang = locale;
  document.documentElement.dataset.platform = window.pine?.platform ?? "darwin";
  document.documentElement.dataset.client =
    needsSignIn || isWebClient() ? "web" : "desktop";
  // iOS Safari only applies :active on tap once the page listens for touches,
  // and touch screens never match hover, so taps would show no feedback.
  document.addEventListener("touchstart", () => undefined, { passive: true });
  // The floating composer window is transparent from its first frame, before
  // its view mounts.
  if (window.location.hash.startsWith(`#/${QUICK_COMPOSER_ROUTE_HASH}`)) {
    document.documentElement.dataset.quickComposer = "";
    dismissSplash();
  }
  useAppearanceStore(pinia).initialize();
  trackModalOverlays();
  if (document.documentElement.dataset.client === "web") syncThemeColor();
  if (needsSignIn) {
    const { default: WebSignInView } =
      await import("./components/web/WebSignInView.vue");
    createApp(WebSignInView, { onSignedIn: () => location.reload() })
      .use(pinia)
      .use(i18n)
      .mount("#app");
    releaseSplash();
    return;
  }
  const app = createApp(App);
  const router = createAppRouter(pinia);
  useUpdaterStore(pinia).initialize();
  useQuickComposerHandoffStore(pinia).initialize();
  window.pine?.onCompletionSound?.(playCompletionSound);

  app.use(pinia);
  app.use(i18n);
  app.use(router);
  await router.isReady();
  app.mount("#app");
  releaseSplash();
  browserClient?.connect();
}
void startRenderer().catch((error: unknown) => {
  dismissSplash();
  const root = document.getElementById("app");
  if (root)
    root.textContent = error instanceof Error ? error.message : String(error);
});

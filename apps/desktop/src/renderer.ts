import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import {
  APP_LOCALE_STORAGE_KEY,
  createAppI18n,
  resolveAppLocale,
} from "./app/i18n";
import { playCompletionSound } from "./lib/completionSound";
import { createAppRouter } from "./router";
import { useAppearanceStore } from "./stores/appearance";
import { QUICK_COMPOSER_ROUTE_HASH } from "./shared/quickComposer";
import { useQuickComposerHandoffStore } from "./stores/quickComposerHandoff";
import { useUpdaterStore } from "./stores/updater";
import "./index.css";
import "vue-sonner/style.css";

let storedLocale: string | null = null;

try {
  storedLocale = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY);
} catch {
  // Fall back to the operating system language if storage is unavailable.
}

const locale = resolveAppLocale(navigator.languages, storedLocale);
const app = createApp(App);
const pinia = createPinia();
const i18n = createAppI18n(locale);
const router = createAppRouter(pinia);

document.documentElement.lang = locale;
document.documentElement.dataset.platform = window.pine?.platform ?? "darwin";
// The floating composer window is transparent from its first frame, before
// its view mounts.
if (window.location.hash.startsWith(`#/${QUICK_COMPOSER_ROUTE_HASH}`))
  document.documentElement.dataset.quickComposer = "";
useAppearanceStore(pinia).initialize();
useUpdaterStore(pinia).initialize();
useQuickComposerHandoffStore(pinia).initialize();
window.pine?.onCompletionSound?.(playCompletionSound);

app.use(pinia);
app.use(i18n);
app.use(router);
app.mount("#app");

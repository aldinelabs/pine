<script setup lang="ts">
import { storeToRefs } from "pinia";
import { provide, shallowRef, watch, watchEffect } from "vue";
import { RouterView } from "vue-router";
import { formatWindowTitle } from "@/app/windowTitle";
import { Toaster } from "@/components/ui/sonner";
import { syncWindowBackground } from "@/lib/windowBackground";
import {
  WINDOW_TAB_CLOSE_HANDLER_KEY,
  type WindowTabCloseHandler,
  useWindowTabShortcuts,
} from "@/composables/useWindowTabShortcuts";
import { useAppearanceStore } from "@/stores/appearance";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { useSessionStore } from "@/stores/session";
import { useProjectStore } from "@/stores/project";

const closeTabHandler = shallowRef<WindowTabCloseHandler | null>(null);
provide(WINDOW_TAB_CLOSE_HANDLER_KEY, closeTabHandler);
useWindowTabShortcuts();

const appearanceStore = useAppearanceStore();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const { colorScheme, pineColorTheme } = storeToRefs(appearanceStore);
const { activeSession } = storeToRefs(sessionStore);
const { activeProject } = storeToRefs(projectStore);
const displayName = useProjectDisplayName();

// The title and accent colour follow the active tab's project.
watchEffect(() => {
  document.title = formatWindowTitle({
    sessionName: activeSession.value?.name,
    projectName: displayName(activeProject.value) || undefined,
  });
});

watch(
  () =>
    [
      activeProject.value?.projectColorTheme,
      pineColorTheme.value,
      colorScheme.value,
    ] as const,
  ([projectColorTheme, defaultColorTheme]) => {
    const root = document.documentElement;
    const effectiveColorTheme =
      projectColorTheme && projectColorTheme !== "olive"
        ? projectColorTheme
        : defaultColorTheme;

    // index.css rotates the theme tokens from this attribute alone.
    root.dataset.projectColorTheme = effectiveColorTheme;
    syncWindowBackground(root);
  },
  { immediate: true },
);
</script>

<template>
  <main id="pine-root" class="h-full overflow-x-clip">
    <RouterView />
    <Toaster :theme="colorScheme" />
  </main>
</template>

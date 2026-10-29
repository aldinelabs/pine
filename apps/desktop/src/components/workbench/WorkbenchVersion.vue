<script setup lang="ts">
import { GitCommitHorizontal } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { PINE_RELEASES_URL } from "@/shared/window";

/**
 * Pine's version in the workbench title bar; it opens the release notes.
 * The trailing title bar controls slide across it for 500ms as the workbench
 * toggles, so it fades in once they have passed and is gone before they
 * reach it on the way back.
 */
const { t } = useI18n();
// A failed version lookup simply hides the version.
const pineVersion = ref<string | null>(null);
onMounted(() => {
  window.pine
    .getAppVersion()
    .then((version) => {
      pineVersion.value = version;
    })
    .catch(() => undefined);
});

function openReleases(): void {
  void window.pine.openExternalUrl(PINE_RELEASES_URL);
}
</script>

<template>
  <Button
    v-if="pineVersion"
    data-testid="pine-version"
    variant="ghost"
    size="sm"
    class="window-no-drag h-8 text-muted-foreground transition-opacity delay-500 duration-200 ease-out group-data-[state=collapsed]:opacity-0 group-data-[state=collapsed]:delay-0 group-data-[state=collapsed]:duration-100 motion-reduce:transition-none"
    @click="openReleases"
  >
    <GitCommitHorizontal aria-hidden="true" />
    <span>{{ t("project.version", { version: pineVersion }) }}</span>
  </Button>
</template>

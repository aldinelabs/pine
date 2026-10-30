<script setup lang="ts">
import { GitCommitHorizontal, Info } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { PINE_RELEASES_URL } from "@/shared/window";
import { useUpdaterStore } from "@/stores/updater";

/**
 * Pine's version in the workbench title bar; it opens the release notes.
 * While an update is available it says so instead and opens the update.
 * The trailing title bar controls slide across it for 500ms as the workbench
 * toggles, so it fades in once they have passed and is gone before they
 * reach it on the way back.
 */
const { t } = useI18n();
const updater = useUpdaterStore();
const { isAvailable } = storeToRefs(updater);
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

function onClick(): void {
  if (isAvailable.value) {
    updater.isDialogOpen = true;
    return;
  }
  void window.pine.openExternalUrl(PINE_RELEASES_URL);
}
</script>

<template>
  <Button
    v-if="pineVersion || isAvailable"
    data-testid="pine-version"
    variant="ghost"
    size="sm"
    :class="isAvailable ? 'text-info hover:text-info' : 'text-muted-foreground'"
    class="window-no-drag h-8 transition-opacity delay-500 duration-200 ease-out group-data-[state=collapsed]:opacity-0 group-data-[state=collapsed]:delay-0 group-data-[state=collapsed]:duration-100 motion-reduce:transition-none"
    @click="onClick"
  >
    <template v-if="isAvailable">
      <Info aria-hidden="true" />
      <span>{{ t("updater.available") }}</span>
    </template>
    <template v-else>
      <GitCommitHorizontal aria-hidden="true" />
      <span>{{ t("project.version", { version: pineVersion }) }}</span>
    </template>
  </Button>
</template>

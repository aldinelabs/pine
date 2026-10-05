<script setup lang="ts">
import { Download, RefreshCw } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { updateChangelogFor } from "@/shared/updates";
import { useUpdaterStore } from "@/stores/updater";

const open = defineModel<boolean>("open", { default: false });
const { locale, t } = useI18n();
const updater = useUpdaterStore();
const { error, phase, progress, update } = storeToRefs(updater);
const isBusy = computed(
  () => phase.value === "downloading" || phase.value === "installing",
);

const changelog = computed(() =>
  update.value ? updateChangelogFor(update.value, locale.value) : "",
);

function handleOpenChanged(value: boolean): void {
  if (!value && isBusy.value) return;
  open.value = value;
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChanged">
    <DialogContent class="sm:max-w-xl" :show-close-button="!isBusy">
      <DialogHeader>
        <DialogTitle>{{ t("updater.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("updater.description", { version: update?.version }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="max-h-72 overflow-y-auto rounded-xl bg-muted/50 p-4">
        <MarkdownContent :source="changelog" final />
      </div>

      <div v-if="phase === 'downloading'" class="flex flex-col gap-2">
        <div class="flex items-center justify-between text-sm">
          <span>{{ t("updater.downloading") }}</span>
          <span class="text-muted-foreground">{{ Math.round(progress) }}%</span>
        </div>
        <Progress :model-value="progress" />
      </div>

      <p v-if="phase === 'ready'" class="text-sm text-muted-foreground">
        {{ t("updater.ready") }}
      </p>
      <p v-if="phase === 'error'" class="text-sm text-destructive">
        {{ t("updater.failed") }} {{ error }}
      </p>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isBusy"
          @click="handleOpenChanged(false)"
        >
          {{ t("updater.later") }}
        </Button>
        <Button
          v-if="phase === 'available' || phase === 'error'"
          :disabled="isBusy"
          @click="updater.download"
        >
          <Download data-icon="inline-start" />
          {{ t("updater.download") }}
        </Button>
        <Button v-else-if="phase === 'ready'" @click="updater.install">
          <RefreshCw data-icon="inline-start" />
          {{ t("updater.restart") }}
        </Button>
        <Button
          v-else-if="phase === 'downloading' || phase === 'installing'"
          disabled
        >
          <Spinner data-icon="inline-start" />
          {{
            phase === "installing"
              ? t("updater.installing")
              : t("updater.downloading")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

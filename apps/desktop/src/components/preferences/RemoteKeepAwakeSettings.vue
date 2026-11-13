<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_REMOTE_KEEP_AWAKE_STATUS,
  type RemoteKeepAwakeStatus,
} from "@/shared/remoteKeepAwake";

const { t } = useI18n();
const status = ref<RemoteKeepAwakeStatus>({
  ...DEFAULT_REMOTE_KEEP_AWAKE_STATUS,
});
const isLoading = ref(true);
const isSaving = ref(false);
let stopListening: (() => void) | undefined;

onMounted(async () => {
  stopListening = window.pine.onRemoteKeepAwakeChanged?.((next) => {
    status.value = next;
  });
  try {
    status.value = await window.pine.getRemoteKeepAwake!();
  } catch (error) {
    handleError(error, {
      id: "preferences.remoteKeepAwake.load",
      title: t("errors.remoteKeepAwake.loadTitle"),
      description: t("errors.remoteKeepAwake.description"),
    });
  } finally {
    isLoading.value = false;
  }
});

onBeforeUnmount(() => {
  stopListening?.();
});

async function update(enabled: boolean): Promise<void> {
  if (enabled === status.value.enabled || isSaving.value) return;
  isSaving.value = true;
  try {
    status.value = await window.pine.setRemoteKeepAwake!(enabled);
  } catch (error) {
    handleError(error, {
      id: "preferences.remoteKeepAwake.save",
      title: t("errors.remoteKeepAwake.saveTitle"),
      description: t("errors.remoteKeepAwake.description"),
    });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Field orientation="horizontal" data-testid="remote-keep-awake-settings">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <FieldTitle id="pine-remote-keep-awake">
        {{ t("preferences.remoteKeepAwake.title") }}
      </FieldTitle>
      <FieldDescription>
        {{ t("preferences.remoteKeepAwake.description") }}
      </FieldDescription>
      <FieldDescription
        v-if="status.enabled && !status.remoteOn"
        data-testid="pine-remote-keep-awake-idle"
      >
        {{ t("preferences.remoteKeepAwake.idle") }}
      </FieldDescription>
    </div>
    <Switch
      data-testid="pine-remote-keep-awake"
      :model-value="status.enabled"
      :disabled="isLoading || isSaving"
      aria-labelledby="pine-remote-keep-awake"
      @update:model-value="(value: boolean) => void update(value)"
    />
  </Field>
</template>

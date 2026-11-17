<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_MEMORY_ENABLED } from "@/shared/memory";

/**
 * Whether Pine brings its notes into sessions and may save new ones. Off,
 * the agent sees neither the notes nor the memory tools; the notes stay and
 * can still be managed from the sidebar's More › Memory.
 */
const { t } = useI18n();
const enabled = ref(DEFAULT_MEMORY_ENABLED);
const isLoading = ref(true);
const isSaving = ref(false);

onMounted(async () => {
  try {
    enabled.value = await window.pine.getMemoryEnabled();
  } catch (error) {
    handleError(error, {
      id: "preferences.memory.load-enabled",
      title: t("preferences.memory.loadFailed"),
    });
  } finally {
    isLoading.value = false;
  }
});

async function update(next: boolean): Promise<void> {
  if (isLoading.value || isSaving.value || next === enabled.value) return;
  const previous = enabled.value;
  enabled.value = next;
  isSaving.value = true;
  try {
    enabled.value = (
      await window.pine.setMemoryEnabled({ enabled: next })
    ).enabled;
  } catch (error) {
    enabled.value = previous;
    handleError(error, {
      id: "preferences.memory.save-enabled",
      title: t("preferences.memory.saveFailed"),
    });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Field orientation="horizontal">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <FieldTitle id="pine-memory-setting">
        {{ t("preferences.memory.title") }}
      </FieldTitle>
      <FieldDescription id="pine-memory-enabled-description">
        {{ t("preferences.memory.description") }}
      </FieldDescription>
    </div>
    <Switch
      data-testid="pine-memory-toggle"
      :model-value="enabled"
      :disabled="isLoading || isSaving"
      aria-labelledby="pine-memory-setting"
      aria-describedby="pine-memory-enabled-description"
      @update:model-value="(value: boolean) => void update(value)"
    />
  </Field>
</template>

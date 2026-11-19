<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_COMPUTER_USE_ENABLED } from "@/shared/computerUse";

/**
 * Whether the agent may use Computer Use. Off, the activation tool and every
 * desktop and browser tool it enables are left out of the agent's tool list
 * and system prompt; new runs pick the change up without a restart.
 */
const { t } = useI18n();
const enabled = ref(DEFAULT_COMPUTER_USE_ENABLED);
const isLoading = ref(true);
const isSaving = ref(false);

onMounted(async () => {
  try {
    enabled.value = await window.pine.getComputerUseEnabled();
  } catch (error) {
    handleError(error, {
      id: "preferences.computer-use.load-enabled",
      title: t("preferences.computerUse.loadFailed"),
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
      await window.pine.setComputerUseEnabled({ enabled: next })
    ).enabled;
  } catch (error) {
    enabled.value = previous;
    handleError(error, {
      id: "preferences.computer-use.save-enabled",
      title: t("preferences.computerUse.saveFailed"),
    });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Field orientation="horizontal">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <FieldTitle id="pine-computer-use-setting">
        {{ t("preferences.computerUse.title") }}
      </FieldTitle>
      <FieldDescription id="pine-computer-use-enabled-description">
        {{ t("preferences.computerUse.description") }}
      </FieldDescription>
    </div>
    <Switch
      data-testid="pine-computer-use-toggle"
      :model-value="enabled"
      :disabled="isLoading || isSaving"
      aria-labelledby="pine-computer-use-setting"
      aria-describedby="pine-computer-use-enabled-description"
      @update:model-value="(value: boolean) => void update(value)"
    />
  </Field>
</template>

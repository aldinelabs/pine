<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { useAutoApprovalStore } from "@/stores/autoApproval";
import { useModelsStore } from "@/stores/models";

const { t } = useI18n();
const store = useAutoApprovalStore();
const modelsStore = useModelsStore();
const isModelPickerOpen = ref(false);
const loadFailed = ref(false);
const disabled = computed(
  () =>
    store.settings.strategy !== "decisions" ||
    store.isLoading ||
    store.isSaving ||
    loadFailed.value,
);
const openRouterConfigured = computed(() =>
  modelsStore.providers.some(
    (provider) => provider.id === "openrouter" && provider.configured,
  ),
);
const modelSummary = computed(() =>
  openRouterConfigured.value
    ? (modelsStore.decisionsModels.find(
        (model) => model.id === store.settings.decisionsModel,
      )?.name ?? store.settings.decisionsModel)
    : t("preferences.decisionsCredentialMissing"),
);

onMounted(async () => {
  try {
    await store.load();
  } catch (error) {
    loadFailed.value = true;
    handleError(error, {
      id: "auto-approval-settings",
      title: t("errors.autoApprovalSettings.title"),
      description: t("errors.autoApprovalSettings.description"),
    });
  }
});
</script>

<template>
  <Field orientation="horizontal" :data-disabled="disabled">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <FieldTitle id="pine-decisions-model-label">{{
        t("preferences.decisionsModel")
      }}</FieldTitle>
      <FieldDescription>{{ modelSummary }}</FieldDescription>
    </div>
    <Button
      data-testid="pine-decisions-model-button"
      variant="outline"
      size="sm"
      :disabled="disabled"
      aria-labelledby="pine-decisions-model-label"
      @click="isModelPickerOpen = true"
    >
      {{ t("preferences.selectDecisionsModel") }}
    </Button>
  </Field>
  <ModelPickerDialog v-model:open="isModelPickerOpen" purpose="decisions" />
</template>

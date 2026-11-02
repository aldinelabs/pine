<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import HelpHint from "./HelpHint.vue";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  isPineAutoApprovalSettings,
  type PineAutoApprovalSettings,
} from "@/shared/preferences";
import { useAutoApprovalStore } from "@/stores/autoApproval";

const { t } = useI18n();
const store = useAutoApprovalStore();
const loadFailed = ref(false);
const disabled = computed(
  () => store.isLoading || store.isSaving || loadFailed.value,
);

onMounted(async () => {
  try {
    await store.load();
  } catch (error) {
    loadFailed.value = true;
    reportError(error);
  }
});

function reportError(error: unknown): void {
  handleError(error, {
    id: "auto-approval-settings",
    title: t("errors.autoApprovalSettings.title"),
    description: t("errors.autoApprovalSettings.description"),
  });
}

async function save(patch: Partial<PineAutoApprovalSettings>): Promise<void> {
  const settings = { ...store.settings, ...patch };
  if (!isPineAutoApprovalSettings(settings) || disabled.value) return;
  if (settings.strategy === store.settings.strategy) return;
  try {
    await store.save(settings);
  } catch (error) {
    reportError(error);
  }
}

function updateStrategy(value: unknown): void {
  if (value === "model" || value === "decisions")
    void save({ strategy: value });
}
</script>

<template>
  <FieldGroup data-testid="pine-auto-approval-settings">
    <Field orientation="responsive" :data-disabled="disabled">
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <FieldTitle id="pine-auto-approval-strategy-label">{{
          t("preferences.autoApprovalStrategy")
        }}</FieldTitle>
        <HelpHint :label="t('preferences.autoApprovalHelp')">
          {{
            t(
              store.settings.strategy === "decisions"
                ? "preferences.autoApprovalDecisionsDescription"
                : "preferences.autoApprovalModelDescription",
            )
          }}
        </HelpHint>
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :disabled="disabled"
        :model-value="store.settings.strategy"
        aria-labelledby="pine-auto-approval-strategy-label"
        @update:model-value="updateStrategy"
      >
        <ToggleGroupItem value="model">{{
          t("preferences.autoApprovalModel")
        }}</ToggleGroupItem>
        <ToggleGroupItem value="decisions">{{
          t("preferences.autoApprovalDecisions")
        }}</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  </FieldGroup>
</template>

<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isPineAutoApprovalSettings,
  type PineAutoApprovalSettings,
} from "@/shared/preferences";
import { useAutoApprovalStore } from "@/stores/autoApproval";
import { useModelsStore } from "@/stores/models";

const { t } = useI18n();
const store = useAutoApprovalStore();
const modelsStore = useModelsStore();
const isModelPickerOpen = ref(false);
const loadFailed = ref(false);
const disabled = computed(
  () => store.isLoading || store.isSaving || loadFailed.value,
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
    <Field orientation="horizontal" :data-disabled="disabled">
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <FieldTitle id="pine-auto-approval-strategy-label">{{
          t("preferences.autoApprovalStrategy")
        }}</FieldTitle>
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                as="button"
                type="button"
                variant="secondary"
                class="size-5 translate-y-px p-0"
                :aria-label="t('preferences.autoApprovalHelp')"
              >
                <CircleHelpIcon aria-hidden="true" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" :side-offset="4">
              {{
                t(
                  store.settings.strategy === "decisions"
                    ? "preferences.autoApprovalDecisionsDescription"
                    : "preferences.autoApprovalModelDescription",
                )
              }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
    <template v-if="store.settings.strategy === 'decisions'">
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
    </template>
    <ModelPickerDialog v-model:open="isModelPickerOpen" purpose="decisions" />
  </FieldGroup>
</template>

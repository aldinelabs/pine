<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
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
  </FieldGroup>
</template>

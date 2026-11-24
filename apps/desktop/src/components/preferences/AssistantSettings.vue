<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import MemoryManagerDialog from "@/components/memory/MemoryManagerDialog.vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  ASSISTANT_APPROVAL_MODES,
  ASSISTANT_COST_REMINDER_OPTIONS,
  ASSISTANT_PROJECT_ID,
  type AssistantApprovalMode,
  type AssistantSettings,
} from "@/shared/assistant";
import type { PineThinkingLevel } from "@/shared/models";
import { useAssistantStore } from "@/stores/assistant";
import { pineModelKey, useModelsStore } from "@/stores/models";

/** Settings › Assistant: how Pine's Assistant runs, and its conversation. */
const { t } = useI18n();
const assistant = useAssistantStore();
const modelsStore = useModelsStore();
const loadFailed = ref(false);
const isClearOpen = ref(false);
const isMemoryOpen = ref(false);

/** The Select's value for "follow the default model". */
const DEFAULT_MODEL = "default";

const MODE_LABEL_KEYS: Record<AssistantApprovalMode, string> = {
  "let-me-review": "project.composer.approval.askForPermissionLabel",
  "auto-approve": "project.composer.approval.agentDecidesLabel",
  autonomous: "project.composer.approval.autonomousLabel",
};

const isBusy = computed(
  () => !assistant.isLoaded || assistant.isSaving || loadFailed.value,
);

/** Models of the providers the user has connected. */
const modelOptions = computed(() => {
  const configured = new Set(
    modelsStore.providers
      .filter((provider) => provider.configured)
      .map((provider) => provider.id),
  );
  return modelsStore.models.filter((model) => configured.has(model.providerId));
});
const chosenModel = computed(() => {
  const model = assistant.settings.model;
  return model
    ? modelOptions.value.find(
        (candidate) =>
          candidate.providerId === model.providerId &&
          candidate.id === model.modelId,
      )
    : undefined;
});
const modelValue = computed(() =>
  assistant.settings.model
    ? pineModelKey({
        id: assistant.settings.model.modelId,
        providerId: assistant.settings.model.providerId,
      })
    : DEFAULT_MODEL,
);
const thinkingLevels = computed(
  () => chosenModel.value?.supportedThinkingLevels ?? [],
);

onMounted(async () => {
  void modelsStore.load().catch(() => undefined);
  try {
    await assistant.load();
  } catch (error) {
    loadFailed.value = true;
    handleError(error, {
      id: "assistant-settings",
      title: t("errors.assistantSettings.title"),
      description: t("errors.assistantSettings.description"),
    });
  }
});

async function save(patch: Partial<AssistantSettings>): Promise<void> {
  const next: AssistantSettings = { ...assistant.settings, ...patch };
  if ("model" in patch && !patch.model) delete next.model;
  try {
    await assistant.saveSettings(next);
  } catch (error) {
    handleError(error, {
      id: "assistant-settings",
      title: t("errors.assistantSettings.title"),
      description: t("errors.assistantSettings.description"),
    });
  }
}

function updateModel(value: unknown): void {
  if (value === DEFAULT_MODEL) {
    void save({ model: undefined });
    return;
  }
  const model = modelOptions.value.find(
    (candidate) => pineModelKey(candidate) === value,
  );
  if (!model) return;
  const levels = model.supportedThinkingLevels;
  const current = assistant.settings.model?.thinkingLevel;
  const thinkingLevel: PineThinkingLevel =
    current && levels.includes(current)
      ? current
      : ((levels.includes("medium") ? "medium" : levels[0]) ?? "off");
  void save({
    model: { providerId: model.providerId, modelId: model.id, thinkingLevel },
  });
}

function updateThinkingLevel(value: unknown): void {
  const model = assistant.settings.model;
  if (!model || typeof value !== "string") return;
  void save({ model: { ...model, thinkingLevel: value as PineThinkingLevel } });
}

function updateApprovalMode(value: unknown): void {
  if (
    typeof value === "string" &&
    (ASSISTANT_APPROVAL_MODES as readonly string[]).includes(value)
  )
    void save({ approvalMode: value as AssistantApprovalMode });
}

/** "US$5" for a threshold, "Off" for 0. */
function costReminderLabel(usd: number): string {
  return usd === 0
    ? t("preferences.assistant.costReminderOff")
    : t("preferences.assistant.costReminderAmount", { amount: usd });
}

function updateCostReminder(value: unknown): void {
  const usd = Number(value);
  if ((ASSISTANT_COST_REMINDER_OPTIONS as readonly number[]).includes(usd))
    void save({ costReminderUsd: usd });
}

async function clear(): Promise<void> {
  try {
    const cleared = await assistant.clear();
    if (cleared) toast.success(t("preferences.assistant.cleared"));
  } catch (error) {
    handleError(error, {
      id: "assistant-clear",
      title: t("errors.assistantClear.title"),
      description: t("errors.assistantClear.description"),
    });
  }
}
</script>

<template>
  <FieldGroup data-testid="assistant-settings">
    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-assistant-model">
          {{ t("preferences.assistant.model") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.assistant.modelDescription") }}
        </FieldDescription>
      </div>
      <Skeleton v-if="!assistant.isLoaded" class="h-8 w-40 rounded-2xl" />
      <Select
        v-else
        :model-value="modelValue"
        :disabled="isBusy"
        @update:model-value="updateModel"
      >
        <SelectTrigger
          data-testid="pine-assistant-model"
          class="w-fit max-w-56"
          aria-labelledby="pine-assistant-model"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="DEFAULT_MODEL">
              {{ t("preferences.assistant.defaultModel") }}
            </SelectItem>
            <SelectItem
              v-if="assistant.settings.model && !chosenModel"
              :value="modelValue"
            >
              {{ assistant.settings.model.modelId }}
            </SelectItem>
            <SelectItem
              v-for="model in modelOptions"
              :key="pineModelKey(model)"
              :value="pineModelKey(model)"
            >
              {{ model.name }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>

    <Field v-if="thinkingLevels.length > 1" orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-assistant-thinking">
          {{ t("preferences.assistant.thinkingLevel") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.assistant.thinkingLevelDescription") }}
        </FieldDescription>
      </div>
      <Select
        :model-value="assistant.settings.model?.thinkingLevel"
        :disabled="isBusy"
        @update:model-value="updateThinkingLevel"
      >
        <SelectTrigger
          data-testid="pine-assistant-thinking"
          class="w-fit"
          aria-labelledby="pine-assistant-thinking"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem
              v-for="level in thinkingLevels"
              :key="level"
              :value="level"
            >
              {{ t(`models.thinkingLevels.${level}`) }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>

    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-assistant-mode">
          {{ t("preferences.assistant.approvalMode") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.assistant.approvalModeDescription") }}
        </FieldDescription>
      </div>
      <Skeleton v-if="!assistant.isLoaded" class="h-8 w-40 rounded-2xl" />
      <Select
        v-else
        :model-value="assistant.settings.approvalMode"
        :disabled="isBusy"
        @update:model-value="updateApprovalMode"
      >
        <SelectTrigger
          data-testid="pine-assistant-mode"
          class="w-fit"
          aria-labelledby="pine-assistant-mode"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem
              v-for="mode in ASSISTANT_APPROVAL_MODES"
              :key="mode"
              :value="mode"
            >
              {{ t(MODE_LABEL_KEYS[mode]) }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>

    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-assistant-wakes">
          {{ t("preferences.assistant.wakesOnReport") }}
        </FieldTitle>
        <FieldDescription id="pine-assistant-wakes-description">
          {{ t("preferences.assistant.wakesOnReportDescription") }}
        </FieldDescription>
      </div>
      <Skeleton v-if="!assistant.isLoaded" class="h-5 w-8 rounded-2xl" />
      <Switch
        v-else
        data-testid="pine-assistant-wakes"
        :model-value="assistant.settings.wakesOnReport"
        :disabled="isBusy"
        aria-labelledby="pine-assistant-wakes"
        aria-describedby="pine-assistant-wakes-description"
        @update:model-value="
          (value: boolean) => void save({ wakesOnReport: value })
        "
      />
    </Field>

    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-assistant-cost">
          {{ t("preferences.assistant.costReminder") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.assistant.costReminderDescription") }}
        </FieldDescription>
      </div>
      <Skeleton v-if="!assistant.isLoaded" class="h-8 w-28 rounded-2xl" />
      <Select
        v-else
        :model-value="String(assistant.settings.costReminderUsd)"
        :disabled="isBusy"
        @update:model-value="updateCostReminder"
      >
        <SelectTrigger
          data-testid="pine-assistant-cost"
          class="w-fit"
          aria-labelledby="pine-assistant-cost"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem
              v-for="usd in ASSISTANT_COST_REMINDER_OPTIONS"
              :key="usd"
              :value="String(usd)"
            >
              {{ costReminderLabel(usd) }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>

    <FieldSeparator />

    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle>{{ t("preferences.assistant.memory") }}</FieldTitle>
        <FieldDescription>
          {{ t("preferences.assistant.memoryDescription") }}
        </FieldDescription>
      </div>
      <Button
        data-testid="pine-assistant-memory"
        variant="outline"
        size="sm"
        @click="isMemoryOpen = true"
      >
        {{ t("preferences.assistant.openMemory") }}
      </Button>
    </Field>

    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle>{{ t("preferences.assistant.clear") }}</FieldTitle>
        <FieldDescription>
          {{ t("preferences.assistant.clearDescription") }}
        </FieldDescription>
      </div>
      <Button
        data-testid="pine-assistant-clear"
        variant="outline"
        size="sm"
        :disabled="isBusy || !assistant.session"
        @click="isClearOpen = true"
      >
        {{ t("preferences.assistant.clearAction") }}
      </Button>
    </Field>
  </FieldGroup>

  <MemoryManagerDialog
    v-model:open="isMemoryOpen"
    :project-id="ASSISTANT_PROJECT_ID"
  />
  <AlertDialog v-model:open="isClearOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("preferences.assistant.clearConfirmTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("preferences.assistant.clearConfirmDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          data-testid="pine-assistant-clear-confirm"
          variant="destructive"
          @click="clear"
        >
          {{ t("preferences.assistant.clearAction") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

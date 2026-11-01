<script setup lang="ts">
import { SparklesIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  AddCustomModelRequest,
  PineCustomModelApi,
  PineModelDescriptor,
  PineThinkingLevel,
} from "@/shared/models";
import { useModelsStore } from "@/stores/models";

const props = withDefaults(
  defineProps<{
    model?: PineModelDescriptor | null;
  }>(),
  { model: null },
);
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const modelsStore = useModelsStore();
const { providers } = storeToRefs(modelsStore);
const isSaving = ref(false);
const isLookingUpMetadata = ref(false);
const hasAttemptedSave = ref(false);
const providerMode = ref<"existing" | "new">("new");
const existingProviderId = ref("");
const thinkingLevelOptions = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly PineThinkingLevel[];

interface CustomModelDraft {
  api: PineCustomModelApi;
  apiKey: string;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  thinkingLevels: PineThinkingLevel[];
  vision: boolean;
}

const draft = reactive<CustomModelDraft>({
  api: "openai-completions",
  apiKey: "",
  baseUrl: "",
  contextWindow: 128_000,
  maxTokens: 16_384,
  modelId: "",
  modelName: "",
  providerId: "",
  providerName: "",
  thinkingLevels: ["off", "low", "high", "max"],
  vision: false,
});

const selectedProviderId = computed(() =>
  providerMode.value === "existing"
    ? existingProviderId.value
    : draft.providerId,
);
const isEditing = computed(() => props.model !== null);

const providerIdInvalid = computed(
  () =>
    providerMode.value === "new" &&
    !/^[a-z0-9][a-z0-9._-]*$/.test(draft.providerId.trim()),
);

const isValid = computed(() => {
  let validUrl = false;
  try {
    validUrl = ["http:", "https:"].includes(new URL(draft.baseUrl).protocol);
  } catch {
    validUrl = false;
  }
  return (
    (providerMode.value === "existing"
      ? existingProviderId.value.length > 0
      : !providerIdInvalid.value &&
        draft.providerName.trim().length > 0 &&
        draft.apiKey.trim().length > 0 &&
        validUrl) &&
    draft.modelId.trim().length > 0 &&
    draft.thinkingLevels.length > 0 &&
    Number.isInteger(draft.contextWindow) &&
    draft.contextWindow > 0 &&
    Number.isInteger(draft.maxTokens) &&
    draft.maxTokens > 0
  );
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  const model = props.model;
  Object.assign(draft, {
    api: "openai-completions",
    apiKey: "",
    baseUrl: "",
    contextWindow: 128_000,
    maxTokens: 16_384,
    modelId: model?.id ?? "",
    modelName: model?.name ?? "",
    providerId: "",
    providerName: "",
    thinkingLevels: model
      ? [...model.supportedThinkingLevels]
      : ["off", "low", "high", "max"],
    vision: model?.input.includes("image") ?? false,
  });
  providerMode.value = model ? "existing" : "new";
  existingProviderId.value = model?.providerId ?? "";
  if (model) {
    draft.contextWindow = model.contextWindow;
    draft.maxTokens = model.maxTokens;
  }
  hasAttemptedSave.value = false;
});

function updateApi(value: unknown): void {
  if (
    value === "anthropic-messages" ||
    value === "google-generative-ai" ||
    value === "openai-completions" ||
    value === "openai-responses"
  ) {
    draft.api = value satisfies PineCustomModelApi;
  }
}

function updateProviderMode(value: unknown): void {
  if (value === "existing" || value === "new") providerMode.value = value;
}

function updateExistingProvider(value: unknown): void {
  if (typeof value === "string") existingProviderId.value = value;
}

function updateThinkingLevels(value: unknown): void {
  if (!Array.isArray(value)) return;
  const levels = value.filter(
    (level): level is PineThinkingLevel =>
      level === "off" ||
      level === "minimal" ||
      level === "low" ||
      level === "medium" ||
      level === "high" ||
      level === "xhigh" ||
      level === "max",
  );
  draft.thinkingLevels = [...new Set(levels)];
}

async function lookupMetadata(): Promise<void> {
  const modelId = draft.modelId.trim();
  if (!modelId || isLookingUpMetadata.value) return;
  isLookingUpMetadata.value = true;
  try {
    const metadata = await window.pine.lookupModelMetadata({
      modelId,
      ...(selectedProviderId.value
        ? { providerId: selectedProviderId.value }
        : {}),
    });
    draft.modelName = metadata.modelName;
    if (metadata.contextWindow) draft.contextWindow = metadata.contextWindow;
    if (metadata.maxTokens) draft.maxTokens = metadata.maxTokens;
    draft.thinkingLevels = [...metadata.thinkingLevels];
    draft.vision = metadata.vision;
  } catch (error) {
    handleError(error, {
      id: "models.lookup-metadata",
      title: t("errors.modelMetadata.title"),
      description: t("errors.modelMetadata.description"),
    });
  } finally {
    isLookingUpMetadata.value = false;
  }
}

async function save(): Promise<void> {
  hasAttemptedSave.value = true;
  if (!isValid.value || isSaving.value) return;
  isSaving.value = true;
  try {
    const model = {
      contextWindow: draft.contextWindow,
      maxTokens: draft.maxTokens,
      modelId: draft.modelId.trim(),
      ...(draft.modelName?.trim()
        ? { modelName: draft.modelName.trim() }
        : { modelName: undefined }),
      thinkingLevels: [...draft.thinkingLevels],
      vision: draft.vision,
    };
    if (isEditing.value && props.model) {
      await modelsStore.updateCustomModel({
        ...model,
        originalModelId: props.model.id,
        providerId: props.model.providerId,
      });
    } else {
      const request: AddCustomModelRequest =
        providerMode.value === "existing"
          ? {
              ...model,
              providerId: existingProviderId.value,
              providerMode: "existing",
            }
          : {
              ...model,
              api: draft.api,
              apiKey: draft.apiKey.trim(),
              baseUrl: draft.baseUrl.trim(),
              providerId: draft.providerId.trim(),
              providerMode: "new",
              providerName: draft.providerName.trim(),
            };
      await modelsStore.addCustomModel(request);
    }
    emit("saved");
  } catch (error) {
    handleError(error, {
      id: "models.add-custom",
      title: t("errors.customModel.title"),
      description: t("errors.customModel.description"),
    });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="custom-model-dialog"
      :class="[
        'h-[min(85vh,52rem)] max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <form class="flex h-full min-h-0 flex-col gap-6" @submit.prevent="save">
        <DialogHeader class="px-6 pt-6 pr-16">
          <DialogTitle>
            {{
              t(isEditing ? "models.custom.editTitle" : "models.custom.title")
            }}
          </DialogTitle>
          <DialogDescription>
            {{
              t(
                isEditing
                  ? "models.custom.editDescription"
                  : "models.custom.description",
              )
            }}
          </DialogDescription>
        </DialogHeader>

        <div class="scroll-fade min-h-0 flex-1 overflow-y-auto px-6">
          <FieldGroup class="gap-5 pb-1">
            <Field v-if="!isEditing">
              <FieldLabel id="custom-provider-mode-label">
                {{ t("models.custom.providerMode") }}
              </FieldLabel>
              <Tabs
                :model-value="providerMode"
                aria-labelledby="custom-provider-mode-label"
                @update:model-value="updateProviderMode"
              >
                <TabsList class="w-full">
                  <TabsTrigger value="new">
                    {{ t("models.custom.newProvider") }}
                  </TabsTrigger>
                  <TabsTrigger value="existing">
                    {{ t("models.custom.existingProvider") }}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </Field>

            <Field v-if="isEditing">
              <FieldLabel>{{ t("models.custom.provider") }}</FieldLabel>
              <Input
                :model-value="
                  providers.find(
                    (provider) => provider.id === existingProviderId,
                  )?.name ?? existingProviderId
                "
                disabled
              />
              <FieldDescription>
                {{ t("models.custom.editProviderDescription") }}
              </FieldDescription>
            </Field>

            <Field v-else-if="providerMode === 'existing'">
              <FieldLabel>{{ t("models.custom.provider") }}</FieldLabel>
              <Select
                :model-value="existingProviderId"
                @update:model-value="updateExistingProvider"
              >
                <SelectTrigger class="w-full">
                  <SelectValue
                    :placeholder="t('models.custom.selectProvider')"
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="provider in providers"
                    :key="provider.id"
                    :value="provider.id"
                  >
                    {{ provider.name }} ({{ provider.id }})
                  </SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                {{ t("models.custom.existingProviderDescription") }}
              </FieldDescription>
            </Field>

            <template v-else>
              <div class="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel for="custom-provider-name">
                    {{ t("models.custom.providerName") }}
                  </FieldLabel>
                  <Input
                    id="custom-provider-name"
                    v-model="draft.providerName"
                    maxlength="200"
                    :placeholder="t('models.custom.providerNamePlaceholder')"
                  />
                </Field>
                <Field :data-invalid="hasAttemptedSave && providerIdInvalid">
                  <FieldLabel for="custom-provider-id">
                    {{ t("models.custom.providerId") }}
                  </FieldLabel>
                  <Input
                    id="custom-provider-id"
                    v-model="draft.providerId"
                    :aria-invalid="hasAttemptedSave && providerIdInvalid"
                    maxlength="200"
                    spellcheck="false"
                    placeholder="my-provider"
                  />
                  <FieldError v-if="hasAttemptedSave && providerIdInvalid">
                    {{ t("models.custom.providerIdInvalid") }}
                  </FieldError>
                </Field>
              </div>

              <Field>
                <FieldLabel for="custom-base-url">
                  {{ t("models.custom.baseUrl") }}
                </FieldLabel>
                <Input
                  id="custom-base-url"
                  v-model="draft.baseUrl"
                  type="url"
                  maxlength="2000"
                  spellcheck="false"
                  placeholder="http://localhost:11434/v1"
                />
              </Field>

              <Field>
                <FieldLabel>{{ t("models.custom.api") }}</FieldLabel>
                <Select
                  :model-value="draft.api"
                  @update:model-value="updateApi"
                >
                  <SelectTrigger class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-completions">
                      OpenAI Chat Completions
                    </SelectItem>
                    <SelectItem value="openai-responses">
                      OpenAI Responses
                    </SelectItem>
                    <SelectItem value="anthropic-messages">
                      Anthropic Messages
                    </SelectItem>
                    <SelectItem value="google-generative-ai">
                      Google Generative AI
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel for="custom-api-key">
                  {{ t("models.custom.apiKey") }}
                </FieldLabel>
                <Input
                  id="custom-api-key"
                  v-model="draft.apiKey"
                  type="password"
                  maxlength="100000"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="t('models.custom.apiKeyPlaceholder')"
                />
                <FieldDescription>
                  {{ t("models.custom.apiKeyDescription") }}
                </FieldDescription>
              </Field>
            </template>

            <div class="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel for="custom-model-name">
                  {{ t("models.custom.modelName") }}
                </FieldLabel>
                <Input
                  id="custom-model-name"
                  v-model="draft.modelName"
                  maxlength="200"
                  :placeholder="t('models.custom.modelNamePlaceholder')"
                />
              </Field>
              <Field>
                <FieldLabel for="custom-model-id">
                  {{ t("models.custom.modelId") }}
                </FieldLabel>
                <Input
                  id="custom-model-id"
                  v-model="draft.modelId"
                  maxlength="500"
                  spellcheck="false"
                  placeholder="llama3.1:8b"
                />
              </Field>
            </div>

            <div class="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel for="custom-context-window">
                  {{ t("models.custom.contextWindow") }}
                </FieldLabel>
                <Input
                  id="custom-context-window"
                  v-model.number="draft.contextWindow"
                  type="number"
                  min="1"
                  max="10000000"
                />
              </Field>
              <Field>
                <FieldLabel for="custom-max-tokens">
                  {{ t("models.custom.maxTokens") }}
                </FieldLabel>
                <Input
                  id="custom-max-tokens"
                  v-model.number="draft.maxTokens"
                  type="number"
                  min="1"
                  max="10000000"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel id="custom-thinking-levels-label">
                {{ t("models.custom.thinkingLevels") }}
              </FieldLabel>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                :spacing="2"
                class="flex-wrap"
                :model-value="draft.thinkingLevels"
                aria-labelledby="custom-thinking-levels-label"
                @update:model-value="updateThinkingLevels"
              >
                <ToggleGroupItem
                  v-for="level in thinkingLevelOptions"
                  :key="level"
                  :value="level"
                >
                  {{ t(`models.thinkingLevels.${level}`) }}
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {{ t("models.custom.thinkingLevelsDescription") }}
              </FieldDescription>
            </Field>

            <Field orientation="horizontal">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <FieldTitle id="custom-vision-label">
                  {{ t("models.custom.vision") }}
                </FieldTitle>
                <FieldDescription>
                  {{ t("models.custom.visionDescription") }}
                </FieldDescription>
              </div>
              <Switch
                v-model="draft.vision"
                aria-labelledby="custom-vision-label"
              />
            </Field>
          </FieldGroup>
        </div>

        <DialogFooter class="px-6 pb-6 sm:justify-between">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="inline-flex">
                <Button
                  type="button"
                  variant="secondary"
                  :disabled="!draft.modelId.trim() || isLookingUpMetadata"
                  @click="lookupMetadata"
                >
                  <Spinner
                    v-if="isLookingUpMetadata"
                    data-icon="inline-start"
                  />
                  <SparklesIcon v-else data-icon="inline-start" />
                  {{ t("models.custom.tryAutoFill") }}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent class="max-w-72">
              {{ t("models.custom.autoFillDescription") }}
            </TooltipContent>
          </Tooltip>

          <div class="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              :disabled="isSaving"
              @click="open = false"
            >
              {{ t("common.cancel") }}
            </Button>
            <Button type="submit" :disabled="isSaving">
              <Spinner v-if="isSaving" data-icon="inline-start" />
              {{
                isSaving
                  ? t("common.saving")
                  : t(
                      isEditing
                        ? "models.custom.editSave"
                        : "models.custom.save",
                    )
              }}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

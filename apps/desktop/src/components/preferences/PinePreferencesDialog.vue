<script setup lang="ts">
import { handleError } from "@/app/errors/errorHandler";
import {
  CircleHelpIcon,
  FolderKanbanIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserRoundIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import type { Component } from "vue";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { isAppLocale, persistAppLocale } from "@/app/i18n";
import AutoApprovalSettings from "./AutoApprovalSettings.vue";
import DecisionsModelSettings from "./DecisionsModelSettings.vue";
import ProjectManagementSettings from "./ProjectManagementSettings.vue";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModelsStore } from "@/stores/models";
import { useUserProfileStore } from "@/stores/userProfile";
import {
  isProjectColorTheme,
  isThemePreference,
  useAppearanceStore,
} from "@/stores/appearance";
import { PROJECT_COLOR_THEME_OPTIONS } from "@/lib/projectColorThemes";
import {
  DEFAULT_CONTEXT_COMPACTION_ROUTE,
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  isPineContextCompactionRoute,
  isPineContextCompactionStrategy,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
} from "@/shared/preferences";
import {
  createDefaultPineUserProfile,
  isPineCommunicationStyle,
  isPineTechnicalBackground,
  normalizePineUserProfile,
  type PineUserProfile,
} from "@/shared/userProfile";

type PreferenceSection = "general" | "models" | "personalization" | "projects";

const { locale, t } = useI18n();
const appearanceStore = useAppearanceStore();
const modelsStore = useModelsStore();
const userProfileStore = useUserProfileStore();
const { supportsSidebarVibrancy, themePreference, pineColorTheme } =
  storeToRefs(appearanceStore);
const { imageProviderConfigured, imageSelectedModel, utilitySelectedModel } =
  storeToRefs(modelsStore);
const isOpen = ref(false);
const activeSection = ref<PreferenceSection>("general");
// The section an `open` call asks for; plain opens start at General.
let requestedSection: PreferenceSection | null = null;
const isUtilityModelPickerOpen = ref(false);
const isImageModelPickerOpen = ref(false);
const isTinyFishCredentialDialogOpen = ref(false);
const isTinyFishCredentialConfigured = ref(false);
const tinyFishApiKey = ref("");
const isSavingTinyFishApiKey = ref(false);
const isRefreshingModelCatalog = ref(false);
const profileDraft = reactive<PineUserProfile>(createDefaultPineUserProfile());
const isHydratingProfile = ref(false);
const hasHydratedProfile = ref(false);
const contextCompactionStrategy = ref<PineContextCompactionStrategy>(
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
);
const isSavingContextCompactionStrategy = ref(false);
const contextCompactionRoute = ref<PineContextCompactionRoute>(
  DEFAULT_CONTEXT_COMPACTION_ROUTE,
);
const isSavingContextCompactionRoute = ref(false);
const completionSignalEnabled = ref(false);
const isLoadingCompletionSignal = ref(true);
const isSavingCompletionSignal = ref(false);
const diagnosticLoggingEnabled = ref(false);
const isLoadingDiagnosticLogging = ref(true);
const isSavingDiagnosticLogging = ref(false);
const selectedPineColorThemeOption = computed(() =>
  PROJECT_COLOR_THEME_OPTIONS.find(
    (option) => option.value === pineColorTheme.value,
  ),
);
const PROFILE_AUTOSAVE_DELAY_MS = 500;
let profileSaveTimer: ReturnType<typeof setTimeout> | undefined;
let profileSaveQueue: Promise<void> = Promise.resolve();
const canSaveTinyFishApiKey = computed(
  () => tinyFishApiKey.value.trim().length > 0 && !isSavingTinyFishApiKey.value,
);
const communicationStyleDescription = computed(() =>
  t(
    profileDraft.communicationStyle === "calm-professional"
      ? "preferences.userProfileStyleCalmDescription"
      : "preferences.userProfileStyleWarmDescription",
  ),
);
const technicalBackgroundDescription = computed(() =>
  t(
    profileDraft.technicalBackground === "general-user"
      ? "preferences.userProfileTechGeneralDescription"
      : profileDraft.technicalBackground === "enthusiast"
        ? "preferences.userProfileTechEnthusiastDescription"
        : "preferences.userProfileTechProfessionalDescription",
  ),
);
const isProfileDirty = computed(
  () =>
    !userProfilesEqual(
      normalizePineUserProfile(profileDraft),
      normalizePineUserProfile(userProfileStore.profile),
    ),
);

const sections = computed<
  { icon: Component; id: PreferenceSection; label: string }[]
>(() => [
  {
    icon: SlidersHorizontalIcon,
    id: "general",
    label: t("preferences.sections.general"),
  },
  {
    icon: SparklesIcon,
    id: "models",
    label: t("preferences.sections.models"),
  },
  {
    icon: UserRoundIcon,
    id: "personalization",
    label: t("preferences.sections.personalization"),
  },
  {
    icon: FolderKanbanIcon,
    id: "projects",
    label: t("preferences.sections.projects"),
  },
]);

const imageModelSummary = computed(() =>
  imageProviderConfigured.value
    ? (imageSelectedModel.value?.name ?? t("preferences.noImageModelSelected"))
    : t("preferences.imageModelUnconfigured"),
);

watch(isOpen, (open) => {
  if (!open) {
    void flushUserProfileSave();
    return;
  }
  activeSection.value = requestedSection ?? "general";
  requestedSection = null;
  void modelsStore.load();
  void loadUserProfile();
  void loadTinyFishCredentialStatus();
  void loadContextCompactionStrategy();
  void loadContextCompactionRoute();
  void loadCompletionSignal();
  void loadDiagnosticLogging();
});

watch(
  profileDraft,
  () => {
    if (!hasHydratedProfile.value || isHydratingProfile.value) return;
    if (!isProfileDirty.value) return;
    scheduleUserProfileSave();
  },
  { deep: true, flush: "sync" },
);

onBeforeUnmount(() => {
  if (profileSaveTimer) {
    clearTimeout(profileSaveTimer);
    profileSaveTimer = undefined;
    void enqueueUserProfileSave();
  }
});

onMounted(() => {
  void loadUserProfile();
  void loadTinyFishCredentialStatus();
  void loadContextCompactionStrategy();
  void loadContextCompactionRoute();
  void loadCompletionSignal();
  void loadDiagnosticLogging();
});

function userProfilesEqual(a: PineUserProfile, b: PineUserProfile): boolean {
  return (
    a.communicationStyle === b.communicationStyle &&
    a.customInstructions === b.customInstructions &&
    a.nickname === b.nickname &&
    a.personalDetails === b.personalDetails &&
    a.technicalBackground === b.technicalBackground
  );
}

async function loadUserProfile(): Promise<void> {
  try {
    await userProfileStore.load();
    if (!hasHydratedProfile.value || !isProfileDirty.value) {
      isHydratingProfile.value = true;
      Object.assign(profileDraft, userProfileStore.profile);
      isHydratingProfile.value = false;
      hasHydratedProfile.value = true;
    }
  } catch (error) {
    handleError(error, {
      id: "user-profile.load",
      title: t("errors.userProfile.title"),
      description: t("errors.userProfile.description"),
    });
  }
}

function scheduleUserProfileSave(): void {
  if (profileSaveTimer) clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(() => {
    profileSaveTimer = undefined;
    void enqueueUserProfileSave();
  }, PROFILE_AUTOSAVE_DELAY_MS);
}

function enqueueUserProfileSave(): Promise<void> {
  const snapshot = normalizePineUserProfile({ ...profileDraft });
  const operation = profileSaveQueue
    .catch(() => {})
    .then(async () => {
      const savedProfile = normalizePineUserProfile(userProfileStore.profile);
      if (userProfilesEqual(snapshot, savedProfile)) {
        if (
          userProfilesEqual(
            snapshot,
            normalizePineUserProfile({ ...profileDraft }),
          )
        ) {
          isHydratingProfile.value = true;
          Object.assign(profileDraft, snapshot);
          isHydratingProfile.value = false;
        }
        return;
      }

      await userProfileStore.save(snapshot);
      if (
        userProfilesEqual(
          snapshot,
          normalizePineUserProfile({ ...profileDraft }),
        )
      ) {
        isHydratingProfile.value = true;
        Object.assign(profileDraft, snapshot);
        isHydratingProfile.value = false;
      }
    })
    .catch((error: unknown) => {
      handleError(error, {
        id: "user-profile.save",
        title: t("errors.userProfile.title"),
        description: t("errors.userProfile.description"),
      });
    });
  profileSaveQueue = operation;
  return operation;
}

function flushUserProfileSave(): Promise<void> {
  if (profileSaveTimer) {
    clearTimeout(profileSaveTimer);
    profileSaveTimer = undefined;
  }
  if (!hasHydratedProfile.value) return profileSaveQueue;
  return enqueueUserProfileSave();
}

async function refreshModelCatalog(): Promise<void> {
  if (isRefreshingModelCatalog.value) return;
  isRefreshingModelCatalog.value = true;
  try {
    modelsStore.catalog = await window.pine.refreshModelCatalog();
    toast.success(t("preferences.modelCatalogRefreshed"));
  } catch (error) {
    handleError(error, {
      id: "model-catalog.refresh",
      title: t("errors.modelCatalogRefresh.title"),
      description: t("errors.modelCatalogRefresh.description"),
    });
  } finally {
    isRefreshingModelCatalog.value = false;
  }
}

function updateCommunicationStyle(value: unknown): void {
  if (typeof value === "string" && isPineCommunicationStyle(value)) {
    profileDraft.communicationStyle = value;
  }
}

function updateTechnicalBackground(value: unknown): void {
  if (typeof value === "string" && isPineTechnicalBackground(value)) {
    profileDraft.technicalBackground = value;
  }
}

async function loadContextCompactionStrategy(): Promise<void> {
  if (typeof window.pine?.getContextCompactionStrategy !== "function") return;
  try {
    contextCompactionStrategy.value =
      await window.pine.getContextCompactionStrategy();
  } catch (error) {
    handleError(error, {
      id: "context-compaction-strategy-load",
      title: t("errors.contextCompactionStrategy.title"),
      description: t("errors.contextCompactionStrategy.description"),
    });
  }
}

async function loadContextCompactionRoute(): Promise<void> {
  if (typeof window.pine?.getContextCompactionRoute !== "function") return;
  try {
    contextCompactionRoute.value =
      await window.pine.getContextCompactionRoute();
  } catch (error) {
    handleError(error, {
      id: "context-compaction-route-load",
      title: t("errors.contextCompactionRoute.title"),
      description: t("errors.contextCompactionRoute.description"),
    });
  }
}

async function loadCompletionSignal(): Promise<void> {
  if (isSavingCompletionSignal.value) return;
  isLoadingCompletionSignal.value = true;
  try {
    if (typeof window.pine?.getCompletionSignal !== "function") return;
    completionSignalEnabled.value = await window.pine.getCompletionSignal();
  } catch (error) {
    handleError(error, {
      id: "completion-signal-load",
      title: t("errors.completionSignal.title"),
      description: t("errors.completionSignal.description"),
    });
  } finally {
    isLoadingCompletionSignal.value = false;
  }
}

async function updateCompletionSignal(enabled: boolean): Promise<void> {
  if (
    isLoadingCompletionSignal.value ||
    isSavingCompletionSignal.value ||
    enabled === completionSignalEnabled.value
  )
    return;
  const previous = completionSignalEnabled.value;
  completionSignalEnabled.value = enabled;
  isSavingCompletionSignal.value = true;
  try {
    const result = await window.pine.setCompletionSignal({ enabled });
    completionSignalEnabled.value = result.enabled;
  } catch (error) {
    completionSignalEnabled.value = previous;
    handleError(error, {
      id: "completion-signal-update",
      title: t("errors.completionSignal.title"),
      description: t("errors.completionSignal.description"),
    });
  } finally {
    isSavingCompletionSignal.value = false;
  }
}

async function loadDiagnosticLogging(): Promise<void> {
  if (isSavingDiagnosticLogging.value) return;
  isLoadingDiagnosticLogging.value = true;
  try {
    if (typeof window.pine?.getDiagnosticLogging !== "function") return;
    diagnosticLoggingEnabled.value = await window.pine.getDiagnosticLogging();
  } catch (error) {
    handleError(error, {
      id: "diagnostic-logging-load",
      title: t("errors.diagnosticLogging.title"),
      description: t("errors.diagnosticLogging.description"),
    });
  } finally {
    isLoadingDiagnosticLogging.value = false;
  }
}

async function updateDiagnosticLogging(enabled: boolean): Promise<void> {
  if (
    isLoadingDiagnosticLogging.value ||
    isSavingDiagnosticLogging.value ||
    enabled === diagnosticLoggingEnabled.value
  )
    return;
  const previous = diagnosticLoggingEnabled.value;
  diagnosticLoggingEnabled.value = enabled;
  isSavingDiagnosticLogging.value = true;
  try {
    const result = await window.pine.setDiagnosticLogging({ enabled });
    diagnosticLoggingEnabled.value = result.enabled;
  } catch (error) {
    diagnosticLoggingEnabled.value = previous;
    handleError(error, {
      id: "diagnostic-logging-save",
      title: t("errors.diagnosticLogging.title"),
      description: t("errors.diagnosticLogging.description"),
    });
  } finally {
    isSavingDiagnosticLogging.value = false;
  }
}

async function updateContextCompactionStrategy(value: unknown): Promise<void> {
  if (
    !isPineContextCompactionStrategy(value) ||
    value === contextCompactionStrategy.value ||
    isSavingContextCompactionStrategy.value
  ) {
    return;
  }
  const previous = contextCompactionStrategy.value;
  contextCompactionStrategy.value = value;
  isSavingContextCompactionStrategy.value = true;
  try {
    await window.pine.setContextCompactionStrategy({ strategy: value });
  } catch (error) {
    contextCompactionStrategy.value = previous;
    handleError(error, {
      id: "context-compaction-strategy-save",
      title: t("errors.contextCompactionStrategy.title"),
      description: t("errors.contextCompactionStrategy.description"),
    });
  } finally {
    isSavingContextCompactionStrategy.value = false;
  }
}

async function updateContextCompactionRoute(value: unknown): Promise<void> {
  if (
    !isPineContextCompactionRoute(value) ||
    value === contextCompactionRoute.value ||
    isSavingContextCompactionRoute.value
  ) {
    return;
  }
  const previous = contextCompactionRoute.value;
  contextCompactionRoute.value = value;
  isSavingContextCompactionRoute.value = true;
  try {
    await window.pine.setContextCompactionRoute({ route: value });
  } catch (error) {
    contextCompactionRoute.value = previous;
    handleError(error, {
      id: "context-compaction-route-save",
      title: t("errors.contextCompactionRoute.title"),
      description: t("errors.contextCompactionRoute.description"),
    });
  } finally {
    isSavingContextCompactionRoute.value = false;
  }
}

async function loadTinyFishCredentialStatus(): Promise<void> {
  if (typeof window.pine?.getTinyFishCredentialStatus !== "function") return;
  try {
    const status = await window.pine.getTinyFishCredentialStatus();
    isTinyFishCredentialConfigured.value = status.configured;
  } catch (error) {
    handleError(error, {
      id: "tinyfish-credential-status",
      title: t("errors.tinyFishCredentials.title"),
      description: t("errors.tinyFishCredentials.description"),
    });
  }
}

function openTinyFishCredentialDialog(): void {
  tinyFishApiKey.value = "";
  isTinyFishCredentialDialogOpen.value = true;
}

async function saveTinyFishApiKey(): Promise<void> {
  if (!canSaveTinyFishApiKey.value) return;
  isSavingTinyFishApiKey.value = true;
  try {
    const result = await window.pine.setTinyFishApiKey({
      apiKey: tinyFishApiKey.value.trim(),
    });
    isTinyFishCredentialConfigured.value = result.configured;
    tinyFishApiKey.value = "";
    isTinyFishCredentialDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "tinyfish-credential-save",
      title: t("errors.tinyFishCredentials.title"),
      description: t("errors.tinyFishCredentials.description"),
    });
  } finally {
    isSavingTinyFishApiKey.value = false;
  }
}

function updateLocale(value: unknown): void {
  if (typeof value !== "string" || !isAppLocale(value)) return;

  locale.value = value;
  document.documentElement.lang = value;
  persistAppLocale(value);
}

function updateTheme(value: unknown): void {
  if (typeof value !== "string" || !isThemePreference(value)) return;
  appearanceStore.setThemePreference(value);
}

function updatePineColorTheme(value: unknown): void {
  if (typeof value !== "string" || !isProjectColorTheme(value)) return;
  appearanceStore.setPineColorTheme(value);
}

function updateSidebarVibrancy(value: boolean): void {
  appearanceStore.setSidebarVibrancy(value);
}

/** Open the preferences at a section, e.g. from No Project's sidebar. */
function open(section: PreferenceSection = "general"): void {
  if (isOpen.value) {
    activeSection.value = section;
    return;
  }
  requestedSection = section;
  isOpen.value = true;
}

defineExpose({ open });
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogTrigger as-child>
      <Button
        data-slot="pine-preferences-trigger"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('preferences.open')"
        :title="t('preferences.open')"
      >
        <SettingsIcon />
      </Button>
    </DialogTrigger>

    <DialogContent
      class="flex h-[min(38rem,calc(100vh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
    >
      <DialogHeader class="px-6 pt-6 pb-4 pr-16">
        <DialogTitle>{{ t("preferences.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("preferences.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1">
        <nav
          class="flex w-44 shrink-0 flex-col gap-1 border-r bg-muted/20 p-2"
          :aria-label="t('preferences.sectionsLabel')"
        >
          <Item
            v-for="section in sections"
            :key="section.id"
            as="button"
            type="button"
            size="xs"
            :variant="activeSection === section.id ? 'muted' : 'default'"
            :aria-current="activeSection === section.id ? 'true' : undefined"
            class="hover:bg-muted"
            @click="activeSection = section.id"
          >
            <ItemMedia variant="icon">
              <component :is="section.icon" aria-hidden="true" />
            </ItemMedia>
            <ItemContent class="min-w-0">
              <ItemTitle>{{ section.label }}</ItemTitle>
            </ItemContent>
          </Item>
        </nav>

        <form
          v-if="activeSection === 'personalization'"
          data-testid="pine-user-profile-form"
          class="flex min-h-0 min-w-0 flex-1 flex-col"
          @submit.prevent="flushUserProfileSave"
        >
          <ScrollArea
            class="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:scroll-fade"
          >
            <FieldGroup class="gap-5 p-6">
              <Field>
                <FieldLabel for="pine-user-profile-nickname">
                  {{ t("preferences.userProfileNicknameLabel") }}
                </FieldLabel>
                <Input
                  id="pine-user-profile-nickname"
                  v-model="profileDraft.nickname"
                  maxlength="100"
                  autocomplete="nickname"
                  :placeholder="t('preferences.userProfileNicknamePlaceholder')"
                />
                <FieldDescription>
                  {{ t("preferences.userProfileNicknameDescription") }}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel id="pine-user-profile-style-label">
                  {{ t("preferences.userProfileStyleLabel") }}
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :spacing="2"
                  class="w-full"
                  :model-value="profileDraft.communicationStyle"
                  aria-labelledby="pine-user-profile-style-label"
                  @update:model-value="updateCommunicationStyle"
                >
                  <ToggleGroupItem value="calm-professional" class="flex-1">
                    {{ t("preferences.userProfileStyleCalm") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="warm-friendly" class="flex-1">
                    {{ t("preferences.userProfileStyleWarm") }}
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {{ communicationStyleDescription }}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel id="pine-user-profile-background-label">
                  {{ t("preferences.userProfileTechLabel") }}
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :spacing="2"
                  class="w-full"
                  :model-value="profileDraft.technicalBackground"
                  aria-labelledby="pine-user-profile-background-label"
                  @update:model-value="updateTechnicalBackground"
                >
                  <ToggleGroupItem value="general-user" class="flex-1">
                    {{ t("preferences.userProfileTechGeneral") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="enthusiast" class="flex-1">
                    {{ t("preferences.userProfileTechEnthusiast") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="professional-user" class="flex-1">
                    {{ t("preferences.userProfileTechProfessional") }}
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {{ technicalBackgroundDescription }}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel for="pine-user-profile-details">
                  {{ t("preferences.userProfileDetailsLabel") }}
                </FieldLabel>
                <Textarea
                  id="pine-user-profile-details"
                  v-model="profileDraft.personalDetails"
                  maxlength="10000"
                  rows="4"
                  :placeholder="t('preferences.userProfileDetailsPlaceholder')"
                />
                <FieldDescription>
                  {{ t("preferences.userProfileDetailsDescription") }}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel for="pine-user-profile-instructions">
                  {{ t("preferences.userProfileInstructionsLabel") }}
                </FieldLabel>
                <Textarea
                  id="pine-user-profile-instructions"
                  v-model="profileDraft.customInstructions"
                  maxlength="20000"
                  rows="6"
                  :placeholder="
                    t('preferences.userProfileInstructionsPlaceholder')
                  "
                />
                <FieldDescription>
                  {{ t("preferences.userProfileInstructionsDescription") }}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </ScrollArea>
        </form>

        <ScrollArea
          v-else
          class="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]]:scroll-fade"
        >
          <div v-if="activeSection === 'general'" class="p-6">
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldTitle id="pine-language-setting">
                  {{ t("preferences.language") }}
                </FieldTitle>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="locale"
                  aria-labelledby="pine-language-setting"
                  @update:model-value="updateLocale"
                >
                  <ToggleGroupItem value="zh-CN">
                    {{ t("preferences.languageChinese") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="en-US">
                    {{ t("preferences.languageEnglish") }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <Field orientation="horizontal">
                <FieldTitle id="pine-appearance-setting">
                  {{ t("preferences.appearance") }}
                </FieldTitle>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="themePreference"
                  aria-labelledby="pine-appearance-setting"
                  @update:model-value="updateTheme"
                >
                  <ToggleGroupItem value="system">
                    {{ t("preferences.themeSystem") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="light">
                    {{ t("preferences.themeLight") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="dark">
                    {{ t("preferences.themeDark") }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-color-theme-setting">
                    {{ t("preferences.defaultColorTheme") }}
                  </FieldTitle>
                  <FieldDescription>
                    {{ t("preferences.defaultColorThemeDescription") }}
                  </FieldDescription>
                </div>
                <Select
                  :model-value="pineColorTheme"
                  @update:model-value="updatePineColorTheme"
                >
                  <SelectTrigger
                    class="w-fit justify-start [&>*:last-child]:ml-auto"
                    aria-labelledby="pine-color-theme-setting"
                  >
                    <span
                      aria-hidden="true"
                      class="size-3 shrink-0 rounded-full ring-1 ring-border"
                      :style="{
                        backgroundColor: selectedPineColorThemeOption?.swatch,
                      }"
                    />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem
                        v-for="option in PROJECT_COLOR_THEME_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                      >
                        <span class="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            class="size-3 rounded-full ring-1 ring-border"
                            :style="{ backgroundColor: option.swatch }"
                          />
                          {{ t(`projects.editor.colorThemes.${option.value}`) }}
                        </span>
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field v-if="supportsSidebarVibrancy" orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-sidebar-vibrancy-setting">
                    {{ t("preferences.sidebarVibrancy") }}
                  </FieldTitle>
                  <FieldDescription>
                    {{ t("preferences.sidebarVibrancyDescription") }}
                  </FieldDescription>
                </div>
                <Switch
                  data-testid="pine-sidebar-vibrancy-toggle"
                  :model-value="appearanceStore.sidebarVibrancy"
                  aria-labelledby="pine-sidebar-vibrancy-setting"
                  @update:model-value="updateSidebarVibrancy"
                />
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-completion-signal-setting">
                    {{ t("preferences.completionSignal") }}
                  </FieldTitle>
                  <FieldDescription>
                    {{ t("preferences.completionSignalDescription") }}
                  </FieldDescription>
                </div>
                <Switch
                  data-testid="pine-completion-signal-toggle"
                  :model-value="completionSignalEnabled"
                  :disabled="
                    isLoadingCompletionSignal || isSavingCompletionSignal
                  "
                  aria-labelledby="pine-completion-signal-setting"
                  @update:model-value="updateCompletionSignal"
                />
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 items-baseline gap-2">
                  <FieldLabel for="pine-diagnostic-logging-toggle">
                    {{ t("preferences.diagnosticLogging") }}
                  </FieldLabel>
                  <TooltipProvider :delay-duration="300">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge
                          as="button"
                          type="button"
                          variant="secondary"
                          class="size-5 translate-y-px p-0"
                          :aria-label="t('preferences.diagnosticLoggingHelp')"
                        >
                          <CircleHelpIcon aria-hidden="true" />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" :side-offset="4">
                        {{ t("preferences.diagnosticLoggingDescription") }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Switch
                  id="pine-diagnostic-logging-toggle"
                  data-testid="pine-diagnostic-logging-toggle"
                  :model-value="diagnosticLoggingEnabled"
                  :disabled="
                    isLoadingDiagnosticLogging || isSavingDiagnosticLogging
                  "
                  @update:model-value="updateDiagnosticLogging"
                />
              </Field>
            </FieldGroup>
          </div>

          <div v-else-if="activeSection === 'models'" class="p-6">
            <FieldGroup>
              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-model-catalog-refresh-setting">
                    {{ t("preferences.modelCatalogRefresh") }}
                  </FieldTitle>
                  <FieldDescription>
                    {{ t("preferences.modelCatalogRefreshDescription") }}
                  </FieldDescription>
                </div>
                <Button
                  data-testid="pine-model-catalog-refresh-button"
                  variant="outline"
                  size="sm"
                  :disabled="isRefreshingModelCatalog"
                  :aria-busy="isRefreshingModelCatalog"
                  aria-labelledby="pine-model-catalog-refresh-setting"
                  @click="refreshModelCatalog"
                >
                  <Spinner
                    v-if="isRefreshingModelCatalog"
                    data-icon="inline-start"
                  />
                  {{
                    isRefreshingModelCatalog
                      ? t("preferences.modelCatalogRefreshing")
                      : t("preferences.modelCatalogRefreshAction")
                  }}
                </Button>
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-tinyfish-credential-setting">
                    {{ t("preferences.tinyFish") }}
                  </FieldTitle>
                  <FieldDescription>
                    {{ t("preferences.tinyFishDescription") }}
                  </FieldDescription>
                </div>
                <Button
                  data-testid="pine-tinyfish-credential-button"
                  variant="outline"
                  size="sm"
                  aria-labelledby="pine-tinyfish-credential-setting"
                  @click="openTinyFishCredentialDialog"
                >
                  {{
                    isTinyFishCredentialConfigured
                      ? t("preferences.changeTinyFishApiKey")
                      : t("preferences.addTinyFishApiKey")
                  }}
                </Button>
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 items-baseline gap-2">
                  <FieldTitle id="pine-context-compaction-strategy-setting">
                    {{ t("preferences.contextCompactionStrategy") }}
                  </FieldTitle>
                  <TooltipProvider :delay-duration="300">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge
                          as="button"
                          type="button"
                          variant="secondary"
                          class="size-5 translate-y-px p-0"
                          :aria-label="
                            t('preferences.contextCompactionStrategyHelp')
                          "
                        >
                          <CircleHelpIcon aria-hidden="true" />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" :side-offset="4">
                        {{
                          t("preferences.contextCompactionStrategyDescription")
                        }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :disabled="isSavingContextCompactionStrategy"
                  :model-value="contextCompactionStrategy"
                  aria-labelledby="pine-context-compaction-strategy-setting"
                  @update:model-value="updateContextCompactionStrategy"
                >
                  <ToggleGroupItem value="passive">
                    {{ t("preferences.contextCompactionPassive") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="recommended">
                    {{ t("preferences.contextCompactionRecommended") }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 items-baseline gap-2">
                  <FieldTitle id="pine-context-compaction-route-setting">
                    {{ t("preferences.contextCompactionRoute") }}
                  </FieldTitle>
                  <TooltipProvider :delay-duration="300">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge
                          as="button"
                          type="button"
                          variant="secondary"
                          class="size-5 translate-y-px p-0"
                          :aria-label="
                            t('preferences.contextCompactionRouteHelp')
                          "
                        >
                          <CircleHelpIcon aria-hidden="true" />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top" :side-offset="4">
                        {{ t("preferences.contextCompactionRouteDescription") }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :disabled="isSavingContextCompactionRoute"
                  :model-value="contextCompactionRoute"
                  aria-labelledby="pine-context-compaction-route-setting"
                  @update:model-value="updateContextCompactionRoute"
                >
                  <ToggleGroupItem value="model">
                    {{ t("preferences.contextCompactionRouteModel") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="semantic">
                    {{ t("preferences.contextCompactionRouteSemantic") }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <AutoApprovalSettings />

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-utility-model-setting">
                    {{ t("preferences.utilityModel") }}
                  </FieldTitle>
                  <FieldDescription>
                    {{
                      utilitySelectedModel?.name ??
                      t("preferences.noUtilityModelSelected")
                    }}
                  </FieldDescription>
                </div>
                <Button
                  data-testid="pine-utility-model-button"
                  variant="outline"
                  size="sm"
                  aria-labelledby="pine-utility-model-setting"
                  @click="isUtilityModelPickerOpen = true"
                >
                  {{ t("preferences.selectUtilityModel") }}
                </Button>
              </Field>

              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-image-model-setting">
                    {{ t("preferences.imageModel") }}
                  </FieldTitle>
                  <FieldDescription>{{ imageModelSummary }}</FieldDescription>
                </div>
                <Button
                  data-testid="pine-image-model-button"
                  variant="outline"
                  size="sm"
                  aria-labelledby="pine-image-model-setting"
                  @click="isImageModelPickerOpen = true"
                >
                  {{ t("preferences.selectImageModel") }}
                </Button>
              </Field>

              <DecisionsModelSettings />
            </FieldGroup>
          </div>
          <div v-else-if="activeSection === 'projects'" class="p-6">
            <ProjectManagementSettings />
          </div>
        </ScrollArea>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="isTinyFishCredentialDialogOpen">
    <DialogContent class="sm:max-w-md">
      <form @submit.prevent="saveTinyFishApiKey">
        <DialogHeader>
          <DialogTitle>
            {{ t("preferences.tinyFishDialogTitle") }}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup class="py-4">
          <Field>
            <FieldLabel for="tinyfish-api-key">
              {{ t("preferences.tinyFishApiKeyLabel") }}
            </FieldLabel>
            <Input
              id="tinyfish-api-key"
              v-model="tinyFishApiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="t('preferences.tinyFishApiKeyPlaceholder')"
              :disabled="isSavingTinyFishApiKey"
            />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="isSavingTinyFishApiKey"
            @click="isTinyFishCredentialDialogOpen = false"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="!canSaveTinyFishApiKey">
            {{
              isSavingTinyFishApiKey
                ? t("common.saving")
                : t("preferences.saveTinyFishApiKey")
            }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <ModelPickerDialog
    v-model:open="isUtilityModelPickerOpen"
    purpose="utility"
  />

  <ModelPickerDialog v-model:open="isImageModelPickerOpen" purpose="image" />
</template>

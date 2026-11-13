<script setup lang="ts">
import { isDesktopClient } from "@/lib/clientRuntime";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { useDialogPages } from "@/composables/useDialogPages";
import { usePhoneLayout } from "@/composables/usePhoneLayout";
import { handleError } from "@/app/errors/errorHandler";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BotIcon,
  FolderKanbanIcon,
  MonitorSmartphoneIcon,
  SettingsIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserRoundIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import type { Component } from "vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  APP_LOCALES,
  APP_LOCALE_NAMES,
  isAppLocale,
  persistAppLocale,
} from "@/app/i18n";
import RelayRemoteSettings from "./RelayRemoteSettings.vue";
import RemoteControlSettings from "./RemoteControlSettings.vue";
import WeChatRemoteSettings from "./WeChatRemoteSettings.vue";
import AutoApprovalSettings from "./AutoApprovalSettings.vue";
import DecisionsModelSettings from "./DecisionsModelSettings.vue";
import ProjectManagementSettings from "./ProjectManagementSettings.vue";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import HelpHint from "./HelpHint.vue";
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
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
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
import { useCurrencyStore } from "@/stores/currency";
import { useModelsStore } from "@/stores/models";
import { useUserProfileStore } from "@/stores/userProfile";
import {
  isProjectColorTheme,
  isThemePreference,
  useAppearanceStore,
} from "@/stores/appearance";
import { PROJECT_COLOR_THEME_OPTIONS } from "@/lib/projectColorThemes";
import {
  DEFAULT_ATTENTION_NOTIFICATIONS_ENABLED,
  DEFAULT_COMPLETION_SIGNAL_MODE,
  isPineCompletionSignalMode,
  type PineCompletionSignalMode,
  DEFAULT_CONTEXT_COMPACTION_ROUTE,
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  isPineContextCompactionRoute,
  isPineContextCompactionStrategy,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
} from "@/shared/preferences";
import {
  DEFAULT_RUN_IN_BACKGROUND,
  supportsBackgroundMode,
} from "@/shared/background";
import { DEFAULT_QUICK_COMPOSER_ENABLED } from "@/shared/quickComposer";
import { DEFAULT_APPROXIMATE_LOCATION_ENABLED } from "@/shared/approximateLocation";
import {
  createDefaultPineUserProfile,
  isPineCommunicationStyle,
  isPinePronouns,
  isPineTechnicalBackground,
  normalizePineUserProfile,
  PINE_CUSTOM_PRONOUNS_MAX_LENGTH,
  PINE_PRONOUNS,
  type PinePronouns,
  type PineUserProfile,
} from "@/shared/userProfile";

type PreferenceSection =
  | "general"
  | "appearance"
  | "models"
  | "agent"
  | "personalization"
  | "projects"
  | "remote";

const { locale, t } = useI18n();
const isDesktop = isDesktopClient();
const supportsRemoteControl =
  isDesktop && typeof window.pine?.getWebServer === "function";
const hasRelayRemote =
  isDesktop && typeof window.pine?.getRemoteControl === "function";
const hasWeChatRemote =
  isDesktop && typeof window.pine?.getWeChatRemote === "function";
const appearanceStore = useAppearanceStore();
const modelsStore = useModelsStore();
const userProfileStore = useUserProfileStore();
const currencyStore = useCurrencyStore();
void currencyStore.load();
const { supportsSidebarVibrancy, themePreference, pineColorTheme } =
  storeToRefs(appearanceStore);
const {
  imageProviderConfigured,
  imageSelectedModel,
  videoProviderConfigured,
  videoSelectedModel,
  utilitySelectedModel,
  approvalSelectedModel,
} = storeToRefs(modelsStore);
const isOpen = ref(false);
const activeSection = ref<PreferenceSection>("general");
// The section an `open` call asks for; plain opens start at General.
let requestedSection: PreferenceSection | null = null;
// A phone shows the section list and one section at a time.
const isPhone = usePhoneLayout();
const isSectionShown = ref(false);
const showPage = useDialogPages();
const isUtilityModelPickerOpen = ref(false);
const isApprovalModelPickerOpen = ref(false);
const isImageModelPickerOpen = ref(false);
const isVideoModelPickerOpen = ref(false);
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
const runInBackground = ref(DEFAULT_RUN_IN_BACKGROUND);
const isLoadingRunInBackground = ref(true);
const isSavingRunInBackground = ref(false);
const supportsRunInBackground = computed(
  () =>
    isDesktop &&
    supportsBackgroundMode(window.pine?.platform ?? "") &&
    typeof window.pine?.setRunInBackground === "function",
);
const runInBackgroundDescriptionKey = computed(() =>
  window.pine?.platform === "darwin"
    ? "preferences.runInBackgroundDescriptionMac"
    : "preferences.runInBackgroundDescriptionWindows",
);
const quickComposerEnabled = ref(DEFAULT_QUICK_COMPOSER_ENABLED);
const isLoadingQuickComposer = ref(true);
const isSavingQuickComposer = ref(false);
const approximateLocationEnabled = ref(DEFAULT_APPROXIMATE_LOCATION_ENABLED);
const isLoadingApproximateLocation = ref(true);
const isSavingApproximateLocation = ref(false);
const quickComposerShortcut = computed(() =>
  window.pine?.platform === "darwin" ? "⌘;" : "Ctrl+;",
);
const completionSignalMode = ref<PineCompletionSignalMode>(
  DEFAULT_COMPLETION_SIGNAL_MODE,
);
const isLoadingCompletionSignal = ref(true);
const isSavingCompletionSignal = ref(false);
const attentionNotificationsEnabled = ref(
  DEFAULT_ATTENTION_NOTIFICATIONS_ENABLED,
);
const isLoadingAttentionNotifications = ref(true);
const isSavingAttentionNotifications = ref(false);
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
const COMMUNICATION_STYLE_DESCRIPTION_KEYS = {
  "calm-professional": "preferences.userProfileStyleCalmDescription",
  neutral: "preferences.userProfileStyleNeutralDescription",
  "warm-friendly": "preferences.userProfileStyleWarmDescription",
} as const;
const PRONOUN_LABEL_KEYS = {
  unspecified: "preferences.userProfilePronounsUnspecified",
  he: "preferences.userProfilePronounsHe",
  she: "preferences.userProfilePronounsShe",
  they: "preferences.userProfilePronounsThey",
  custom: "preferences.userProfilePronounsCustom",
} as const satisfies Record<PinePronouns, string>;
const communicationStyleDescription = computed(() =>
  t(COMMUNICATION_STYLE_DESCRIPTION_KEYS[profileDraft.communicationStyle]),
);
const technicalBackgroundDescription = computed(() =>
  t(
    profileDraft.technicalBackground === "general-user"
      ? "preferences.userProfileTechGeneralDescription"
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
    icon: PaletteIcon,
    id: "appearance",
    label: t("preferences.sections.appearance"),
  },
  {
    icon: SparklesIcon,
    id: "models",
    label: t("preferences.sections.models"),
  },
  {
    icon: BotIcon,
    id: "agent",
    label: t("preferences.sections.agent"),
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
  // Only the desktop window can host browser access.
  ...(supportsRemoteControl
    ? [
        {
          icon: MonitorSmartphoneIcon,
          id: "remote" as const,
          label: t("preferences.sections.remote"),
        },
      ]
    : []),
]);

const imageModelSummary = computed(() =>
  imageProviderConfigured.value
    ? (imageSelectedModel.value?.name ?? t("preferences.noImageModelSelected"))
    : t("preferences.imageModelUnconfigured"),
);
const videoModelSummary = computed(() =>
  videoProviderConfigured.value
    ? (videoSelectedModel.value?.name ?? t("preferences.noVideoModelSelected"))
    : t("preferences.videoModelUnconfigured"),
);

watch(isOpen, (open) => {
  if (!open) {
    void flushUserProfileSave();
    return;
  }
  activeSection.value = requestedSection ?? "general";
  isSectionShown.value = requestedSection !== null;
  requestedSection = null;
  void modelsStore.load();
  void loadUserProfile();
  void loadTinyFishCredentialStatus();
  void loadContextCompactionStrategy();
  void loadContextCompactionRoute();
  void loadCompletionSignal();
  void loadAttentionNotifications();
  void loadQuickComposer();
  void loadRunInBackground();
  void loadApproximateLocation();
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
  void loadAttentionNotifications();
  void loadQuickComposer();
  void loadRunInBackground();
  void loadApproximateLocation();
  void loadDiagnosticLogging();
});

function userProfilesEqual(a: PineUserProfile, b: PineUserProfile): boolean {
  return (
    a.communicationStyle === b.communicationStyle &&
    a.monetMode === b.monetMode &&
    a.customInstructions === b.customInstructions &&
    a.nickname === b.nickname &&
    a.personalDetails === b.personalDetails &&
    a.pronouns === b.pronouns &&
    a.customPronouns === b.customPronouns &&
    a.technicalBackground === b.technicalBackground &&
    a.interactiveAnswersEnabled === b.interactiveAnswersEnabled
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

const CUSTOM_PRONOUNS_INPUT_ID = "pine-user-profile-custom-pronouns";
// Set when the user switches to Custom, so the Select's close does not
// hand focus back to its trigger instead of the field that just appeared.
let focusCustomPronounsOnClose = false;

function focusCustomPronounsInput(): void {
  document.getElementById(CUSTOM_PRONOUNS_INPUT_ID)?.focus();
}

function updatePronouns(value: unknown): void {
  if (!isPinePronouns(value)) {
    return;
  }
  const switchedToCustom =
    value === "custom" && profileDraft.pronouns !== "custom";
  profileDraft.pronouns = value;
  if (switchedToCustom) {
    focusCustomPronounsOnClose = true;
    void nextTick(focusCustomPronounsInput);
  }
}

function onPronounsCloseAutoFocus(event: Event): void {
  if (!focusCustomPronounsOnClose) {
    return;
  }
  focusCustomPronounsOnClose = false;
  if (profileDraft.pronouns === "custom") {
    event.preventDefault();
    focusCustomPronounsInput();
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

async function loadRunInBackground(): Promise<void> {
  if (isSavingRunInBackground.value) return;
  isLoadingRunInBackground.value = true;
  try {
    if (typeof window.pine?.getRunInBackground !== "function") return;
    runInBackground.value = await window.pine.getRunInBackground();
  } catch (error) {
    handleError(error, {
      id: "preferences.runInBackground.load",
      title: t("errors.runInBackground.title"),
      description: t("errors.runInBackground.description"),
    });
  } finally {
    isLoadingRunInBackground.value = false;
  }
}

async function updateRunInBackground(enabled: boolean): Promise<void> {
  if (
    isLoadingRunInBackground.value ||
    isSavingRunInBackground.value ||
    enabled === runInBackground.value ||
    typeof window.pine?.setRunInBackground !== "function"
  )
    return;
  const previous = runInBackground.value;
  runInBackground.value = enabled;
  isSavingRunInBackground.value = true;
  try {
    runInBackground.value = await window.pine.setRunInBackground(enabled);
  } catch (error) {
    runInBackground.value = previous;
    handleError(error, {
      id: "preferences.runInBackground.save",
      title: t("errors.runInBackground.title"),
      description: t("errors.runInBackground.description"),
    });
  } finally {
    isSavingRunInBackground.value = false;
  }
}

async function loadQuickComposer(): Promise<void> {
  if (isSavingQuickComposer.value) return;
  isLoadingQuickComposer.value = true;
  try {
    if (typeof window.pine?.getQuickComposer !== "function") return;
    quickComposerEnabled.value = await window.pine.getQuickComposer();
  } catch (error) {
    handleError(error, {
      id: "preferences.quickComposer.load",
      title: t("errors.quickComposer.title"),
      description: t("errors.quickComposer.description"),
    });
  } finally {
    isLoadingQuickComposer.value = false;
  }
}

async function loadApproximateLocation(): Promise<void> {
  if (isSavingApproximateLocation.value) return;
  isLoadingApproximateLocation.value = true;
  try {
    if (typeof window.pine?.getApproximateLocation !== "function") return;
    approximateLocationEnabled.value =
      await window.pine.getApproximateLocation();
  } catch (error) {
    handleError(error, {
      id: "preferences.approximateLocation.load",
      title: t("errors.approximateLocation.title"),
      description: t("errors.approximateLocation.description"),
    });
  } finally {
    isLoadingApproximateLocation.value = false;
  }
}

async function updateApproximateLocation(enabled: boolean): Promise<void> {
  if (
    isLoadingApproximateLocation.value ||
    isSavingApproximateLocation.value ||
    enabled === approximateLocationEnabled.value
  )
    return;
  const previous = approximateLocationEnabled.value;
  approximateLocationEnabled.value = enabled;
  isSavingApproximateLocation.value = true;
  try {
    const result = await window.pine.setApproximateLocation({ enabled });
    approximateLocationEnabled.value = result.enabled;
  } catch (error) {
    approximateLocationEnabled.value = previous;
    handleError(error, {
      id: "preferences.approximateLocation.save",
      title: t("errors.approximateLocation.title"),
      description: t("errors.approximateLocation.description"),
    });
  } finally {
    isSavingApproximateLocation.value = false;
  }
}

async function updateQuickComposer(enabled: boolean): Promise<void> {
  if (
    isLoadingQuickComposer.value ||
    isSavingQuickComposer.value ||
    enabled === quickComposerEnabled.value
  )
    return;
  const previous = quickComposerEnabled.value;
  quickComposerEnabled.value = enabled;
  isSavingQuickComposer.value = true;
  try {
    const result = await window.pine.setQuickComposer({ enabled });
    quickComposerEnabled.value = result.enabled;
    if (!result.registered)
      toast.error(t("errors.quickComposerShortcutTaken.title"), {
        description: t("errors.quickComposerShortcutTaken.description", {
          shortcut: quickComposerShortcut.value,
        }),
      });
  } catch (error) {
    quickComposerEnabled.value = previous;
    handleError(error, {
      id: "preferences.quickComposer.save",
      title: t("errors.quickComposer.title"),
      description: t("errors.quickComposer.description"),
    });
  } finally {
    isSavingQuickComposer.value = false;
  }
}

async function loadCompletionSignal(): Promise<void> {
  if (isSavingCompletionSignal.value) return;
  isLoadingCompletionSignal.value = true;
  try {
    if (typeof window.pine?.getCompletionSignal !== "function") return;
    completionSignalMode.value = await window.pine.getCompletionSignal();
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

async function updateCompletionSignal(value: unknown): Promise<void> {
  if (!isPineCompletionSignalMode(value)) return;
  if (
    isLoadingCompletionSignal.value ||
    isSavingCompletionSignal.value ||
    value === completionSignalMode.value
  )
    return;
  const previous = completionSignalMode.value;
  completionSignalMode.value = value;
  isSavingCompletionSignal.value = true;
  try {
    const result = await window.pine.setCompletionSignal({ mode: value });
    completionSignalMode.value = result.mode;
  } catch (error) {
    completionSignalMode.value = previous;
    handleError(error, {
      id: "completion-signal-update",
      title: t("errors.completionSignal.title"),
      description: t("errors.completionSignal.description"),
    });
  } finally {
    isSavingCompletionSignal.value = false;
  }
}

async function loadAttentionNotifications(): Promise<void> {
  if (isSavingAttentionNotifications.value) return;
  isLoadingAttentionNotifications.value = true;
  try {
    if (typeof window.pine?.getAttentionNotifications !== "function") return;
    attentionNotificationsEnabled.value =
      await window.pine.getAttentionNotifications();
  } catch (error) {
    handleError(error, {
      id: "preferences.attentionNotifications.load",
      title: t("errors.attentionNotifications.title"),
      description: t("errors.attentionNotifications.description"),
    });
  } finally {
    isLoadingAttentionNotifications.value = false;
  }
}

async function updateAttentionNotifications(enabled: boolean): Promise<void> {
  if (
    isLoadingAttentionNotifications.value ||
    isSavingAttentionNotifications.value ||
    enabled === attentionNotificationsEnabled.value
  )
    return;
  const previous = attentionNotificationsEnabled.value;
  attentionNotificationsEnabled.value = enabled;
  isSavingAttentionNotifications.value = true;
  try {
    const result = await window.pine.setAttentionNotifications({ enabled });
    attentionNotificationsEnabled.value = result.enabled;
  } catch (error) {
    attentionNotificationsEnabled.value = previous;
    handleError(error, {
      id: "preferences.attentionNotifications.save",
      title: t("errors.attentionNotifications.title"),
      description: t("errors.attentionNotifications.description"),
    });
  } finally {
    isSavingAttentionNotifications.value = false;
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

/** Monet mode is one switch for the voice and the reading font. */
function updateMonetMode(value: boolean): void {
  profileDraft.monetMode = value;
  appearanceStore.setReadingFont(value);
}

/** Open preferences at a section, including the sidebar's project manager. */
function open(section?: PreferenceSection): void {
  if (isOpen.value) {
    activeSection.value = section ?? "general";
    isSectionShown.value = section !== undefined;
    return;
  }
  requestedSection = section ?? null;
  isOpen.value = true;
}

function showSection(section: PreferenceSection): void {
  showPage("forward", () => {
    activeSection.value = section;
    isSectionShown.value = true;
  });
}

function showSectionList(): void {
  showPage("back", () => (isSectionShown.value = false));
}

const activeSectionLabel = computed(
  () => sections.value.find(({ id }) => id === activeSection.value)?.label,
);

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
      data-dialog-pages
      :class="[
        'flex h-[min(38rem,calc(100vh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader
        v-if="isPhone && isSectionShown"
        class="flex-row items-center gap-2 px-4 pt-4 pb-2 pr-16"
      >
        <Button
          data-testid="pine-preferences-back"
          variant="secondary"
          size="icon-sm"
          :aria-label="t('common.back')"
          @click="showSectionList"
        >
          <ChevronLeftIcon />
        </Button>
        <DialogTitle class="leading-7">{{ activeSectionLabel }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("preferences.description") }}
        </DialogDescription>
      </DialogHeader>
      <DialogHeader v-else class="px-6 pt-6 pb-4 pr-16">
        <DialogTitle>{{ t("preferences.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("preferences.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1">
        <nav
          v-show="!isPhone || !isSectionShown"
          :class="[
            'flex shrink-0 flex-col gap-1 p-2',
            isPhone ? 'w-full px-4' : 'w-44 border-r bg-muted/20',
          ]"
          :aria-label="t('preferences.sectionsLabel')"
        >
          <Item
            v-for="section in sections"
            :key="section.id"
            as="button"
            type="button"
            :size="isPhone ? 'sm' : 'xs'"
            :variant="
              !isPhone && activeSection === section.id ? 'muted' : 'default'
            "
            :aria-current="
              !isPhone && activeSection === section.id ? 'true' : undefined
            "
            class="hover:bg-muted active:bg-muted"
            @click="showSection(section.id)"
          >
            <ItemMedia variant="icon">
              <component :is="section.icon" aria-hidden="true" />
            </ItemMedia>
            <ItemContent class="min-w-0">
              <ItemTitle>{{ section.label }}</ItemTitle>
            </ItemContent>
            <ItemActions v-if="isPhone">
              <ChevronRightIcon class="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        </nav>

        <form
          v-if="activeSection === 'personalization'"
          v-show="!isPhone || isSectionShown"
          data-testid="pine-user-profile-form"
          class="flex min-h-0 min-w-0 flex-1 flex-col"
          @submit.prevent="flushUserProfileSave"
        >
          <ScrollArea
            class="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:scroll-fade"
          >
            <FieldGroup class="gap-5 p-6 max-sm:px-4">
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
                <FieldLabel id="pine-user-profile-pronouns-label">
                  {{ t("preferences.userProfilePronounsLabel") }}
                </FieldLabel>
                <div class="flex flex-wrap gap-2">
                  <Select
                    :model-value="profileDraft.pronouns"
                    @update:model-value="updatePronouns"
                  >
                    <SelectTrigger
                      data-testid="pine-user-profile-pronouns-select"
                      class="w-fit"
                      aria-labelledby="pine-user-profile-pronouns-label"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent @close-auto-focus="onPronounsCloseAutoFocus">
                      <SelectGroup>
                        <SelectItem
                          v-for="option in PINE_PRONOUNS"
                          :key="option"
                          :value="option"
                        >
                          {{ t(PRONOUN_LABEL_KEYS[option]) }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Input
                    v-if="profileDraft.pronouns === 'custom'"
                    :id="CUSTOM_PRONOUNS_INPUT_ID"
                    v-model="profileDraft.customPronouns"
                    class="min-w-40 flex-1"
                    :maxlength="PINE_CUSTOM_PRONOUNS_MAX_LENGTH"
                    autocomplete="off"
                    :aria-label="
                      t('preferences.userProfilePronounsCustomLabel')
                    "
                    :placeholder="
                      t('preferences.userProfilePronounsCustomPlaceholder')
                    "
                  />
                </div>
                <FieldDescription>
                  {{ t("preferences.userProfilePronounsDescription") }}
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
                  :disabled="profileDraft.monetMode"
                  aria-labelledby="pine-user-profile-style-label"
                  @update:model-value="updateCommunicationStyle"
                >
                  <ToggleGroupItem value="calm-professional" class="flex-1">
                    {{ t("preferences.userProfileStyleCalm") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="neutral" class="flex-1">
                    {{ t("preferences.userProfileStyleNeutral") }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="warm-friendly" class="flex-1">
                    {{ t("preferences.userProfileStyleWarm") }}
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {{
                    profileDraft.monetMode
                      ? t("preferences.userProfileStyleMonetNotice")
                      : communicationStyleDescription
                  }}
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
          v-show="!isPhone || isSectionShown"
          class="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]]:scroll-fade"
        >
          <div v-if="activeSection === 'general'" class="p-6 max-sm:px-4">
            <FieldGroup>
              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.language") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
                    <FieldTitle id="pine-language-setting">
                      {{ t("preferences.language") }}
                    </FieldTitle>
                    <Select
                      :model-value="locale"
                      @update:model-value="updateLocale"
                    >
                      <SelectTrigger
                        data-testid="pine-language-select"
                        class="w-fit"
                        aria-labelledby="pine-language-setting"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem
                            v-for="option in APP_LOCALES"
                            :key="option"
                            :value="option"
                          >
                            {{ APP_LOCALE_NAMES[option] }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field orientation="responsive">
                    <FieldContent>
                      <FieldTitle id="pine-currency-setting">
                        {{ t("preferences.currency") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{ t("preferences.currencyDescription") }}
                      </FieldDescription>
                    </FieldContent>
                    <Select
                      :model-value="currencyStore.preference"
                      @update:model-value="
                        (value) =>
                          currencyStore.setPreference(
                            value as typeof currencyStore.preference,
                          )
                      "
                    >
                      <SelectTrigger
                        data-testid="pine-currency-select"
                        class="w-fit"
                        aria-labelledby="pine-currency-setting"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="auto">
                            {{
                              t("preferences.currencyAuto", {
                                currency: currencyStore.systemCurrency,
                              })
                            }}
                          </SelectItem>
                          <SelectItem
                            v-for="code in currencyStore.options"
                            :key="code"
                            :value="code"
                          >
                            {{ code }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field orientation="horizontal">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle
                        id="pine-monet-mode-setting"
                        style="font-family: var(--font-reading)"
                      >
                        {{ t("preferences.monetMode") }}
                      </FieldTitle>
                    </div>
                    <Switch
                      data-testid="pine-monet-mode-toggle"
                      :model-value="profileDraft.monetMode"
                      aria-labelledby="pine-monet-mode-setting"
                      @update:model-value="updateMonetMode"
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.notifications") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-completion-signal-setting">
                        {{ t("preferences.completionSignal") }}
                      </FieldTitle>
                    </div>
                    <Select
                      :model-value="completionSignalMode"
                      :disabled="
                        isLoadingCompletionSignal || isSavingCompletionSignal
                      "
                      @update:model-value="updateCompletionSignal"
                    >
                      <SelectTrigger
                        data-testid="pine-completion-signal-select"
                        class="w-fit"
                        aria-labelledby="pine-completion-signal-setting"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="off">
                            {{ t("preferences.completionSignalOff") }}
                          </SelectItem>
                          <SelectItem value="notification">
                            {{ t("preferences.completionSignalNotification") }}
                          </SelectItem>
                          <SelectItem value="notification-sound">
                            {{
                              t("preferences.completionSignalNotificationSound")
                            }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field orientation="horizontal">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-attention-notifications-setting">
                        {{ t("preferences.attentionNotifications") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{ t("preferences.attentionNotificationsDescription") }}
                      </FieldDescription>
                    </div>
                    <Switch
                      data-testid="pine-attention-notifications-toggle"
                      :model-value="attentionNotificationsEnabled"
                      :disabled="
                        isLoadingAttentionNotifications ||
                        isSavingAttentionNotifications
                      "
                      aria-labelledby="pine-attention-notifications-setting"
                      @update:model-value="updateAttentionNotifications"
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.system") }}</FieldLegend
                >
                <FieldGroup>
                  <Field v-if="isDesktop" orientation="horizontal">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-quick-composer-setting">
                        {{ t("preferences.quickComposer") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{
                          t("preferences.quickComposerDescription", {
                            shortcut: quickComposerShortcut,
                          })
                        }}
                      </FieldDescription>
                    </div>
                    <Switch
                      data-testid="pine-quick-composer-toggle"
                      :model-value="quickComposerEnabled"
                      :disabled="
                        isLoadingQuickComposer || isSavingQuickComposer
                      "
                      aria-labelledby="pine-quick-composer-setting"
                      @update:model-value="updateQuickComposer"
                    />
                  </Field>

                  <Field
                    v-if="supportsRunInBackground"
                    orientation="horizontal"
                  >
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-run-in-background-setting">
                        {{ t("preferences.runInBackground") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{ t(runInBackgroundDescriptionKey) }}
                      </FieldDescription>
                    </div>
                    <Switch
                      data-testid="pine-run-in-background-toggle"
                      :model-value="runInBackground"
                      :disabled="
                        isLoadingRunInBackground || isSavingRunInBackground
                      "
                      aria-labelledby="pine-run-in-background-setting"
                      @update:model-value="updateRunInBackground"
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <div class="flex min-w-0 flex-1 items-baseline gap-2">
                      <FieldLabel for="pine-diagnostic-logging-toggle">
                        {{ t("preferences.diagnosticLogging") }}
                      </FieldLabel>
                      <HelpHint :label="t('preferences.diagnosticLoggingHelp')">
                        {{ t("preferences.diagnosticLoggingDescription") }}
                      </HelpHint>
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
              </FieldSet>
            </FieldGroup>
          </div>
          <div
            v-else-if="activeSection === 'appearance'"
            class="p-6 max-sm:px-4"
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.theme") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
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

                  <Field orientation="responsive">
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
                            backgroundColor:
                              selectedPineColorThemeOption?.swatch,
                          }"
                        />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" align="end">
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
                              {{
                                t(`projects.editor.colorThemes.${option.value}`)
                              }}
                            </span>
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field
                    v-if="supportsSidebarVibrancy"
                    orientation="horizontal"
                  >
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
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.reading") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="horizontal">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-invert-documents-setting">
                        {{ t("preferences.invertDocuments") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{ t("preferences.invertDocumentsDescription") }}
                      </FieldDescription>
                    </div>
                    <Switch
                      data-testid="pine-invert-documents-toggle"
                      :model-value="appearanceStore.invertDocuments"
                      aria-labelledby="pine-invert-documents-setting"
                      @update:model-value="appearanceStore.setInvertDocuments"
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </div>
          <div v-else-if="activeSection === 'models'" class="p-6 max-sm:px-4">
            <FieldGroup>
              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.modelCatalog") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
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
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.modelRoles") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
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

                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-approval-model-setting">
                        {{ t("preferences.approvalModel") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{
                          approvalSelectedModel?.name ??
                          utilitySelectedModel?.name ??
                          t("preferences.noUtilityModelSelected")
                        }}
                      </FieldDescription>
                    </div>
                    <Button
                      data-testid="pine-approval-model-button"
                      variant="outline"
                      size="sm"
                      aria-labelledby="pine-approval-model-setting"
                      @click="isApprovalModelPickerOpen = true"
                    >
                      {{ t("preferences.selectUtilityModel") }}
                    </Button>
                  </Field>

                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-image-model-setting">
                        {{ t("preferences.imageModel") }}
                      </FieldTitle>
                      <FieldDescription>{{
                        imageModelSummary
                      }}</FieldDescription>
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

                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-video-model-setting">
                        {{ t("preferences.videoModel") }}
                      </FieldTitle>
                      <FieldDescription>{{
                        videoModelSummary
                      }}</FieldDescription>
                    </div>
                    <Button
                      data-testid="pine-video-model-button"
                      variant="outline"
                      size="sm"
                      aria-labelledby="pine-video-model-setting"
                      @click="isVideoModelPickerOpen = true"
                    >
                      {{ t("preferences.selectVideoModel") }}
                    </Button>
                  </Field>

                  <DecisionsModelSettings />
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </div>
          <div v-else-if="activeSection === 'agent'" class="p-6 max-sm:px-4">
            <FieldGroup>
              <Field orientation="horizontal">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldTitle id="pine-interactive-answers-setting">
                    {{ t("preferences.interactiveAnswers") }}
                  </FieldTitle>
                  <FieldDescription id="pine-interactive-answers-description">
                    {{ t("preferences.interactiveAnswersDescription") }}
                  </FieldDescription>
                </div>
                <span class="text-sm text-muted-foreground" aria-hidden="true">
                  {{
                    profileDraft.interactiveAnswersEnabled
                      ? t("preferences.interactiveAnswersEnabled")
                      : t("preferences.interactiveAnswersDisabled")
                  }}
                </span>
                <Switch
                  v-model="profileDraft.interactiveAnswersEnabled"
                  data-testid="pine-interactive-answers-toggle"
                  :disabled="!hasHydratedProfile"
                  aria-labelledby="pine-interactive-answers-setting"
                  aria-describedby="pine-interactive-answers-description"
                />
              </Field>

              <FieldSeparator />
              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.permissions") }}</FieldLegend
                >
                <FieldGroup>
                  <AutoApprovalSettings />
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.context") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 items-baseline gap-2">
                      <FieldTitle id="pine-context-compaction-strategy-setting">
                        {{ t("preferences.contextCompactionStrategy") }}
                      </FieldTitle>
                      <HelpHint
                        :label="t('preferences.contextCompactionStrategyHelp')"
                      >
                        {{
                          t("preferences.contextCompactionStrategyDescription")
                        }}
                      </HelpHint>
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

                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 items-baseline gap-2">
                      <FieldTitle id="pine-context-compaction-route-setting">
                        {{ t("preferences.contextCompactionRoute") }}
                      </FieldTitle>
                      <HelpHint
                        :label="t('preferences.contextCompactionRouteHelp')"
                      >
                        {{ t("preferences.contextCompactionRouteDescription") }}
                      </HelpHint>
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
                </FieldGroup>
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend
                  variant="label"
                  class="text-xs text-muted-foreground"
                  >{{ t("preferences.groups.tools") }}</FieldLegend
                >
                <FieldGroup>
                  <Field orientation="responsive">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <FieldTitle id="pine-tinyfish-credential-setting">
                          {{ t("preferences.tinyFish") }}
                        </FieldTitle>
                        <Badge
                          v-if="isTinyFishCredentialConfigured"
                          data-testid="pine-tinyfish-credential-status"
                          variant="secondary"
                          class="text-emerald-700 dark:text-emerald-400"
                        >
                          <CheckIcon aria-hidden="true" />
                          {{ t("preferences.tinyFishConfigured") }}
                        </Badge>
                        <Badge
                          v-else
                          data-testid="pine-tinyfish-credential-status"
                          variant="outline"
                          class="text-muted-foreground"
                        >
                          {{ t("preferences.tinyFishNotConfigured") }}
                        </Badge>
                      </div>
                      <FieldDescription>
                        {{
                          isTinyFishCredentialConfigured
                            ? t("preferences.tinyFishConfiguredDescription")
                            : t("preferences.tinyFishDescription")
                        }}
                      </FieldDescription>
                    </div>
                    <Button
                      data-testid="pine-tinyfish-credential-button"
                      :variant="
                        isTinyFishCredentialConfigured ? 'outline' : 'default'
                      "
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
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <FieldTitle id="pine-approximate-location-setting">
                        {{ t("preferences.approximateLocation") }}
                      </FieldTitle>
                      <FieldDescription>
                        {{ t("preferences.approximateLocationDescription") }}
                      </FieldDescription>
                    </div>
                    <Switch
                      data-testid="pine-approximate-location-toggle"
                      :model-value="approximateLocationEnabled"
                      :disabled="
                        isLoadingApproximateLocation ||
                        isSavingApproximateLocation
                      "
                      aria-labelledby="pine-approximate-location-setting"
                      @update:model-value="updateApproximateLocation"
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </div>
          <div v-else-if="activeSection === 'projects'" class="p-6 max-sm:px-4">
            <ProjectManagementSettings />
          </div>
          <div v-else-if="activeSection === 'remote'" class="p-6 max-sm:px-4">
            <RelayRemoteSettings v-if="hasRelayRemote" />
            <FieldSeparator v-if="hasRelayRemote" class="my-6" />
            <RemoteControlSettings />
            <FieldSeparator v-if="hasWeChatRemote" class="my-6" />
            <WeChatRemoteSettings v-if="hasWeChatRemote" />
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
  <ModelPickerDialog
    v-model:open="isApprovalModelPickerOpen"
    purpose="approval"
  />

  <ModelPickerDialog v-model:open="isImageModelPickerOpen" purpose="image" />
  <ModelPickerDialog v-model:open="isVideoModelPickerOpen" purpose="video" />
</template>

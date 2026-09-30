<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
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
import { CommandDialog, CommandInput } from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import type {
  PineDecisionsModelDescriptor,
  PineImageModelDescriptor,
  PineModelDescriptor,
  PineProviderDescriptor,
} from "@/shared/models";
import { useAutoApprovalStore } from "@/stores/autoApproval";
import { useModelsStore } from "@/stores/models";
import CustomModelDialog from "./CustomModelDialog.vue";
import CustomProviderDialog from "./CustomProviderDialog.vue";
import ModelPickerList from "./ModelPickerList.vue";
import ProviderAuthDialog from "./ProviderAuthDialog.vue";

type PickerView = "models" | "providers";

const props = withDefaults(
  defineProps<{
    open: boolean;
    purpose?: "session" | "utility" | "image" | "decisions";
    sessionId?: string;
  }>(),
  { purpose: "session" },
);
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18n();
const modelsStore = useModelsStore();
const autoApprovalStore = useAutoApprovalStore();
const isDecisionsPurpose = computed(() => props.purpose === "decisions");
const isImagePurpose = computed(() => props.purpose === "image");
const view = ref<PickerView>("models");
const isAuthOpen = ref(false);
const selectedProvider = ref<PineProviderDescriptor | null>(null);
const disconnectingProvider = ref<PineProviderDescriptor | null>(null);
const isDisconnectDialogOpen = ref(false);
const isDisconnecting = ref(false);
const isCustomModelOpen = ref(false);
const isCustomProviderOpen = ref(false);
const editingCustomModel = ref<PineModelDescriptor | null>(null);
const editingCustomProvider = ref<PineProviderDescriptor | null>(null);
const customDeleteTarget = ref<
  | { kind: "model"; model: PineModelDescriptor }
  | { kind: "provider"; provider: PineProviderDescriptor }
  | null
>(null);
const isCustomDeleteDialogOpen = ref(false);
const isDeletingCustom = ref(false);
const favoriteModelKeysAtOpen = ref<readonly string[]>([]);
const title = computed(() =>
  view.value === "providers"
    ? t("providers.picker.title")
    : isDecisionsPurpose.value
      ? t("models.picker.decisionsTitle")
      : isImagePurpose.value
        ? t("models.picker.imageTitle")
        : t("models.picker.title"),
);
const description = computed(() =>
  view.value === "providers"
    ? t("providers.picker.description")
    : isDecisionsPurpose.value
      ? t("models.picker.decisionsDescription")
      : isImagePurpose.value
        ? t("models.picker.imageDescription")
        : t("models.picker.description"),
);
const searchPlaceholder = computed(() =>
  view.value === "providers"
    ? t("providers.picker.searchPlaceholder")
    : isDecisionsPurpose.value
      ? t("models.picker.decisionsSearchPlaceholder")
      : isImagePurpose.value
        ? t("models.picker.imageSearchPlaceholder")
        : t("models.picker.searchPlaceholder"),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    view.value = "models";
    favoriteModelKeysAtOpen.value = modelsStore.favoriteModelKeysSnapshot();
    void modelsStore.load();
  },
);

function canConfigure(provider: PineProviderDescriptor): boolean {
  return provider.authMethods.length > 0;
}

function selectProvider(provider: PineProviderDescriptor): void {
  if (provider.isCustom) return;
  if (!canConfigure(provider)) return;
  void openAuth(provider);
}

async function openAuth(provider: PineProviderDescriptor): Promise<void> {
  selectedProvider.value = provider;
  emit("update:open", false);
  await nextTick();
  isAuthOpen.value = true;
}

async function openCustomModel(): Promise<void> {
  editingCustomModel.value = null;
  emit("update:open", false);
  await nextTick();
  isCustomModelOpen.value = true;
}

async function openCustomModelEditor(
  model: PineModelDescriptor,
): Promise<void> {
  editingCustomModel.value = model;
  emit("update:open", false);
  await nextTick();
  isCustomModelOpen.value = true;
}

async function openCustomProviderEditor(
  provider: PineProviderDescriptor,
): Promise<void> {
  editingCustomProvider.value = provider;
  emit("update:open", false);
  await nextTick();
  isCustomProviderOpen.value = true;
}

async function customModelOpenChanged(open: boolean): Promise<void> {
  isCustomModelOpen.value = open;
  if (open) return;
  editingCustomModel.value = null;
  await nextTick();
  emit("update:open", true);
}

async function handleCustomModelSaved(): Promise<void> {
  view.value = "models";
  editingCustomModel.value = null;
  isCustomModelOpen.value = false;
  await nextTick();
  emit("update:open", true);
}

async function customProviderOpenChanged(open: boolean): Promise<void> {
  isCustomProviderOpen.value = open;
  if (open) return;
  editingCustomProvider.value = null;
  await nextTick();
  emit("update:open", true);
}

async function handleCustomProviderSaved(): Promise<void> {
  view.value = "providers";
  editingCustomProvider.value = null;
  isCustomProviderOpen.value = false;
  await nextTick();
  emit("update:open", true);
}

async function selectModel(model: PineModelDescriptor): Promise<void> {
  try {
    if (props.purpose === "utility") {
      await modelsStore.selectUtilityModel(model);
    } else {
      await modelsStore.select(model, undefined, props.sessionId);
    }
    emit("update:open", false);
  } catch (error) {
    if (props.purpose !== "utility") throw error;
    handleError(error, {
      id: "preferences.utility-model",
      title: t("errors.utilityModel.title"),
      description: t("errors.utilityModel.description"),
    });
  }
}

async function selectImageModel(
  model: PineImageModelDescriptor,
): Promise<void> {
  try {
    await modelsStore.selectImageModel(model);
    emit("update:open", false);
  } catch (error) {
    handleError(error, {
      id: "preferences.image-model",
      title: t("errors.imageModel.title"),
      description: t("errors.imageModel.description"),
    });
  }
}

async function selectDecisionsModel(
  model: PineDecisionsModelDescriptor,
): Promise<void> {
  try {
    await autoApprovalStore.load();
    await autoApprovalStore.save({
      ...autoApprovalStore.settings,
      decisionsModel: model.id,
    });
    emit("update:open", false);
  } catch (error) {
    handleError(error, {
      id: "preferences.decisions-model",
      title: t("errors.autoApprovalSettings.title"),
      description: t("errors.autoApprovalSettings.description"),
    });
  }
}

function requestDisconnect(provider: PineProviderDescriptor): void {
  disconnectingProvider.value = provider;
  isDisconnectDialogOpen.value = true;
}

function requestCustomDelete(
  target:
    | { kind: "model"; model: PineModelDescriptor }
    | { kind: "provider"; provider: PineProviderDescriptor },
): void {
  customDeleteTarget.value = target;
  isCustomDeleteDialogOpen.value = true;
}

function customDeleteDialogOpenChanged(open: boolean): void {
  isCustomDeleteDialogOpen.value = open;
  if (open) return;
  queueMicrotask(() => {
    if (!isCustomDeleteDialogOpen.value && !isDeletingCustom.value) {
      customDeleteTarget.value = null;
    }
  });
}

async function deleteCustomTarget(): Promise<void> {
  const target = customDeleteTarget.value;
  if (!target || isDeletingCustom.value) return;
  isDeletingCustom.value = true;
  try {
    if (target.kind === "model") {
      await modelsStore.deleteCustomModel({
        modelId: target.model.id,
        providerId: target.model.providerId,
      });
    } else {
      await modelsStore.deleteCustomProvider({
        providerId: target.provider.id,
      });
    }
    isCustomDeleteDialogOpen.value = false;
    customDeleteTarget.value = null;
  } catch (error) {
    handleError(error, {
      id: `models.delete-custom.${target.kind}`,
      title: t("errors.customDelete.title"),
      description: t("errors.customDelete.description"),
    });
  } finally {
    isDeletingCustom.value = false;
    if (!isCustomDeleteDialogOpen.value) customDeleteTarget.value = null;
  }
}

function disconnectDialogOpenChanged(open: boolean): void {
  isDisconnectDialogOpen.value = open;
  if (open) return;

  queueMicrotask(() => {
    if (!isDisconnectDialogOpen.value && !isDisconnecting.value) {
      disconnectingProvider.value = null;
    }
  });
}

async function disconnectProvider(): Promise<void> {
  const provider = disconnectingProvider.value;
  if (!provider || isDisconnecting.value) return;

  isDisconnecting.value = true;
  try {
    await modelsStore.logout(provider.id);
    isDisconnectDialogOpen.value = false;
    disconnectingProvider.value = null;
  } catch (error) {
    handleError(error, {
      id: `provider.disconnect.${provider.id}`,
      title: t("errors.providerDisconnect.title"),
      description: t("errors.providerDisconnect.description"),
    });
  } finally {
    isDisconnecting.value = false;
    if (!isDisconnectDialogOpen.value) disconnectingProvider.value = null;
  }
}

async function handleConnected(): Promise<void> {
  isAuthOpen.value = false;
  selectedProvider.value = null;
  await nextTick();
  emit("update:open", true);
}
</script>

<template>
  <CommandDialog
    :open="open"
    :title="title"
    :description="description"
    class="top-1/2 -translate-y-1/2"
    @update:open="emit('update:open', $event)"
  >
    <CommandInput :placeholder="searchPlaceholder" />
    <ModelPickerList
      :favorite-keys="favoriteModelKeysAtOpen"
      :purpose="purpose"
      :session-id="sessionId"
      :view="view"
      @add-custom-model="openCustomModel"
      @delete-custom-model="
        (model) => requestCustomDelete({ kind: 'model', model })
      "
      @delete-custom-provider="
        (provider) => requestCustomDelete({ kind: 'provider', provider })
      "
      @disconnect-provider="requestDisconnect"
      @edit-custom-model="openCustomModelEditor"
      @edit-custom-provider="openCustomProviderEditor"
      @select-decisions-model="selectDecisionsModel"
      @select-image-model="selectImageModel"
      @select-model="selectModel"
      @select-provider="selectProvider"
      @select-view="view = $event"
    />
  </CommandDialog>

  <ProviderAuthDialog
    v-model:open="isAuthOpen"
    :provider="selectedProvider"
    @connected="handleConnected"
  />

  <CustomModelDialog
    :open="isCustomModelOpen"
    :model="editingCustomModel"
    @update:open="customModelOpenChanged"
    @saved="handleCustomModelSaved"
  />

  <CustomProviderDialog
    :open="isCustomProviderOpen"
    :provider="editingCustomProvider"
    @update:open="customProviderOpenChanged"
    @saved="handleCustomProviderSaved"
  />

  <AlertDialog
    :open="isDisconnectDialogOpen"
    @update:open="disconnectDialogOpenChanged"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{
            t("providers.disconnectTitle", {
              provider: disconnectingProvider?.name ?? "",
            })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("providers.disconnectDescription", {
              provider: disconnectingProvider?.name ?? "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDisconnecting">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-provider-disconnect"
          variant="destructive"
          :disabled="isDisconnecting"
          @click.prevent="disconnectProvider"
        >
          <Spinner v-if="isDisconnecting" data-icon="inline-start" />
          {{ t("providers.disconnectConfirm") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <AlertDialog
    :open="isCustomDeleteDialogOpen"
    @update:open="customDeleteDialogOpenChanged"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{
            customDeleteTarget?.kind === "provider"
              ? t("providers.custom.deleteTitle", {
                  provider: customDeleteTarget.provider.name,
                })
              : t("models.picker.deleteCustomModelTitle", {
                  model: customDeleteTarget?.model.name ?? "",
                })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            customDeleteTarget?.kind === "provider"
              ? t("providers.custom.deleteDescription", {
                  provider: customDeleteTarget.provider.name,
                })
              : t("models.picker.deleteCustomModelDescription", {
                  model: customDeleteTarget?.model.name ?? "",
                })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeletingCustom">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-custom-delete"
          variant="destructive"
          :disabled="isDeletingCustom"
          @click.prevent="deleteCustomTarget"
        >
          <Spinner v-if="isDeletingCustom" data-icon="inline-start" />
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

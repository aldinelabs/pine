<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type {
  PiProviderSkipReason,
  PiProvidersFileError,
  PiProvidersStatus,
} from "@/shared/piProviders";
import { useModelsStore } from "@/stores/models";

const REASON_KEYS: Record<PiProviderSkipReason, string> = {
  "command-value": "commandValue",
  "no-models": "noModels",
  "missing-base-url": "missingBaseUrl",
  "missing-api": "missingApi",
  conflict: "conflict",
  invalid: "invalid",
};
const ERROR_KEYS: Record<PiProvidersFileError, string> = {
  "too-large": "tooLarge",
  "invalid-json": "invalidJson",
  unreadable: "unreadable",
};

const { t } = useI18n();
const modelsStore = useModelsStore();
const status = ref<PiProvidersStatus>();
const isSaving = ref(false);

const summary = computed(() => {
  const current = status.value;
  if (!current) return "";
  if (current.error)
    return t(`preferences.piProviders.error.${ERROR_KEYS[current.error]}`);
  if (!current.found) return t("preferences.piProviders.notFound");
  if (!current.enabled) return t("preferences.piProviders.off");
  return t("preferences.piProviders.count", { count: current.count });
});

function reportError(error: unknown, action: "load" | "save"): void {
  handleError(error, {
    id: `preferences.piProviders.${action}`,
    title: t(`errors.piProviders.${action}Title`),
    description: t("errors.piProviders.description"),
  });
}

async function apply(next: Promise<PiProvidersStatus | undefined>) {
  isSaving.value = true;
  try {
    const result = await next;
    if (result) {
      status.value = result;
      await modelsStore.load();
    }
  } catch (error) {
    reportError(error, "save");
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  try {
    status.value = await window.pine.getPiProviders!();
  } catch (error) {
    reportError(error, "load");
  }
});

function setEnabled(enabled: boolean): void {
  if (!status.value || enabled === status.value.enabled || isSaving.value) {
    return;
  }
  void apply(window.pine.setPiProviders!({ enabled }));
}

function chooseFolder(): void {
  void apply(window.pine.pickPiAgentDir!().then((result) => result.status));
}

function useDefaultFolder(): void {
  if (!status.value) return;
  void apply(
    window.pine.setPiProviders!({
      enabled: status.value.enabled,
      agentDir: null,
    }),
  );
}

async function reveal(): Promise<void> {
  try {
    await window.pine.revealPiProviders!();
  } catch (error) {
    reportError(error, "load");
  }
}
</script>

<template>
  <FieldSet data-testid="pi-providers-settings">
    <FieldLegend variant="label" class="text-xs text-muted-foreground">
      {{ t("preferences.piProviders.group") }}
    </FieldLegend>
    <FieldGroup>
      <Field orientation="horizontal">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-pi-providers-setting">
            {{ t("preferences.piProviders.title") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.piProviders.description") }}
          </FieldDescription>
        </div>
        <Skeleton v-if="!status" class="h-5 w-8 rounded-2xl" />
        <Switch
          v-else
          data-testid="pine-pi-providers-switch"
          :model-value="status.enabled"
          :disabled="isSaving"
          aria-labelledby="pine-pi-providers-setting"
          @update:model-value="(value: boolean) => setEnabled(value)"
        />
      </Field>

      <Field orientation="responsive">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-pi-providers-file">
            {{ t("preferences.piProviders.file") }}
          </FieldTitle>
          <template v-if="status">
            <FieldDescription
              class="break-all font-mono text-xs"
              data-testid="pine-pi-providers-path"
            >
              {{ status.path }}
            </FieldDescription>
            <FieldDescription data-testid="pine-pi-providers-summary">
              {{ summary }}
            </FieldDescription>
            <FieldDescription
              v-for="skip in status.enabled ? status.skipped : []"
              :key="skip.key"
              data-testid="pine-pi-providers-skipped"
            >
              {{
                t("preferences.piProviders.skipped", {
                  key: skip.key,
                  reason: t(
                    `preferences.piProviders.reason.${REASON_KEYS[skip.reason]}`,
                  ),
                })
              }}
            </FieldDescription>
          </template>
          <template v-else>
            <Skeleton class="h-4 w-full max-w-80" />
            <Skeleton class="h-4 w-40" />
          </template>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            data-testid="pine-pi-providers-reveal"
            variant="outline"
            size="sm"
            :disabled="!status"
            @click="reveal"
          >
            {{ t("preferences.piProviders.reveal") }}
          </Button>
          <Button
            data-testid="pine-pi-providers-choose"
            variant="outline"
            size="sm"
            :disabled="!status || isSaving"
            @click="chooseFolder"
          >
            {{ t("preferences.piProviders.choose") }}
          </Button>
          <Button
            v-if="status?.agentDirSource === 'setting'"
            data-testid="pine-pi-providers-default"
            variant="ghost"
            size="sm"
            :disabled="isSaving"
            @click="useDefaultFolder"
          >
            {{ t("preferences.piProviders.useDefault") }}
          </Button>
        </div>
      </Field>
    </FieldGroup>
  </FieldSet>
</template>

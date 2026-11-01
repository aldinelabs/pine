<script setup lang="ts">
import { CopyIcon, ExternalLinkIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_WEB_PORT, type WebServerStatus } from "@/shared/webControl";

const MIN_PORT = 1024;
const MAX_PORT = 65535;

const { t } = useI18n();
const status = ref<WebServerStatus>({ enabled: false, port: DEFAULT_WEB_PORT });
const portDraft = ref(String(DEFAULT_WEB_PORT));
const isLoading = ref(true);
const isSaving = ref(false);

const isBusy = computed(() => isLoading.value || isSaving.value);
const draftPort = computed(() =>
  /^\d+$/.test(portDraft.value.trim()) ? Number(portDraft.value) : NaN,
);
const isPortValid = computed(
  () => draftPort.value >= MIN_PORT && draftPort.value <= MAX_PORT,
);
const address = computed(() => `http://127.0.0.1:${status.value.port}`);

onMounted(async () => {
  try {
    applyStatus(await window.pine.getWebServer!());
  } catch (error) {
    handleError(error, {
      id: "preferences.remoteControl.load",
      title: t("errors.remoteControl.loadTitle"),
      description: t("errors.remoteControl.description"),
    });
  } finally {
    isLoading.value = false;
  }
});

function applyStatus(next: WebServerStatus): void {
  status.value = next;
  portDraft.value = String(next.port);
}

function failureDescription(error: unknown, port: number): string {
  const message = error instanceof Error ? error.message : String(error);
  return /EADDRINUSE/.test(message)
    ? t("errors.remoteControl.portInUse", { port })
    : t("errors.remoteControl.description");
}

async function configure(enabled: boolean, port: number): Promise<void> {
  if (isBusy.value) return;
  isSaving.value = true;
  try {
    applyStatus(await window.pine.setWebServer!({ enabled, port }));
  } catch (error) {
    portDraft.value = String(status.value.port);
    handleError(error, {
      id: "preferences.remoteControl.save",
      title: t("errors.remoteControl.saveTitle"),
      description: failureDescription(error, port),
    });
  } finally {
    isSaving.value = false;
  }
}

function updateEnabled(enabled: boolean): void {
  if (enabled !== status.value.enabled)
    void configure(enabled, status.value.port);
}

function commitPort(): void {
  if (!isPortValid.value || draftPort.value === status.value.port) return;
  void configure(status.value.enabled, draftPort.value);
}

async function copyLink(): Promise<void> {
  if (!status.value.url) return;
  await navigator.clipboard.writeText(status.value.url);
  toast.success(t("preferences.remoteControl.linkCopied"));
}

async function openInBrowser(): Promise<void> {
  if (status.value.url) await window.pine.openExternalUrl(status.value.url);
}
</script>

<template>
  <FieldGroup data-testid="remote-control-settings">
    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-browser-access-setting">
          {{ t("preferences.remoteControl.browserAccess") }}
        </FieldTitle>
        <FieldDescription>
          {{
            status.enabled
              ? t("preferences.remoteControl.browserAccessRunning", {
                  address,
                })
              : t("preferences.remoteControl.browserAccessDescription")
          }}
        </FieldDescription>
        <FieldError v-if="status.error">
          {{ status.error }}
        </FieldError>
      </div>
      <Switch
        data-testid="pine-browser-access-toggle"
        :model-value="status.enabled"
        :disabled="isBusy"
        aria-labelledby="pine-browser-access-setting"
        @update:model-value="updateEnabled"
      />
    </Field>

    <Field
      orientation="horizontal"
      :data-invalid="isPortValid ? undefined : true"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-browser-access-port-setting">
          {{ t("preferences.remoteControl.port") }}
        </FieldTitle>
        <FieldError v-if="!isPortValid">
          {{
            t("preferences.remoteControl.invalidPort", {
              min: MIN_PORT,
              max: MAX_PORT,
            })
          }}
        </FieldError>
        <FieldDescription v-else>
          {{ t("preferences.remoteControl.portDescription") }}
        </FieldDescription>
      </div>
      <Input
        v-model="portDraft"
        data-testid="pine-browser-access-port"
        inputmode="numeric"
        autocomplete="off"
        class="w-24"
        :disabled="isBusy"
        :aria-invalid="isPortValid ? undefined : true"
        aria-labelledby="pine-browser-access-port-setting"
        @change="commitPort"
        @keydown.enter.prevent="commitPort"
      />
    </Field>

    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle>
          {{ t("preferences.remoteControl.accessLink") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.remoteControl.accessLinkDescription") }}
        </FieldDescription>
      </div>
      <div class="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="pine-browser-access-copy"
          :disabled="!status.url"
          @click="copyLink"
        >
          <CopyIcon data-icon="inline-start" />
          {{ t("preferences.remoteControl.copyLink") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="pine-browser-access-open"
          :disabled="!status.url"
          @click="openInBrowser"
        >
          <ExternalLinkIcon data-icon="inline-start" />
          {{ t("preferences.remoteControl.open") }}
        </Button>
      </div>
    </Field>
  </FieldGroup>
</template>

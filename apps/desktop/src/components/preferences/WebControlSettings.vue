<script setup lang="ts">
import { Check, Copy, ExternalLink } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_WEB_PORT, type WebServerStatus } from "@/shared/webControl";

const MIN_PORT = 1024;
const MAX_PORT = 65535;

const { t } = useI18n();
const status = ref<WebServerStatus>({ enabled: false, port: DEFAULT_WEB_PORT });
const portDraft = ref(String(DEFAULT_WEB_PORT));
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const busy = computed(() => loading.value || saving.value);
const draftPort = computed(() =>
  /^\d+$/.test(portDraft.value.trim()) ? Number(portDraft.value) : NaN,
);
const portValid = computed(
  () => draftPort.value >= MIN_PORT && draftPort.value <= MAX_PORT,
);
const portChanged = computed(() => draftPort.value !== status.value.port);
const address = computed(() => `http://127.0.0.1:${status.value.port}`);
// The panel also stays open after a failed start, so the port can be fixed.
const showDetails = computed(() => status.value.enabled || !!error.value);

watch(
  () => status.value.port,
  (port) => {
    portDraft.value = String(port);
  },
);

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

onMounted(async () => {
  try {
    status.value = await window.pine.getWebServer!();
    error.value = status.value.error ?? "";
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    loading.value = false;
  }
});

async function configure(enabled: boolean, port: number): Promise<void> {
  if (busy.value) return;
  saving.value = true;
  error.value = "";
  try {
    status.value = await window.pine.setWebServer!({ enabled, port });
    error.value = status.value.error ?? "";
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    saving.value = false;
  }
}

function toggle(enabled: boolean): void {
  void configure(
    enabled,
    portValid.value ? draftPort.value : status.value.port,
  );
}

function applyPort(): void {
  if (!portValid.value || !portChanged.value) return;
  // Applying a port from this panel means the service should be running.
  void configure(true, draftPort.value);
}

async function copyLink(): Promise<void> {
  if (!status.value.url) return;
  await navigator.clipboard.writeText(status.value.url);
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 1600);
}

async function openInBrowser(): Promise<void> {
  if (status.value.url) await window.pine.openExternalUrl(status.value.url);
}
</script>

<template>
  <div data-testid="web-control-settings" class="flex flex-col gap-3">
    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-web-access-label">
          {{ t("preferences.webControl.title") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.webControl.description") }}
        </FieldDescription>
      </div>
      <Spinner v-if="saving" class="text-muted-foreground" />
      <Switch
        data-testid="pine-web-access-toggle"
        :model-value="status.enabled"
        :disabled="busy"
        aria-labelledby="pine-web-access-label"
        @update:model-value="toggle"
      />
    </Field>

    <div
      v-if="showDetails"
      data-testid="web-control-details"
      class="flex flex-col gap-4 rounded-lg border bg-muted/40 p-4"
    >
      <div v-if="status.enabled" class="flex items-center gap-3">
        <span class="relative flex size-2 shrink-0" aria-hidden="true">
          <span
            class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60"
          />
          <span
            class="relative inline-flex size-2 rounded-full bg-emerald-500"
          />
        </span>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm font-medium">
            {{ t("preferences.webControl.running") }}
          </span>
          <span
            data-testid="web-control-address"
            class="truncate font-mono text-xs text-muted-foreground"
          >
            {{ address }}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="web-control-copy"
          :disabled="!status.url"
          @click="copyLink"
        >
          <Check v-if="copied" data-icon="inline-start" />
          <Copy v-else data-icon="inline-start" />
          {{
            copied
              ? t("preferences.webControl.copied")
              : t("preferences.webControl.copyLink")
          }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="web-control-open"
          :disabled="!status.url"
          @click="openInBrowser"
        >
          <ExternalLink data-icon="inline-start" />
          {{ t("preferences.webControl.open") }}
        </Button>
      </div>

      <Field
        orientation="horizontal"
        :data-invalid="!portValid ? true : undefined"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldLabel for="pine-web-port">
            {{ t("preferences.webControl.port") }}
          </FieldLabel>
          <FieldError v-if="!portValid">
            {{
              t("preferences.webControl.invalidPort", {
                min: MIN_PORT,
                max: MAX_PORT,
              })
            }}
          </FieldError>
        </div>
        <form class="w-40 shrink-0" @submit.prevent="applyPort">
          <InputGroup>
            <InputGroupInput
              id="pine-web-port"
              v-model="portDraft"
              inputmode="numeric"
              autocomplete="off"
              class="font-mono"
              :disabled="busy"
              :aria-invalid="!portValid ? true : undefined"
            />
            <InputGroupAddon v-if="portChanged" align="inline-end">
              <InputGroupButton
                type="submit"
                variant="secondary"
                data-testid="web-control-apply-port"
                :disabled="busy || !portValid"
              >
                {{ t("preferences.webControl.apply") }}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </Field>

      <FieldError v-if="error" data-testid="web-control-error">
        {{ error }}
      </FieldError>
      <FieldDescription v-else-if="status.enabled">
        {{ t("preferences.webControl.linkNotice") }}
      </FieldDescription>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_WEB_PORT, type WebServerStatus } from "@/shared/webControl";

const { t } = useI18n();
const status = ref<WebServerStatus>({ enabled: false, port: DEFAULT_WEB_PORT });
const port = ref(String(DEFAULT_WEB_PORT));
const busy = ref(true);
const error = ref("");
const validPort = computed(
  () =>
    /^\d+$/.test(port.value) &&
    Number(port.value) >= 1024 &&
    Number(port.value) <= 65535,
);
const address = computed(() => `http://127.0.0.1:${status.value.port}`);

onMounted(async () => {
  try {
    if (!window.pine.getWebServer) return;
    status.value = await window.pine.getWebServer();
    port.value = String(status.value.port);
    error.value = status.value.error ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
});

async function save(enabled: boolean): Promise<void> {
  if (busy.value || (enabled && !validPort.value) || !window.pine.setWebServer)
    return;
  busy.value = true;
  error.value = "";
  try {
    status.value = await window.pine.setWebServer({
      enabled,
      port: validPort.value ? Number(port.value) : status.value.port,
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function openBrowser(): Promise<void> {
  if (status.value.url) await window.pine.openExternalUrl(status.value.url);
}
</script>

<template>
  <FieldGroup data-testid="web-control-settings">
    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-web-access-label">{{
          t("preferences.webControl.title")
        }}</FieldTitle>
        <FieldDescription>{{
          t("preferences.webControl.description")
        }}</FieldDescription>
      </div>
      <Switch
        data-testid="pine-web-access-toggle"
        :model-value="status.enabled"
        :disabled="busy || (!status.enabled && !validPort)"
        aria-labelledby="pine-web-access-label"
        @update:model-value="save"
      />
    </Field>
    <Field :data-invalid="!validPort || undefined">
      <FieldLabel for="pine-web-port">{{
        t("preferences.webControl.port")
      }}</FieldLabel>
      <div class="flex items-center gap-2">
        <Input
          id="pine-web-port"
          v-model="port"
          type="number"
          min="1024"
          max="65535"
          :disabled="busy"
          :aria-invalid="!validPort"
          class="max-w-36"
          @keydown.enter.prevent="save(status.enabled)"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy || !validPort || Number(port) === status.port"
          @click="save(status.enabled)"
        >
          {{ t("preferences.webControl.apply") }}
        </Button>
      </div>
      <FieldDescription v-if="!validPort">{{
        t("preferences.webControl.invalidPort")
      }}</FieldDescription>
    </Field>
    <Field v-if="status.enabled">
      <FieldDescription>{{ address }}</FieldDescription>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="w-fit"
        :disabled="busy"
        @click="openBrowser"
      >
        {{ t("preferences.webControl.open") }}
      </Button>
    </Field>
    <FieldDescription v-if="error" role="alert">{{ error }}</FieldDescription>
  </FieldGroup>
</template>

<script setup lang="ts">
import { CopyIcon, ExternalLinkIcon, TriangleAlertIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_WEB_SERVER_SETTINGS,
  MIN_WEB_PASSWORD_LENGTH,
  WEB_REMEMBER_FOR,
  normalizeWebOrigin,
  type WebRememberFor,
  type WebServerSettings,
  type WebServerStatus,
} from "@/shared/webControl";

const MIN_PORT = 1024;
const MAX_PORT = 65535;

const { t } = useI18n();
const status = ref<WebServerStatus>({
  ...DEFAULT_WEB_SERVER_SETTINGS,
  hasPassword: false,
});
const portDraft = ref(String(DEFAULT_WEB_SERVER_SETTINGS.port));
const originDraft = ref("");
const isLoading = ref(true);
const isSaving = ref(false);
const isPasswordDialogOpen = ref(false);
const passwordDraft = ref("");
const confirmDraft = ref("");
const showPasswordErrors = ref(false);
/** Turning sign-in back on without a password first asks for one. */
const requireAfterPassword = ref(false);
const isDisableConfirmOpen = ref(false);

const isBusy = computed(() => isLoading.value || isSaving.value);
const draftPort = computed(() =>
  /^\d+$/.test(portDraft.value.trim()) ? Number(portDraft.value) : NaN,
);
const isPortValid = computed(
  () => draftPort.value >= MIN_PORT && draftPort.value <= MAX_PORT,
);
const draftOrigin = computed(() =>
  originDraft.value.trim()
    ? normalizeWebOrigin(originDraft.value)
    : ("" as const),
);
const isOriginValid = computed(() => draftOrigin.value !== undefined);
const needsPassword = computed(
  () => status.value.requirePassword && !status.value.hasPassword,
);
const localAddress = computed(() => status.value.addresses?.[0]);
const lanAddresses = computed(() =>
  (status.value.addresses ?? []).filter(
    (address) =>
      address !== localAddress.value &&
      address !== `${status.value.publicOrigin}/`,
  ),
);
const passwordError = computed(() => {
  if (passwordDraft.value.length < MIN_WEB_PASSWORD_LENGTH)
    return t("preferences.remoteControl.passwordTooShort", {
      min: MIN_WEB_PASSWORD_LENGTH,
    });
  if (passwordDraft.value !== confirmDraft.value)
    return t("preferences.remoteControl.passwordMismatch");
  return undefined;
});

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
  originDraft.value = next.publicOrigin ?? "";
}

function settings(): WebServerSettings {
  const { enabled, port, lan, rememberFor, requirePassword, publicOrigin } =
    status.value;
  return {
    enabled,
    port,
    lan,
    rememberFor,
    requirePassword,
    ...(publicOrigin ? { publicOrigin } : {}),
  };
}

function failureDescription(error: unknown, port: number): string {
  const message = error instanceof Error ? error.message : String(error);
  return /EADDRINUSE/.test(message)
    ? t("errors.remoteControl.portInUse", { port })
    : t("errors.remoteControl.description");
}

async function configure(patch: Partial<WebServerSettings>): Promise<void> {
  if (isBusy.value) return;
  const next = { ...settings(), ...patch };
  if (!next.publicOrigin) delete next.publicOrigin;
  isSaving.value = true;
  try {
    applyStatus(await window.pine.setWebServer!(next));
  } catch (error) {
    applyStatus(status.value);
    handleError(error, {
      id: "preferences.remoteControl.save",
      title: t("errors.remoteControl.saveTitle"),
      description: failureDescription(error, next.port),
    });
  } finally {
    isSaving.value = false;
  }
}

function updateEnabled(enabled: boolean): void {
  if (enabled !== status.value.enabled) void configure({ enabled });
}

function updateRequirePassword(requirePassword: boolean): void {
  if (requirePassword === status.value.requirePassword) return;
  if (!requirePassword) {
    isDisableConfirmOpen.value = true;
    return;
  }
  if (!status.value.hasPassword) {
    requireAfterPassword.value = true;
    openPasswordDialog();
    return;
  }
  void configure({ requirePassword: true });
}

function confirmDisablePassword(): void {
  void configure({ requirePassword: false, lan: false });
}

function updateRememberFor(rememberFor: unknown): void {
  if (
    WEB_REMEMBER_FOR.includes(rememberFor as WebRememberFor) &&
    rememberFor !== status.value.rememberFor
  )
    void configure({ rememberFor: rememberFor as WebRememberFor });
}

function updateLan(lan: boolean): void {
  if (lan !== status.value.lan) void configure({ lan });
}

function commitPort(): void {
  if (!isPortValid.value || draftPort.value === status.value.port) return;
  void configure({ port: draftPort.value });
}

function commitOrigin(): void {
  const origin = draftOrigin.value;
  if (origin === undefined || origin === (status.value.publicOrigin ?? ""))
    return;
  void configure({ publicOrigin: origin || undefined });
}

function openPasswordDialog(): void {
  passwordDraft.value = "";
  confirmDraft.value = "";
  showPasswordErrors.value = false;
  isPasswordDialogOpen.value = true;
}

function updatePasswordDialogOpen(open: boolean): void {
  isPasswordDialogOpen.value = open;
  if (!open) requireAfterPassword.value = false;
}

async function savePassword(): Promise<void> {
  showPasswordErrors.value = true;
  if (passwordError.value || isBusy.value) return;
  const requireNext = requireAfterPassword.value;
  isSaving.value = true;
  try {
    applyStatus(await window.pine.setWebPassword!(passwordDraft.value));
    toast.success(t("preferences.remoteControl.passwordSaved"));
    isPasswordDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "preferences.remoteControl.password",
      title: t("errors.remoteControl.passwordTitle"),
      description: t("errors.remoteControl.description"),
    });
    return;
  } finally {
    isSaving.value = false;
  }
  requireAfterPassword.value = false;
  if (requireNext) await configure({ requirePassword: true });
}

async function signOutBrowsers(): Promise<void> {
  if (isBusy.value) return;
  isSaving.value = true;
  try {
    applyStatus(await window.pine.signOutWebBrowsers!());
    toast.success(t("preferences.remoteControl.signedOut"));
  } catch (error) {
    handleError(error, {
      id: "preferences.remoteControl.signOut",
      title: t("errors.remoteControl.signOutTitle"),
      description: t("errors.remoteControl.description"),
    });
  } finally {
    isSaving.value = false;
  }
}

async function copyLink(): Promise<void> {
  if (!localAddress.value) return;
  await navigator.clipboard.writeText(localAddress.value);
  toast.success(t("preferences.remoteControl.linkCopied"));
}

async function openInBrowser(): Promise<void> {
  if (localAddress.value) await window.pine.openExternalUrl(localAddress.value);
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
            needsPassword
              ? t("preferences.remoteControl.browserAccessNeedsPassword")
              : status.enabled && localAddress
                ? t("preferences.remoteControl.browserAccessRunning", {
                    address: localAddress,
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
        :disabled="isBusy || (!status.enabled && needsPassword)"
        aria-labelledby="pine-browser-access-setting"
        @update:model-value="updateEnabled"
      />
    </Field>

    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle>
          {{ t("preferences.remoteControl.password") }}
        </FieldTitle>
        <FieldDescription>
          {{
            status.hasPassword
              ? t("preferences.remoteControl.passwordSet")
              : t("preferences.remoteControl.passwordNotSet")
          }}
        </FieldDescription>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="shrink-0"
        data-testid="pine-browser-access-password"
        :disabled="isBusy"
        @click="openPasswordDialog"
      >
        {{
          status.hasPassword
            ? t("preferences.remoteControl.changePassword")
            : t("preferences.remoteControl.setPassword")
        }}
      </Button>
    </Field>

    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-browser-access-require-setting">
          {{ t("preferences.remoteControl.requirePassword") }}
        </FieldTitle>
        <FieldDescription v-if="status.requirePassword">
          {{ t("preferences.remoteControl.requirePasswordDescription") }}
        </FieldDescription>
        <FieldError v-else>
          {{ t("preferences.remoteControl.requirePasswordOff") }}
        </FieldError>
      </div>
      <Switch
        data-testid="pine-browser-access-require-password"
        :model-value="status.requirePassword"
        :disabled="isBusy"
        aria-labelledby="pine-browser-access-require-setting"
        @update:model-value="updateRequirePassword"
      />
    </Field>

    <Field v-if="status.requirePassword" orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-browser-access-remember-setting">
          {{ t("preferences.remoteControl.rememberFor") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.remoteControl.rememberForDescription") }}
        </FieldDescription>
      </div>
      <Select
        :model-value="status.rememberFor"
        :disabled="isBusy"
        @update:model-value="updateRememberFor"
      >
        <SelectTrigger
          class="w-fit"
          data-testid="pine-browser-access-remember"
          aria-labelledby="pine-browser-access-remember-setting"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem
              v-for="option in WEB_REMEMBER_FOR"
              :key="option"
              :value="option"
            >
              {{ t(`preferences.remoteControl.remember.${option}`) }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>

    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-browser-access-lan-setting">
          {{ t("preferences.remoteControl.lan") }}
        </FieldTitle>
        <FieldDescription>
          {{
            status.requirePassword
              ? t("preferences.remoteControl.lanDescription")
              : t("preferences.remoteControl.lanNeedsPassword")
          }}
        </FieldDescription>
        <FieldDescription
          v-if="lanAddresses.length"
          class="font-mono text-xs break-all select-text"
          data-testid="pine-browser-access-lan-addresses"
        >
          {{ lanAddresses.join("  ") }}
        </FieldDescription>
      </div>
      <Switch
        data-testid="pine-browser-access-lan"
        :model-value="status.lan"
        :disabled="isBusy || !status.requirePassword"
        aria-labelledby="pine-browser-access-lan-setting"
        @update:model-value="updateLan"
      />
    </Field>

    <Field
      orientation="responsive"
      :data-invalid="isOriginValid ? undefined : true"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-browser-access-origin-setting">
          {{ t("preferences.remoteControl.publicOrigin") }}
        </FieldTitle>
        <FieldError v-if="!isOriginValid">
          {{ t("preferences.remoteControl.invalidPublicOrigin") }}
        </FieldError>
        <FieldDescription v-else>
          {{ t("preferences.remoteControl.publicOriginDescription") }}
        </FieldDescription>
      </div>
      <Input
        v-model="originDraft"
        data-testid="pine-browser-access-origin"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://pine.example.com"
        class="sm:w-56"
        :disabled="isBusy"
        :aria-invalid="isOriginValid ? undefined : true"
        aria-labelledby="pine-browser-access-origin-setting"
        @change="commitOrigin"
        @keydown.enter.prevent="commitOrigin"
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

    <Field orientation="responsive">
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
          :disabled="!localAddress"
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
          :disabled="!localAddress"
          @click="openInBrowser"
        >
          <ExternalLinkIcon data-icon="inline-start" />
          {{ t("preferences.remoteControl.open") }}
        </Button>
      </div>
    </Field>

    <Field
      v-if="status.requirePassword && status.hasPassword"
      orientation="responsive"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle>
          {{ t("preferences.remoteControl.signOut") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.remoteControl.signOutDescription") }}
        </FieldDescription>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="shrink-0"
        data-testid="pine-browser-access-sign-out"
        :disabled="isBusy"
        @click="signOutBrowsers"
      >
        {{ t("preferences.remoteControl.signOutAction") }}
      </Button>
    </Field>

    <Dialog
      :open="isPasswordDialogOpen"
      @update:open="updatePasswordDialogOpen"
    >
      <DialogContent class="sm:max-w-sm">
        <form class="contents" @submit.prevent="savePassword">
          <DialogHeader>
            <DialogTitle>
              {{
                status.hasPassword
                  ? t("preferences.remoteControl.changePassword")
                  : t("preferences.remoteControl.setPassword")
              }}
            </DialogTitle>
            <DialogDescription>
              {{ t("preferences.remoteControl.passwordDialogDescription") }}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field :data-invalid="showPasswordErrors && passwordError">
              <FieldLabel for="pine-browser-access-new-password">
                {{ t("preferences.remoteControl.newPassword") }}
              </FieldLabel>
              <Input
                id="pine-browser-access-new-password"
                v-model="passwordDraft"
                data-testid="pine-browser-access-new-password"
                type="password"
                autocomplete="new-password"
              />
            </Field>
            <Field :data-invalid="showPasswordErrors && passwordError">
              <FieldLabel for="pine-browser-access-confirm-password">
                {{ t("preferences.remoteControl.confirmPassword") }}
              </FieldLabel>
              <Input
                id="pine-browser-access-confirm-password"
                v-model="confirmDraft"
                data-testid="pine-browser-access-confirm-password"
                type="password"
                autocomplete="new-password"
              />
              <FieldError v-if="showPasswordErrors && passwordError">
                {{ passwordError }}
              </FieldError>
              <FieldDescription v-else-if="status.hasPassword">
                {{ t("preferences.remoteControl.changePasswordSignsOut") }}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="submit"
              data-testid="pine-browser-access-save-password"
              :disabled="isBusy"
            >
              {{ t("common.save") }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="isDisableConfirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia
            class="bg-destructive/10 text-destructive dark:bg-destructive/20"
          >
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {{ t("preferences.remoteControl.disablePasswordTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("preferences.remoteControl.disablePasswordDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          class="list-disc space-y-1 pl-5 text-sm text-muted-foreground"
          data-testid="pine-browser-access-disable-risks"
        >
          <li>
            {{ t("preferences.remoteControl.disablePasswordRiskControl") }}
          </li>
          <li>{{ t("preferences.remoteControl.disablePasswordRiskLocal") }}</li>
          <li>{{ t("preferences.remoteControl.disablePasswordRiskLan") }}</li>
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="pine-browser-access-confirm-disable-password"
            variant="destructive"
            @click="confirmDisablePassword"
          >
            {{ t("preferences.remoteControl.disablePasswordAction") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </FieldGroup>
</template>

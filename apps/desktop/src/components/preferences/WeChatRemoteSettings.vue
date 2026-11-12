<script setup lang="ts">
import { useIntervalFn, useNow } from "@vueuse/core";
import {
  ExternalLinkIcon,
  MessageCircleIcon,
  QrCodeIcon,
  TriangleAlertIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { encode } from "uqr";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import { Badge } from "@/components/ui/badge";
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
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { APPROVAL_MODE_ORDER, type PineApprovalMode } from "@/shared/agent";
import { isTemporaryWorkspace } from "@/shared/projects";
import {
  DEFAULT_WECHAT_STATUS,
  type WeChatErrorCode,
  type WeChatSettingsPatch,
  type WeChatStatus,
} from "@/shared/wechatRemote";
import { useProjectStore } from "@/stores/project";

/** The Select value standing for "No Project": the temporary workspace. */
const NO_PROJECT = "no-project";
const PAIRING_CODE = /^\d{6}$/;
const SERVER_GUIDE = {
  zh: "https://docs.aldine.cn/zh/pine/advanced/server/",
  en: "https://docs.aldine.cn/en/pine/advanced/server/",
};

const MODE_LABEL_KEYS: Record<PineApprovalMode, string> = {
  "let-me-review": "project.composer.approval.askForPermissionLabel",
  "auto-approve": "project.composer.approval.agentDecidesLabel",
  autonomous: "project.composer.approval.autonomousLabel",
  YOLO: "project.composer.approval.yoloLabel",
};

const ERROR_KEYS: Record<WeChatErrorCode, string> = {
  "encryption-unavailable": "encryptionUnavailable",
  "binding-expired": "bindingExpired",
  "binding-blocked": "bindingBlocked",
  "pairing-failed": "pairingFailed",
  "binding-failed": "bindingFailed",
  "account-mismatch": "accountMismatch",
  network: "network",
  "settings-reset": "settingsReset",
};

const { t, locale } = useI18n();
const { projects } = storeToRefs(useProjectStore());
const status = ref<WeChatStatus>(DEFAULT_WECHAT_STATUS);
const isLoading = ref(true);
const isSaving = ref(false);
const isBindDialogOpen = ref(false);
const isDisconnectOpen = ref(false);
const verifyCode = ref("");
const pairingCode = ref("");
const now = useNow({
  scheduler: (callback) => useIntervalFn(callback, 1_000),
});
let stopListening: (() => void) | undefined;

const isBusy = computed(() => isLoading.value || isSaving.value);
const binding = computed(() => status.value.binding);
const settings = computed(() => status.value.settings);

/** The pairing code has its own deadline; the QR code and verify code share the binding's. */
const expiresAt = computed(() =>
  binding.value?.phase === "pairing"
    ? binding.value.pairing?.expiresAt
    : binding.value?.expiresAt,
);
const secondsLeft = computed(() =>
  expiresAt.value === undefined
    ? undefined
    : Math.max(0, Math.ceil((expiresAt.value - now.value.getTime()) / 1_000)),
);
const isExpired = computed(() => secondsLeft.value === 0);
const countdown = computed(() => {
  const seconds = secondsLeft.value ?? 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});

/** One square per dark module, drawn as a single path. */
const qr = computed(() => {
  const content = binding.value?.qrContent;
  if (!content) return undefined;
  const { data, size } = encode(content, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { size, path };
});
const showsQr = computed(
  () =>
    qr.value !== undefined &&
    !isExpired.value &&
    (binding.value?.phase === "qr" || binding.value?.phase === "scanned"),
);

const phaseText = computed(() => {
  switch (binding.value?.phase) {
    case "starting":
      return t("preferences.wechatRemote.phaseStarting");
    case "qr":
      return t("preferences.wechatRemote.phaseQr");
    case "scanned":
      return t("preferences.wechatRemote.phaseScanned");
    case "verify-code":
      return t("preferences.wechatRemote.phaseVerifyCode");
    case "confirming":
      return t("preferences.wechatRemote.phaseConfirming");
    default:
      return undefined;
  }
});

const errorText = computed(() =>
  status.value.error
    ? t(`preferences.wechatRemote.error.${ERROR_KEYS[status.value.error]}`)
    : undefined,
);

const connectionBadge = computed(() => {
  if (!status.value.bound) return undefined;
  if (status.value.paused)
    return { label: t("preferences.wechatRemote.statusPaused"), warn: false };
  switch (status.value.connection) {
    case "online":
      return { label: t("preferences.wechatRemote.statusOnline"), warn: false };
    case "connecting":
      return {
        label: t("preferences.wechatRemote.statusConnecting"),
        warn: false,
      };
    case "retrying":
      return {
        label: t("preferences.wechatRemote.statusRetrying"),
        warn: true,
      };
    case "reauth-required":
      return { label: t("preferences.wechatRemote.statusReauth"), warn: true };
    default:
      return undefined;
  }
});

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
);

const projectOptions = computed(() =>
  projects.value.filter((project) => !isTemporaryWorkspace(project.id)),
);
const defaultProjectValue = computed(
  () => settings.value.defaultProjectId ?? NO_PROJECT,
);
/** "Default approval mode" offers only modes within the ceiling. */
const defaultModeOptions = computed(() =>
  APPROVAL_MODE_ORDER.slice(
    0,
    APPROVAL_MODE_ORDER.indexOf(settings.value.ceilingMode) + 1,
  ),
);

onMounted(async () => {
  stopListening = window.pine.onWeChatRemoteChanged?.((next) => {
    status.value = next;
  });
  try {
    status.value = await window.pine.getWeChatRemote!();
  } catch (error) {
    handleError(error, {
      id: "preferences.wechatRemote.load",
      title: t("errors.wechatRemote.loadTitle"),
      description: t("errors.wechatRemote.description"),
    });
  } finally {
    isLoading.value = false;
  }
});

onBeforeUnmount(() => {
  stopListening?.();
  if (status.value.binding) void window.pine.cancelWeChatBinding?.();
});

// Binding ends with the account bound (or failed): the dialog has done its job.
watch(binding, (next, previous) => {
  if (previous && !next && isBindDialogOpen.value) {
    isBindDialogOpen.value = false;
  }
  if (next?.phase !== previous?.phase) {
    verifyCode.value = "";
    pairingCode.value = "";
  }
});

async function run(
  action: () => Promise<WeChatStatus>,
  failure: { id: string; title: string },
): Promise<boolean> {
  if (isBusy.value) return false;
  isSaving.value = true;
  try {
    status.value = await action();
    return true;
  } catch (error) {
    handleError(error, {
      ...failure,
      description: t("errors.wechatRemote.description"),
    });
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function startBinding(): Promise<void> {
  const started = await run(() => window.pine.startWeChatBinding!(), {
    id: "preferences.wechatRemote.connect",
    title: t("errors.wechatRemote.connectTitle"),
  });
  if (started) isBindDialogOpen.value = true;
}

function updateBindDialogOpen(open: boolean): void {
  isBindDialogOpen.value = open;
  if (!open && status.value.binding)
    void window.pine.cancelWeChatBinding!().then((next) => {
      status.value = next;
    });
}

async function submitVerifyCode(): Promise<void> {
  const code = verifyCode.value.trim();
  if (!code) return;
  const sent = await run(() => window.pine.submitWeChatVerifyCode!(code), {
    id: "preferences.wechatRemote.verifyCode",
    title: t("errors.wechatRemote.codeTitle"),
  });
  if (sent) verifyCode.value = "";
}

async function submitPairingCode(): Promise<void> {
  const code = pairingCode.value.trim();
  if (!PAIRING_CODE.test(code)) return;
  const sent = await run(() => window.pine.submitWeChatPairingCode!(code), {
    id: "preferences.wechatRemote.pairingCode",
    title: t("errors.wechatRemote.codeTitle"),
  });
  if (sent) pairingCode.value = "";
}

function updateReceiving(receiving: boolean): void {
  if (receiving === !status.value.paused) return;
  void run(() => window.pine.setWeChatPaused!(!receiving), {
    id: "preferences.wechatRemote.pause",
    title: t("errors.wechatRemote.saveTitle"),
  });
}

function saveSettings(patch: WeChatSettingsPatch): void {
  void run(() => window.pine.setWeChatSettings!(patch), {
    id: "preferences.wechatRemote.settings",
    title: t("errors.wechatRemote.saveTitle"),
  });
}

function updateDefaultProject(value: unknown): void {
  if (typeof value !== "string" || value === defaultProjectValue.value) return;
  saveSettings({
    defaultProjectId:
      value === NO_PROJECT || isTemporaryWorkspace(value) ? null : value,
  });
}

function isApprovalMode(value: unknown): value is PineApprovalMode {
  return APPROVAL_MODE_ORDER.includes(value as PineApprovalMode);
}

function updateCeiling(value: unknown): void {
  if (!isApprovalMode(value) || value === settings.value.ceilingMode) return;
  saveSettings({ ceilingMode: value });
}

function updateDefaultMode(value: unknown): void {
  if (!isApprovalMode(value) || value === settings.value.defaultMode) return;
  saveSettings({ defaultMode: value });
}

function updateSwitch(
  key: "allowHighRiskApprovals" | "allowFileSending" | "keepAwake",
  value: boolean,
): void {
  if (settings.value[key] === value) return;
  const patch: WeChatSettingsPatch = {};
  patch[key] = value;
  saveSettings(patch);
}

function confirmDisconnect(): void {
  void run(() => window.pine.unbindWeChat!(), {
    id: "preferences.wechatRemote.disconnect",
    title: t("errors.wechatRemote.disconnectTitle"),
  });
}

function openServerGuide(): void {
  void window.pine.openExternalUrl(
    locale.value.startsWith("zh") ? SERVER_GUIDE.zh : SERVER_GUIDE.en,
  );
}
</script>

<template>
  <FieldGroup data-testid="wechat-remote-settings">
    <Field orientation="responsive">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-wechat-remote-setting">
          {{ t("preferences.wechatRemote.title") }}
          <Badge variant="outline">
            {{ t("preferences.wechatRemote.experimental") }}
          </Badge>
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.wechatRemote.description") }}
        </FieldDescription>
        <FieldDescription v-if="!status.bound && !isLoading">
          {{ t("preferences.wechatRemote.notConnected") }}
        </FieldDescription>
      </div>
      <Button
        v-if="!status.bound"
        type="button"
        variant="outline"
        size="sm"
        class="shrink-0"
        data-testid="pine-wechat-connect"
        :disabled="isBusy"
        @click="startBinding"
      >
        <QrCodeIcon data-icon="inline-start" />
        {{ t("preferences.wechatRemote.connect") }}
      </Button>
    </Field>

    <p
      v-if="errorText"
      role="alert"
      class="flex gap-2 text-sm text-amber-700 dark:text-amber-400"
      data-testid="pine-wechat-error"
    >
      <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{{ errorText }}</span>
    </p>

    <template v-if="status.bound">
      <Item variant="outline" size="sm" data-testid="pine-wechat-account">
        <ItemMedia variant="icon">
          <MessageCircleIcon />
        </ItemMedia>
        <ItemContent class="min-w-0">
          <ItemTitle class="w-full">
            <span class="truncate">
              {{
                t("preferences.wechatRemote.account", {
                  digest: status.owner?.userDigest ?? "",
                })
              }}
            </span>
            <Badge
              v-if="connectionBadge"
              data-testid="pine-wechat-status"
              :variant="connectionBadge.warn ? 'destructive' : 'secondary'"
            >
              {{ connectionBadge.label }}
            </Badge>
          </ItemTitle>
          <ItemDescription v-if="status.owner" class="truncate">
            {{
              t("preferences.wechatRemote.connectedAt", {
                date: dateFormat.format(status.owner.boundAt),
              })
            }}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            v-if="status.connection === 'reauth-required'"
            type="button"
            variant="outline"
            size="sm"
            data-testid="pine-wechat-scan-again"
            :disabled="isBusy"
            @click="startBinding"
          >
            {{ t("preferences.wechatRemote.scanAgain") }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="pine-wechat-disconnect"
            :disabled="isBusy"
            @click="isDisconnectOpen = true"
          >
            {{ t("preferences.wechatRemote.disconnect") }}
          </Button>
        </ItemActions>
      </Item>

      <Field orientation="horizontal">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-receive">
            {{ t("preferences.wechatRemote.receive") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.receiveDescription") }}
          </FieldDescription>
        </div>
        <Switch
          data-testid="pine-wechat-receive"
          :model-value="!status.paused"
          :disabled="isBusy"
          aria-labelledby="pine-wechat-receive"
          @update:model-value="updateReceiving"
        />
      </Field>

      <Field orientation="responsive">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-default-project">
            {{ t("preferences.wechatRemote.defaultProject") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.defaultProjectDescription") }}
          </FieldDescription>
        </div>
        <Select
          :model-value="defaultProjectValue"
          :disabled="isBusy"
          @update:model-value="updateDefaultProject"
        >
          <SelectTrigger
            data-testid="pine-wechat-default-project"
            class="w-fit max-w-56"
            aria-labelledby="pine-wechat-default-project"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="NO_PROJECT">
                {{ t("projects.temporaryWorkspace") }}
              </SelectItem>
              <SelectItem
                v-for="project in projectOptions"
                :key="project.id"
                :value="project.id"
              >
                {{ project.name }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="responsive">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-ceiling">
            {{ t("preferences.wechatRemote.ceiling") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.ceilingDescription") }}
          </FieldDescription>
          <FieldDescription
            v-if="settings.ceilingMode === 'YOLO'"
            class="text-amber-600 dark:text-amber-400"
            data-testid="pine-wechat-yolo-warning"
          >
            {{ t("preferences.wechatRemote.yoloWarning") }}
          </FieldDescription>
        </div>
        <Select
          :model-value="settings.ceilingMode"
          :disabled="isBusy"
          @update:model-value="updateCeiling"
        >
          <SelectTrigger
            data-testid="pine-wechat-ceiling"
            class="w-fit"
            aria-labelledby="pine-wechat-ceiling"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="mode in APPROVAL_MODE_ORDER"
                :key="mode"
                :value="mode"
              >
                {{ t(MODE_LABEL_KEYS[mode]) }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="responsive">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-default-mode">
            {{ t("preferences.wechatRemote.defaultMode") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.defaultModeDescription") }}
          </FieldDescription>
        </div>
        <Select
          :model-value="settings.defaultMode"
          :disabled="isBusy"
          @update:model-value="updateDefaultMode"
        >
          <SelectTrigger
            data-testid="pine-wechat-default-mode"
            class="w-fit"
            aria-labelledby="pine-wechat-default-mode"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="mode in defaultModeOptions"
                :key="mode"
                :value="mode"
                :data-testid="`pine-wechat-default-mode-${mode}`"
              >
                {{ t(MODE_LABEL_KEYS[mode]) }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="horizontal">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-high-risk">
            {{ t("preferences.wechatRemote.allowHighRisk") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.allowHighRiskDescription") }}
          </FieldDescription>
        </div>
        <Switch
          data-testid="pine-wechat-high-risk"
          :model-value="settings.allowHighRiskApprovals"
          :disabled="isBusy"
          aria-labelledby="pine-wechat-high-risk"
          @update:model-value="
            (value: boolean) => updateSwitch('allowHighRiskApprovals', value)
          "
        />
      </Field>

      <Field orientation="horizontal">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-files">
            {{ t("preferences.wechatRemote.allowFiles") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.allowFilesDescription") }}
          </FieldDescription>
        </div>
        <Switch
          data-testid="pine-wechat-files"
          :model-value="settings.allowFileSending"
          :disabled="isBusy"
          aria-labelledby="pine-wechat-files"
          @update:model-value="
            (value: boolean) => updateSwitch('allowFileSending', value)
          "
        />
      </Field>

      <Field orientation="horizontal">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="pine-wechat-keep-awake">
            {{ t("preferences.wechatRemote.keepAwake") }}
          </FieldTitle>
          <FieldDescription>
            {{ t("preferences.wechatRemote.keepAwakeDescription") }}
          </FieldDescription>
        </div>
        <Switch
          data-testid="pine-wechat-keep-awake"
          :model-value="settings.keepAwake"
          :disabled="isBusy"
          aria-labelledby="pine-wechat-keep-awake"
          @update:model-value="
            (value: boolean) => updateSwitch('keepAwake', value)
          "
        />
      </Field>
    </template>

    <Field data-testid="pine-wechat-notes">
      <FieldTitle>{{ t("preferences.wechatRemote.notes") }}</FieldTitle>
      <ul
        class="flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground"
      >
        <li>{{ t("preferences.wechatRemote.noteRunning") }}</li>
        <li>{{ t("preferences.wechatRemote.noteTencent") }}</li>
        <li>{{ t("preferences.wechatRemote.noteReadScope") }}</li>
        <li>{{ t("preferences.wechatRemote.noteNetwork") }}</li>
        <li>{{ t("preferences.wechatRemote.noteOneComputer") }}</li>
      </ul>
      <Button
        type="button"
        variant="link"
        size="sm"
        class="w-fit px-0"
        data-testid="pine-wechat-server-guide"
        @click="openServerGuide"
      >
        {{ t("preferences.wechatRemote.serverGuide") }}
        <ExternalLinkIcon data-icon="inline-end" />
      </Button>
    </Field>

    <Dialog :open="isBindDialogOpen" @update:open="updateBindDialogOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{{
            t("preferences.wechatRemote.connectTitle")
          }}</DialogTitle>
          <DialogDescription>
            {{ t("preferences.wechatRemote.description") }}
          </DialogDescription>
        </DialogHeader>

        <template v-if="binding?.phase === 'pairing'">
          <p class="text-sm" data-testid="pine-wechat-pairing-instructions">
            {{ t("preferences.wechatRemote.pairingInstructions") }}
          </p>
          <p class="text-sm text-muted-foreground">
            {{
              binding.pairing?.codeSent
                ? t("preferences.wechatRemote.pairingSent")
                : t("preferences.wechatRemote.pairingWaiting")
            }}
          </p>
          <form
            v-if="!isExpired"
            class="contents"
            data-testid="pine-wechat-pairing-form"
            @submit.prevent="submitPairingCode"
          >
            <Field>
              <FieldLabel for="pine-wechat-pairing-code">
                {{ t("preferences.wechatRemote.pairingCode") }}
              </FieldLabel>
              <Input
                id="pine-wechat-pairing-code"
                v-model="pairingCode"
                data-testid="pine-wechat-pairing-code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                class="font-mono tracking-widest"
              />
              <FieldDescription v-if="binding.pairing">
                {{
                  t("preferences.wechatRemote.attemptsLeft", {
                    count: binding.pairing.attemptsLeft,
                  })
                }}
              </FieldDescription>
            </Field>
            <DialogFooter>
              <Button
                type="submit"
                data-testid="pine-wechat-submit-pairing"
                :disabled="isBusy || !PAIRING_CODE.test(pairingCode.trim())"
              >
                {{ t("preferences.wechatRemote.submit") }}
              </Button>
            </DialogFooter>
          </form>
        </template>

        <template v-else>
          <div class="flex flex-col items-center gap-3">
            <!-- Always dark on white: cameras read a QR code by its contrast. -->
            <svg
              v-if="showsQr && qr"
              data-testid="pine-wechat-qr"
              :viewBox="`0 0 ${qr.size} ${qr.size}`"
              :class="[
                'size-56 rounded-md bg-white',
                binding?.phase === 'scanned' && 'opacity-30',
              ]"
              shape-rendering="crispEdges"
              role="img"
              :aria-label="t('preferences.wechatRemote.connectTitle')"
            >
              <path :d="qr.path" fill="#000" />
            </svg>
            <div
              v-else-if="isExpired"
              class="flex size-56 items-center justify-center rounded-md border text-sm text-muted-foreground"
              data-testid="pine-wechat-expired"
            >
              {{ t("preferences.wechatRemote.expired") }}
            </div>
            <p
              v-if="phaseText"
              class="text-center text-sm"
              data-testid="pine-wechat-phase"
            >
              {{ phaseText }}
            </p>
          </div>
          <form
            v-if="binding?.phase === 'verify-code' && !isExpired"
            class="contents"
            data-testid="pine-wechat-verify-form"
            @submit.prevent="submitVerifyCode"
          >
            <Field :data-invalid="binding.verifyRetry || undefined">
              <FieldLabel for="pine-wechat-verify-code">
                {{ t("preferences.wechatRemote.verifyCode") }}
              </FieldLabel>
              <Input
                id="pine-wechat-verify-code"
                v-model="verifyCode"
                data-testid="pine-wechat-verify-code"
                autocomplete="one-time-code"
                :aria-invalid="binding.verifyRetry || undefined"
              />
              <FieldDescription v-if="binding.verifyRetry">
                {{ t("preferences.wechatRemote.verifyRetry") }}
              </FieldDescription>
            </Field>
            <DialogFooter>
              <Button
                type="submit"
                data-testid="pine-wechat-submit-verify"
                :disabled="isBusy || !verifyCode.trim()"
              >
                {{ t("preferences.wechatRemote.submit") }}
              </Button>
            </DialogFooter>
          </form>
        </template>

        <p
          v-if="secondsLeft !== undefined && !isExpired"
          class="text-center text-sm text-muted-foreground"
          data-testid="pine-wechat-countdown"
        >
          {{ t("preferences.wechatRemote.expires", { time: countdown }) }}
        </p>
        <DialogFooter v-if="isExpired">
          <Button
            type="button"
            data-testid="pine-wechat-try-again"
            :disabled="isBusy"
            @click="startBinding"
          >
            {{ t("preferences.wechatRemote.tryAgain") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="isDisconnectOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("preferences.wechatRemote.disconnectTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("preferences.wechatRemote.disconnectDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="pine-wechat-confirm-disconnect"
            @click="confirmDisconnect"
          >
            {{ t("preferences.wechatRemote.disconnect") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </FieldGroup>
</template>

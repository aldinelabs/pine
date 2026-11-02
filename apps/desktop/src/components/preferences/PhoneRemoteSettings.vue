<script setup lang="ts">
import { useIntervalFn, useNow } from "@vueuse/core";
import {
  CopyIcon,
  PencilIcon,
  QrCodeIcon,
  SmartphoneIcon,
  TrashIcon,
} from "@lucide/vue";
import { encode } from "uqr";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_REMOTE_STATUS,
  MAX_REMOTE_DEVICE_NAME_LENGTH,
  type RemoteDevice,
  type RemoteStatus,
} from "@/shared/remoteControl";

const { t, locale } = useI18n();
const status = ref<RemoteStatus>(DEFAULT_REMOTE_STATUS);
const isLoading = ref(true);
const isSaving = ref(false);
const isPairDialogOpen = ref(false);
const renaming = ref<RemoteDevice>();
const nameDraft = ref("");
/** Kept after the dialog closes: its action closes it before the click runs. */
const removing = ref<RemoteDevice>();
const isRemoveOpen = ref(false);
const now = useNow({
  scheduler: (callback) => useIntervalFn(callback, 1_000),
});
let stopListening: (() => void) | undefined;

const isBusy = computed(() => isLoading.value || isSaving.value);
const pairing = computed(() => status.value.pairing);
const secondsLeft = computed(() =>
  pairing.value
    ? Math.max(
        0,
        Math.ceil((pairing.value.expiresAt - now.value.getTime()) / 1_000),
      )
    : 0,
);
const isExpired = computed(() => !pairing.value || secondsLeft.value === 0);
const countdown = computed(() => {
  const minutes = Math.floor(secondsLeft.value / 60);
  const seconds = String(secondsLeft.value % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
});

/** One square per dark module, drawn as a single path. */
const qr = computed(() => {
  if (!pairing.value) return undefined;
  const { data, size } = encode(pairing.value.url, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { size, path };
});

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
);

function deviceDetail(device: RemoteDevice): string {
  return device.lastSeenAt === undefined
    ? t("preferences.phoneRemote.pairedAt", {
        date: dateFormat.value.format(device.pairedAt),
      })
    : t("preferences.phoneRemote.lastSeenAt", {
        date: dateFormat.value.format(device.lastSeenAt),
      });
}

onMounted(async () => {
  stopListening = window.pine.onRemoteControlChanged?.((next) => {
    status.value = next;
  });
  try {
    status.value = await window.pine.getRemoteControl!();
  } catch (error) {
    handleError(error, {
      id: "preferences.phoneRemote.load",
      title: t("errors.phoneRemote.loadTitle"),
      description: t("errors.phoneRemote.description"),
    });
  } finally {
    isLoading.value = false;
  }
});

onBeforeUnmount(() => {
  stopListening?.();
  if (status.value.pairing) void window.pine.cancelRemotePairing?.();
});

// A phone that just paired ends the pairing, so the code has done its job.
watch(
  () => status.value.devices.length,
  (count, previous) => {
    if (isPairDialogOpen.value && count > previous) {
      isPairDialogOpen.value = false;
    }
  },
);

async function run(
  action: () => Promise<RemoteStatus>,
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
      description: t("errors.phoneRemote.description"),
    });
    return false;
  } finally {
    isSaving.value = false;
  }
}

function updateEnabled(enabled: boolean): void {
  if (enabled === status.value.enabled) return;
  void run(() => window.pine.setRemoteControlEnabled!(enabled), {
    id: "preferences.phoneRemote.save",
    title: t("errors.phoneRemote.saveTitle"),
  });
}

async function startPairing(): Promise<void> {
  const started = await run(() => window.pine.startRemotePairing!(), {
    id: "preferences.phoneRemote.pair",
    title: t("errors.phoneRemote.pairTitle"),
  });
  if (started) isPairDialogOpen.value = true;
}

function updatePairDialogOpen(open: boolean): void {
  isPairDialogOpen.value = open;
  if (!open && status.value.pairing)
    void window.pine.cancelRemotePairing!().then((next) => {
      status.value = next;
    });
}

async function copyPairLink(): Promise<void> {
  if (!pairing.value) return;
  await navigator.clipboard.writeText(pairing.value.url);
  toast.success(t("preferences.phoneRemote.pairLinkCopied"));
}

function openRename(device: RemoteDevice): void {
  renaming.value = device;
  nameDraft.value = device.name;
}

async function saveRename(): Promise<void> {
  const device = renaming.value;
  const name = nameDraft.value.trim();
  if (!device || !name) return;
  const saved = await run(
    () => window.pine.renameRemoteDevice!({ id: device.id, name }),
    {
      id: "preferences.phoneRemote.rename",
      title: t("errors.phoneRemote.deviceTitle"),
    },
  );
  if (saved) renaming.value = undefined;
}

function openRemove(device: RemoteDevice): void {
  removing.value = device;
  isRemoveOpen.value = true;
}

function confirmRemove(): void {
  const device = removing.value;
  if (!device) return;
  void run(() => window.pine.removeRemoteDevice!(device.id), {
    id: "preferences.phoneRemote.remove",
    title: t("errors.phoneRemote.deviceTitle"),
  });
}
</script>

<template>
  <FieldGroup data-testid="phone-remote-settings">
    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-phone-remote-setting">
          {{ t("preferences.phoneRemote.title") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.phoneRemote.description") }}
        </FieldDescription>
        <FieldDescription
          v-if="status.enabled && !status.webAccessOn"
          class="text-amber-600 dark:text-amber-400"
          data-testid="pine-phone-remote-needs-web"
        >
          {{ t("preferences.phoneRemote.needsWebAccess") }}
        </FieldDescription>
      </div>
      <Switch
        data-testid="pine-phone-remote-toggle"
        :model-value="status.enabled"
        :disabled="isBusy"
        aria-labelledby="pine-phone-remote-setting"
        @update:model-value="updateEnabled"
      />
    </Field>

    <template v-if="status.enabled">
      <Field orientation="responsive">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle>{{ t("preferences.phoneRemote.devices") }}</FieldTitle>
          <FieldDescription v-if="!status.devices.length">
            {{ t("preferences.phoneRemote.noDevices") }}
          </FieldDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0"
          data-testid="pine-phone-remote-pair"
          :disabled="isBusy || !status.webAccessOn"
          @click="startPairing"
        >
          <QrCodeIcon data-icon="inline-start" />
          {{ t("preferences.phoneRemote.pair") }}
        </Button>
      </Field>

      <ul
        v-if="status.devices.length"
        class="flex flex-col divide-y rounded-lg border"
        data-testid="pine-phone-remote-devices"
      >
        <li
          v-for="device in status.devices"
          :key="device.id"
          class="flex items-center gap-3 px-3 py-2"
          :data-testid="`pine-phone-remote-device-${device.id}`"
        >
          <SmartphoneIcon class="size-4 shrink-0 text-muted-foreground" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="flex items-center gap-2 text-sm font-medium">
              <span class="truncate">{{ device.name }}</span>
              <Badge v-if="device.online" variant="secondary">
                {{ t("preferences.phoneRemote.online") }}
              </Badge>
            </span>
            <span class="text-xs text-muted-foreground">
              {{ deviceDetail(device) }}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('preferences.phoneRemote.rename')"
            :disabled="isBusy"
            data-testid="pine-phone-remote-rename"
            @click="openRename(device)"
          >
            <PencilIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('preferences.phoneRemote.remove')"
            :disabled="isBusy"
            data-testid="pine-phone-remote-remove"
            @click="openRemove(device)"
          >
            <TrashIcon />
          </Button>
        </li>
      </ul>
    </template>

    <Dialog :open="isPairDialogOpen" @update:open="updatePairDialogOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{{
            t("preferences.phoneRemote.pairTitle")
          }}</DialogTitle>
          <DialogDescription>
            {{ t("preferences.phoneRemote.pairDescription") }}
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col items-center gap-3">
          <!-- Always dark on white: cameras read a QR code by its contrast. -->
          <svg
            v-if="qr && !isExpired"
            data-testid="pine-phone-remote-qr"
            :viewBox="`0 0 ${qr.size} ${qr.size}`"
            class="size-56 rounded-md bg-white"
            shape-rendering="crispEdges"
            role="img"
            :aria-label="t('preferences.phoneRemote.pairTitle')"
          >
            <path :d="qr.path" fill="#000" />
          </svg>
          <div
            v-else
            class="flex size-56 items-center justify-center rounded-md border text-sm text-muted-foreground"
            data-testid="pine-phone-remote-expired"
          >
            {{ t("preferences.phoneRemote.pairExpired") }}
          </div>
          <p v-if="!isExpired" class="text-sm text-muted-foreground">
            {{ t("preferences.phoneRemote.pairExpires", { time: countdown }) }}
          </p>
          <p
            v-if="pairing?.fingerprint"
            class="font-mono text-xs break-all text-muted-foreground select-text"
          >
            {{
              t("preferences.phoneRemote.fingerprint", {
                fingerprint: pairing.fingerprint,
              })
            }}
          </p>
        </div>
        <DialogFooter>
          <Button
            v-if="!isExpired"
            type="button"
            variant="outline"
            data-testid="pine-phone-remote-copy"
            @click="copyPairLink"
          >
            <CopyIcon data-icon="inline-start" />
            {{ t("preferences.phoneRemote.copyPairLink") }}
          </Button>
          <Button
            v-else
            type="button"
            data-testid="pine-phone-remote-pair-again"
            :disabled="isBusy"
            @click="startPairing"
          >
            {{ t("preferences.phoneRemote.pairAgain") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="renaming !== undefined"
      @update:open="(open) => !open && (renaming = undefined)"
    >
      <DialogContent class="sm:max-w-sm">
        <form class="contents" @submit.prevent="saveRename">
          <DialogHeader>
            <DialogTitle>
              {{ t("preferences.phoneRemote.renameTitle") }}
            </DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel for="pine-phone-remote-name">
              {{ t("preferences.phoneRemote.deviceName") }}
            </FieldLabel>
            <Input
              id="pine-phone-remote-name"
              v-model="nameDraft"
              data-testid="pine-phone-remote-name"
              autocomplete="off"
              :maxlength="MAX_REMOTE_DEVICE_NAME_LENGTH"
            />
          </Field>
          <DialogFooter>
            <Button
              type="submit"
              data-testid="pine-phone-remote-save-name"
              :disabled="isBusy || !nameDraft.trim()"
            >
              {{ t("common.save") }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="isRemoveOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{
              t("preferences.phoneRemote.removeTitle", {
                name: removing?.name ?? "",
              })
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("preferences.phoneRemote.removeDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="pine-phone-remote-confirm-remove"
            @click="confirmRemove"
          >
            {{ t("preferences.phoneRemote.remove") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </FieldGroup>
</template>

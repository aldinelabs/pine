<script setup lang="ts">
import { useIntervalFn, useNow } from "@vueuse/core";
import {
  CopyIcon,
  PencilIcon,
  QrCodeIcon,
  MonitorSmartphoneIcon,
  TrashIcon,
} from "@lucide/vue";
import { encode } from "uqr";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { I18nT, useI18n } from "vue-i18n";
import aldineOnDark from "@/assets/aldine/aldine-horizontal-on-dark.svg";
import aldineOnLight from "@/assets/aldine/aldine-horizontal-on-light.svg";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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
    ? t("preferences.relayRemote.pairedAt", {
        date: dateFormat.value.format(device.pairedAt),
      })
    : t("preferences.relayRemote.lastSeenAt", {
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
      id: "preferences.relayRemote.load",
      title: t("errors.relayRemote.loadTitle"),
      description: t("errors.relayRemote.description"),
    });
  } finally {
    isLoading.value = false;
  }
});

onBeforeUnmount(() => {
  stopListening?.();
  if (status.value.pairing) void window.pine.cancelRemotePairing?.();
});

// A device that just paired ends the pairing, so the code has done its job.
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
      description: t("errors.relayRemote.description"),
    });
    return false;
  } finally {
    isSaving.value = false;
  }
}

function updateEnabled(enabled: boolean): void {
  if (enabled === status.value.enabled) return;
  void run(() => window.pine.setRemoteControlEnabled!(enabled), {
    id: "preferences.relayRemote.save",
    title: t("errors.relayRemote.saveTitle"),
  });
}

async function startPairing(): Promise<void> {
  const started = await run(() => window.pine.startRemotePairing!(), {
    id: "preferences.relayRemote.pair",
    title: t("errors.relayRemote.pairTitle"),
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
  toast.success(t("preferences.relayRemote.pairLinkCopied"));
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
      id: "preferences.relayRemote.rename",
      title: t("errors.relayRemote.deviceTitle"),
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
    id: "preferences.relayRemote.remove",
    title: t("errors.relayRemote.deviceTitle"),
  });
}
</script>

<template>
  <FieldGroup data-testid="relay-remote-settings">
    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-relay-remote-setting">
          <I18nT
            keypath="preferences.relayRemote.title"
            scope="global"
            tag="span"
          >
            <template #brand>
              <img
                :src="aldineOnLight"
                alt="Aldine"
                class="inline-block h-[1.4em] align-[-0.35em] dark:hidden"
              />
              <img
                :src="aldineOnDark"
                alt="Aldine"
                class="hidden h-[1.4em] align-[-0.35em] dark:inline-block"
              />
            </template>
          </I18nT>
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.relayRemote.description") }}
        </FieldDescription>
        <FieldDescription
          v-if="status.enabled && !status.webAccessOn"
          class="text-amber-600 dark:text-amber-400"
          data-testid="pine-relay-remote-needs-web"
        >
          {{ t("preferences.relayRemote.needsWebAccess") }}
        </FieldDescription>
      </div>
      <Switch
        data-testid="pine-relay-remote-toggle"
        :model-value="status.enabled"
        :disabled="isBusy"
        aria-labelledby="pine-relay-remote-setting"
        @update:model-value="updateEnabled"
      />
    </Field>

    <template v-if="status.enabled">
      <Field orientation="responsive">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle>{{ t("preferences.relayRemote.devices") }}</FieldTitle>
          <FieldDescription v-if="!status.devices.length">
            {{ t("preferences.relayRemote.noDevices") }}
          </FieldDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0"
          data-testid="pine-relay-remote-pair"
          :disabled="isBusy || !status.webAccessOn"
          @click="startPairing"
        >
          <QrCodeIcon data-icon="inline-start" />
          {{ t("preferences.relayRemote.pair") }}
        </Button>
      </Field>

      <ItemGroup
        v-if="status.devices.length"
        class="gap-2"
        data-testid="pine-relay-remote-devices"
      >
        <Item
          v-for="device in status.devices"
          :key="device.id"
          variant="outline"
          size="sm"
          :data-testid="`pine-relay-remote-device-${device.id}`"
        >
          <ItemMedia variant="icon">
            <MonitorSmartphoneIcon />
          </ItemMedia>
          <ItemContent class="min-w-0">
            <ItemTitle class="w-full">
              <span class="truncate">{{ device.name }}</span>
              <Badge v-if="device.online" variant="secondary">
                {{ t("preferences.relayRemote.online") }}
              </Badge>
            </ItemTitle>
            <ItemDescription class="truncate">
              {{ deviceDetail(device) }}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('preferences.relayRemote.rename')"
              :disabled="isBusy"
              data-testid="pine-relay-remote-rename"
              @click="openRename(device)"
            >
              <PencilIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('preferences.relayRemote.remove')"
              :disabled="isBusy"
              data-testid="pine-relay-remote-remove"
              @click="openRemove(device)"
            >
              <TrashIcon />
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </template>

    <Dialog :open="isPairDialogOpen" @update:open="updatePairDialogOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{{
            t("preferences.relayRemote.pairTitle")
          }}</DialogTitle>
          <DialogDescription>
            {{ t("preferences.relayRemote.pairDescription") }}
          </DialogDescription>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">
          {{ t("preferences.relayRemote.pairBrowserHint") }}
        </p>
        <div class="flex flex-col items-center gap-3">
          <!-- Always dark on white: cameras read a QR code by its contrast. -->
          <svg
            v-if="qr && !isExpired"
            data-testid="pine-relay-remote-qr"
            :viewBox="`0 0 ${qr.size} ${qr.size}`"
            class="size-56 rounded-md bg-white"
            shape-rendering="crispEdges"
            role="img"
            :aria-label="t('preferences.relayRemote.pairTitle')"
          >
            <path :d="qr.path" fill="#000" />
          </svg>
          <div
            v-else
            class="flex size-56 items-center justify-center rounded-md border text-sm text-muted-foreground"
            data-testid="pine-relay-remote-expired"
          >
            {{ t("preferences.relayRemote.pairExpired") }}
          </div>
          <p v-if="!isExpired" class="text-sm text-muted-foreground">
            {{ t("preferences.relayRemote.pairExpires", { time: countdown }) }}
          </p>
          <p
            v-if="pairing?.fingerprint"
            class="font-mono text-xs break-all text-muted-foreground select-text"
          >
            {{
              t("preferences.relayRemote.fingerprint", {
                fingerprint: pairing.fingerprint,
              })
            }}
          </p>
        </div>
        <!-- For devices without a camera, or the computer's own other browsers. -->
        <Field v-if="pairing && !isExpired">
          <FieldLabel for="pine-relay-remote-link">
            {{ t("preferences.relayRemote.pairLink") }}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="pine-relay-remote-link"
              data-testid="pine-relay-remote-link"
              :model-value="pairing.url"
              readonly
              spellcheck="false"
              class="font-mono text-xs"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                data-testid="pine-relay-remote-copy"
                :aria-label="t('preferences.relayRemote.copyPairLink')"
                @click="copyPairLink"
              >
                <CopyIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <DialogFooter v-if="isExpired">
          <Button
            type="button"
            data-testid="pine-relay-remote-pair-again"
            :disabled="isBusy"
            @click="startPairing"
          >
            {{ t("preferences.relayRemote.pairAgain") }}
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
              {{ t("preferences.relayRemote.renameTitle") }}
            </DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel for="pine-relay-remote-name">
              {{ t("preferences.relayRemote.deviceName") }}
            </FieldLabel>
            <Input
              id="pine-relay-remote-name"
              v-model="nameDraft"
              data-testid="pine-relay-remote-name"
              autocomplete="off"
              :maxlength="MAX_REMOTE_DEVICE_NAME_LENGTH"
            />
          </Field>
          <DialogFooter>
            <Button
              type="submit"
              data-testid="pine-relay-remote-save-name"
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
              t("preferences.relayRemote.removeTitle", {
                name: removing?.name ?? "",
              })
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("preferences.relayRemote.removeDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="pine-relay-remote-confirm-remove"
            @click="confirmRemove"
          >
            {{ t("preferences.relayRemote.remove") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </FieldGroup>
</template>

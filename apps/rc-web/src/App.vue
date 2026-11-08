<script setup lang="ts">
import {
  ClipboardPasteIcon,
  MonitorIcon,
  TrashIcon,
  ScanLineIcon,
} from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import PairingScanner from "@/components/PairingScanner.vue";
import PineLogo from "@/components/PineLogo.vue";
import { extractPairingUrl } from "@/pairingInput";
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
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { Spinner } from "@/components/ui/spinner";
import type { StoredHost } from "@/store";
import { view } from "@/view";

const { t, locale } = useI18n();
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
);

/** Kept after the dialog closes: its action closes it before the click runs. */
const forgetting = ref<StoredHost>();
const isForgetOpen = ref(false);

const mode = ref<"idle" | "scan" | "paste">("idle");
const scanning = computed(() => mode.value === "scan");
const idle = computed(() => mode.value === "idle");

function scanned(url: string): void {
  mode.value = "idle";
  const shown = view.value;
  if (shown.kind === "list") shown.pair(url);
}

const pastedLink = ref("");

function pairWithLink(): void {
  const text = pastedLink.value.trim();
  if (!text) return;
  pastedLink.value = "";
  scanned(extractPairingUrl(text));
}

const current = computed(() => view.value);

function askForget(host: StoredHost): void {
  forgetting.value = host;
  isForgetOpen.value = true;
}

function confirmForget(): void {
  const host = forgetting.value;
  const shown = view.value;
  if (host && shown.kind === "list") void shown.forget(host);
}
</script>

<template>
  <main
    v-if="current.kind !== 'pine'"
    class="fixed inset-0 z-10 flex overflow-y-auto bg-background px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
  >
    <Empty class="m-auto w-full max-w-sm border-0 p-0 md:p-0">
      <EmptyHeader>
        <EmptyMedia>
          <PineLogo class="size-10" />
        </EmptyMedia>
        <template v-if="current.kind === 'list'">
          <EmptyTitle>{{
            t(scanning ? "scanCode" : mode === "paste" ? "pasteLink" : "title")
          }}</EmptyTitle>
          <EmptyDescription v-if="idle && current.hosts.length === 0">
            {{ t("emptyList") }}
          </EmptyDescription>
        </template>
        <EmptyDescription
          v-else-if="current.kind === 'status'"
          class="flex items-center justify-center gap-2"
          data-testid="rc-status"
        >
          <Spinner v-if="current.busy" class="shrink-0" />
          <span>{{
            t(current.message.key, current.message.values ?? {})
          }}</span>
        </EmptyDescription>
      </EmptyHeader>

      <EmptyContent
        v-if="current.kind === 'status' && current.actions.length"
        class="w-full"
      >
        <Button
          v-for="action in current.actions"
          :key="action.label"
          type="button"
          class="w-full"
          :variant="action.primary ? 'default' : 'outline'"
          @click="action.run"
        >
          {{ t(action.label) }}
        </Button>
      </EmptyContent>

      <EmptyContent v-if="current.kind === 'list'" class="w-full">
        <PairingScanner
          v-if="scanning"
          @scanned="scanned"
          @cancel="mode = 'idle'"
        />
        <div
          v-else-if="idle"
          class="flex w-full flex-wrap justify-center gap-2"
        >
          <Button type="button" @click="mode = 'scan'">
            <ScanLineIcon data-icon="inline-start" />
            {{ t("scanCode") }}
          </Button>
          <Button type="button" variant="outline" @click="mode = 'paste'">
            <ClipboardPasteIcon data-icon="inline-start" />
            {{ t("pasteLink") }}
          </Button>
        </div>
        <form
          v-else
          class="flex w-full flex-col gap-2"
          @submit.prevent="pairWithLink"
        >
          <Input
            v-model="pastedLink"
            type="text"
            inputmode="url"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            autofocus
            :placeholder="t('pasteLink')"
            :aria-label="t('pasteLink')"
            data-testid="rc-paste-link"
          />
          <Button type="submit" :disabled="!pastedLink.trim()">
            {{ t("pairWithLink") }}
          </Button>
          <Button type="button" variant="ghost" @click="mode = 'idle'">
            {{ t("cancel") }}
          </Button>
        </form>
      </EmptyContent>

      <ItemGroup
        v-if="current.kind === 'list' && idle && current.hosts.length"
        class="w-full gap-2 text-left"
        data-testid="rc-hosts"
      >
        <Item
          v-for="host in current.hosts"
          :key="host.id"
          variant="outline"
          size="sm"
          class="relative"
        >
          <ItemMedia variant="icon">
            <MonitorIcon />
          </ItemMedia>
          <ItemContent class="min-w-0">
            <button
              type="button"
              class="text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
              @click="current.open(host)"
            >
              <ItemTitle class="w-full">
                <span class="truncate">{{ host.name }}</span>
              </ItemTitle>
            </button>
            <ItemDescription class="truncate">
              {{
                t("lastConnected", {
                  date: dateFormat.format(
                    host.lastConnectedAt ?? host.pairedAt,
                  ),
                })
              }}
            </ItemDescription>
          </ItemContent>
          <ItemActions class="relative z-10">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('forget')"
              @click="askForget(host)"
            >
              <TrashIcon />
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </Empty>
  </main>

  <AlertDialog v-model:open="isForgetOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("forgetTitle", { name: forgetting?.name ?? "" }) }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("forgetDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("cancel") }}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="confirmForget">
          {{ t("forget") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

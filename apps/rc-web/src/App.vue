<script setup lang="ts">
import { MonitorIcon, TrashIcon, ScanLineIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import PairingScanner from "@/components/PairingScanner.vue";
import PineLogo from "@/components/PineLogo.vue";
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

const scanning = ref(false);

function scanned(url: string): void {
  scanning.value = false;
  const shown = view.value;
  if (shown.kind === "list") shown.pair(url);
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
          <EmptyTitle>{{ t(scanning ? "scanCode" : "title") }}</EmptyTitle>
          <EmptyDescription v-if="!scanning && current.hosts.length === 0">
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
          @cancel="scanning = false"
        />
        <Button v-else type="button" @click="scanning = true">
          <ScanLineIcon data-icon="inline-start" />
          {{ t("scanCode") }}
        </Button>
      </EmptyContent>

      <ItemGroup
        v-if="current.kind === 'list' && !scanning && current.hosts.length"
        class="w-full gap-2 text-left"
        data-testid="rc-hosts"
      >
        <Item
          v-for="host in current.hosts"
          :key="host.id"
          variant="outline"
          size="sm"
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

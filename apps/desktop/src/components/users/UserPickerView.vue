<script setup lang="ts">
import { PlusIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import UserAvatar from "@/components/users/UserAvatar.vue";
import UserDialog from "@/components/users/UserDialog.vue";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useUserDisplayName } from "@/composables/useUserDisplayName";
import type { PineUser } from "@/shared/users";
import { userErrorCode, useUsersStore } from "@/stores/users";
import { toast } from "vue-sonner";
import { Toaster } from "@/components/ui/sonner";
import { useAppearanceStore } from "@/stores/appearance";

/**
 * "Who's using Pine?": shown at launch when there is more than one user,
 * before any user's data is open. Choosing one loads that user's Pine into
 * this window.
 */
const { t } = useI18n();
const usersStore = useUsersStore();
const { users, state } = storeToRefs(usersStore);
const { colorScheme } = storeToRefs(useAppearanceStore());
const displayName = useUserDisplayName();
const remember = ref(false);
const choosing = ref<string | null>(null);
const isAddOpen = ref(false);
const list = useTemplateRef<HTMLUListElement>("list");

/** The user tiles, then "Add user", in the order they show. */
function tiles(): HTMLButtonElement[] {
  return Array.from(list.value?.querySelectorAll("button") ?? []);
}

const lastUserIndex = computed(() =>
  Math.max(
    0,
    users.value.findIndex((user) => user.id === state.value?.lastUserId),
  ),
);

function focusTile(index: number): void {
  const all = tiles();
  if (all.length === 0) return;
  all[(index + all.length) % all.length]?.focus();
}

async function choose(user: PineUser): Promise<void> {
  if (choosing.value) return;
  choosing.value = user.id;
  try {
    await window.pine.users?.choose({ id: user.id, remember: remember.value });
    // The main process now loads this user's workspace into the window.
  } catch (error) {
    choosing.value = null;
    toast.error(t(`users.errors.${userErrorCode(error)}`));
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (isAddOpen.value || event.metaKey || event.ctrlKey || event.altKey) return;
  const all = tiles();
  const current = all.findIndex((tile) => tile === document.activeElement);
  if (/^[1-9]$/.test(event.key)) {
    const user = users.value[Number(event.key) - 1];
    if (user) {
      event.preventDefault();
      void choose(user);
    }
    return;
  }
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return;
  event.preventDefault();
  focusTile(current < 0 ? lastUserIndex.value : current + step);
}

async function added(user: PineUser): Promise<void> {
  await nextTick();
  focusTile(users.value.findIndex((candidate) => candidate.id === user.id));
}

onMounted(async () => {
  await usersStore.load();
  await nextTick();
  focusTile(lastUserIndex.value);
});
</script>

<template>
  <main
    class="relative flex h-full flex-col items-center justify-center overflow-y-auto bg-background px-4 py-16"
    data-testid="user-picker"
    @keydown="onKeydown"
  >
    <div
      class="window-drag absolute inset-x-0 top-0 h-[var(--window-titlebar-height,3rem)]"
      aria-hidden="true"
    />
    <h1
      class="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground"
    >
      {{ t("users.title") }}
    </h1>

    <ul
      ref="list"
      class="flex max-w-3xl flex-wrap items-start justify-center gap-x-8 gap-y-10"
      role="list"
    >
      <li v-for="(user, index) in users" :key="user.id">
        <button
          type="button"
          data-slot="user-picker-tile"
          :data-user-id="user.id"
          class="group flex w-32 flex-col items-center gap-3 rounded-2xl p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
          :disabled="choosing !== null && choosing !== user.id"
          :aria-keyshortcuts="index < 9 ? String(index + 1) : undefined"
          @click="choose(user)"
        >
          <span class="relative">
            <UserAvatar
              :name="displayName(user)"
              :avatar="user.avatar"
              :color="user.color"
              size="xl"
              class="transition-transform group-hover:scale-105 group-focus-visible:scale-105"
            />
            <span
              v-if="choosing === user.id"
              class="absolute inset-0 flex items-center justify-center rounded-full bg-background/60"
            >
              <Spinner class="size-6" />
            </span>
          </span>
          <span
            data-slot="user-picker-name"
            class="line-clamp-2 max-w-full text-center text-sm font-medium break-words text-foreground"
          >
            {{ displayName(user) }}
          </span>
        </button>
      </li>
      <li>
        <button
          type="button"
          data-slot="user-picker-add"
          class="group flex w-32 flex-col items-center gap-3 rounded-2xl p-3 text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          :disabled="choosing !== null"
          @click="isAddOpen = true"
        >
          <span
            class="flex size-24 items-center justify-center rounded-full border-2 border-dashed border-border"
          >
            <PlusIcon class="size-8" aria-hidden="true" />
          </span>
          <span class="text-sm font-medium">{{ t("users.add") }}</span>
        </button>
      </li>
    </ul>

    <div class="mt-14 flex items-center gap-2">
      <Checkbox
        id="user-picker-remember"
        v-model="remember"
        data-testid="user-picker-remember"
      />
      <Label
        for="user-picker-remember"
        class="text-sm font-normal text-muted-foreground"
      >
        {{ t("users.remember") }}
      </Label>
    </div>

    <UserDialog v-model:open="isAddOpen" :user="null" @saved="added" />
    <Toaster :theme="colorScheme" />
  </main>
</template>

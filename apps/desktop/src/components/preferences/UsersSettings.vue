<script setup lang="ts">
import {
  ArrowRightLeftIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import UserAvatar from "@/components/users/UserAvatar.vue";
import UserDialog from "@/components/users/UserDialog.vue";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useUserDisplayName } from "@/composables/useUserDisplayName";
import { PRIMARY_USER_ID, type PineUser } from "@/shared/users";
import { userErrorCode, useUsersStore } from "@/stores/users";

/**
 * Settings › Multiple users: everyone who shares this computer, each with
 * their own Pine. Deleting moves a user's folder to the Trash.
 */
const { t } = useI18n();
const usersStore = useUsersStore();
const { state, users, hasSeveralUsers } = storeToRefs(usersStore);
const displayName = useUserDisplayName();
const isDialogOpen = ref(false);
const editingUser = ref<PineUser | null>(null);
// The target outlives the dialog: confirming closes it before the action's
// click handler runs.
const pendingDelete = ref<PineUser | null>(null);
const isDeleteOpen = ref(false);
const isSavingAsk = ref(false);

const isDamaged = computed(() => state.value?.damaged ?? false);

function isCurrent(user: PineUser): boolean {
  return user.id === state.value?.currentUserId;
}

function openDialog(user: PineUser | null): void {
  // Let the menu close before the dialog takes focus.
  window.setTimeout(() => {
    editingUser.value = user;
    isDialogOpen.value = true;
  });
}

function requestDelete(user: PineUser): void {
  pendingDelete.value = user;
  isDeleteOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  const user = pendingDelete.value;
  isDeleteOpen.value = false;
  if (!user) return;
  try {
    await usersStore.remove(user.id);
  } catch (error) {
    handleError(error, {
      id: `users.delete.${user.id}`,
      title: t(`users.errors.${userErrorCode(error)}`),
    });
  }
}

async function switchTo(user: PineUser): Promise<void> {
  try {
    await usersStore.switchTo(user.id);
  } catch (error) {
    handleError(error, {
      id: `users.switch.${user.id}`,
      title: t(`users.errors.${userErrorCode(error)}`),
    });
  }
}

async function setAskAtLaunch(ask: boolean): Promise<void> {
  if (isSavingAsk.value) return;
  isSavingAsk.value = true;
  try {
    await usersStore.setAskAtLaunch(ask);
  } catch (error) {
    handleError(error, {
      id: "users.ask-at-launch",
      title: t(`users.errors.${userErrorCode(error)}`),
    });
  } finally {
    isSavingAsk.value = false;
  }
}

onMounted(() => {
  void usersStore.load().catch((error: unknown) =>
    handleError(error, {
      id: "users.load",
      title: t("users.errors.generic"),
    }),
  );
});
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="users-settings">
    <div class="flex items-start justify-between gap-4">
      <FieldDescription>
        {{ t("users.settings.description") }}
      </FieldDescription>
      <Button
        data-testid="users-settings-add"
        size="sm"
        variant="outline"
        :disabled="!state || isDamaged"
        @click="openDialog(null)"
      >
        <PlusIcon data-icon="inline-start" />
        {{ t("users.add") }}
      </Button>
    </div>

    <FieldError v-if="isDamaged">{{ t("users.errors.damaged") }}</FieldError>

    <ItemGroup v-if="state" class="gap-2">
      <Item
        v-for="user in users"
        :key="user.id"
        data-slot="users-settings-row"
        :data-user-id="user.id"
        variant="muted"
        size="sm"
      >
        <ItemMedia>
          <UserAvatar
            :name="displayName(user)"
            :avatar="user.avatar"
            :color="user.color"
          />
        </ItemMedia>
        <ItemContent class="min-w-0">
          <ItemTitle class="w-full">
            <span class="truncate">{{ displayName(user) }}</span>
            <Badge v-if="isCurrent(user)" variant="secondary">
              {{ t("users.settings.current") }}
            </Badge>
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <Button
            variant="ghost"
            size="icon-sm"
            data-action="edit-user"
            :disabled="isDamaged"
            :aria-label="t('users.editTitle')"
            :title="t('users.editTitle')"
            @click="openDialog(user)"
          >
            <PencilIcon />
          </Button>
          <DropdownMenu v-if="!isCurrent(user)">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                data-action="user-actions"
                :aria-label="
                  t('users.settings.actions', { name: displayName(user) })
                "
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem
                data-action="switch-user"
                @select="switchTo(user)"
              >
                <ArrowRightLeftIcon />
                {{ t("users.settings.switch") }}
              </DropdownMenuItem>
              <template v-if="user.id !== PRIMARY_USER_ID">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-action="delete-user"
                  variant="destructive"
                  :disabled="isDamaged"
                  @select="requestDelete(user)"
                >
                  <Trash2Icon />
                  {{ t("users.settings.delete") }}
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </Item>
    </ItemGroup>
    <Skeleton v-else class="h-[3.25rem] w-full rounded-lg" />

    <FieldDescription>{{ t("users.settings.notSecure") }}</FieldDescription>

    <template v-if="hasSeveralUsers">
      <FieldSeparator class="my-2" />
      <Field orientation="horizontal">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <FieldTitle id="users-ask-at-launch">
            {{ t("users.settings.askAtLaunch") }}
          </FieldTitle>
          <FieldDescription id="users-ask-at-launch-description">
            {{ t("users.settings.askAtLaunchHint") }}
          </FieldDescription>
        </div>
        <Switch
          data-testid="users-ask-at-launch"
          :model-value="state?.askAtLaunch ?? true"
          :disabled="isSavingAsk || isDamaged"
          aria-labelledby="users-ask-at-launch"
          aria-describedby="users-ask-at-launch-description"
          @update:model-value="(value: boolean) => void setAskAtLaunch(value)"
        />
      </Field>
      <FieldDescription data-testid="users-background-note">
        {{ t("users.settings.background") }}
      </FieldDescription>
    </template>

    <UserDialog v-model:open="isDialogOpen" :user="editingUser" offer-copy />

    <AlertDialog v-model:open="isDeleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{
              t("users.settings.deleteTitle", {
                name: displayName(pendingDelete),
              })
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("users.settings.deleteDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="users-delete-confirm"
            variant="destructive"
            @click="confirmDelete"
          >
            {{ t("users.settings.delete") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

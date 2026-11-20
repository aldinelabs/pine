<script setup lang="ts">
import { ChevronsUpDownIcon, UsersRoundIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import UserAvatar from "@/components/users/UserAvatar.vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useUserDisplayName } from "@/composables/useUserDisplayName";
import type { PineUser } from "@/shared/users";
import { userErrorCode, useUsersStore } from "@/stores/users";

/**
 * The sidebar footer's current user, shown only while there is more than
 * one: switches to another user (restarting Pine) or opens Settings ›
 * Multiple users. A single user sees nothing here.
 */
const emit = defineEmits<{ manageUsers: [] }>();
const { t } = useI18n();
const usersStore = useUsersStore();
const { users, currentUser, hasSeveralUsers } = storeToRefs(usersStore);
const displayName = useUserDisplayName();

const otherUsers = computed(() =>
  users.value.filter((user) => user.id !== currentUser.value?.id),
);

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

onMounted(() => {
  void usersStore.load().catch(() => undefined);
});
</script>

<template>
  <SidebarMenu v-if="hasSeveralUsers && currentUser" data-slot="user-switcher">
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            data-testid="user-switcher-trigger"
            :aria-label="t('users.switcher.label')"
          >
            <UserAvatar
              :name="displayName(currentUser)"
              :avatar="currentUser.avatar"
              :color="currentUser.color"
              size="xs"
            />
            <span class="min-w-0 flex-1 truncate">
              {{ displayName(currentUser) }}
            </span>
            <ChevronsUpDownIcon class="ml-auto text-muted-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" class="w-56">
          <DropdownMenuLabel class="truncate text-xs text-muted-foreground">
            {{
              t("users.switcher.current", { name: displayName(currentUser) })
            }}
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              v-for="user in otherUsers"
              :key="user.id"
              data-slot="user-switcher-option"
              :data-user-id="user.id"
              @select="switchTo(user)"
            >
              <UserAvatar
                :name="displayName(user)"
                :avatar="user.avatar"
                :color="user.color"
                size="xs"
              />
              <span class="truncate">{{ displayName(user) }}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-action="manage-users"
            @select="emit('manageUsers')"
          >
            <UsersRoundIcon />
            {{ t("users.switcher.manage") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script setup lang="ts">
import { WorkflowIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { cn } from "@/lib/utils";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import SessionContextMenu from "@/components/sessions/SessionContextMenu.vue";
import { useSessionStore } from "@/stores/session";
import type { PineSessionGroup } from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";

/** One session row of the sidebar tree, at any folder depth. */
const props = defineProps<{
  groups: PineSessionGroup[];
  isActive: boolean;
  session: ProjectSessionSearchResult;
  title: string;
}>();

const sessionStore = useSessionStore();
const isRunning = computed(() =>
  sessionStore.isSessionRunning(props.session.id),
);

const { locale } = useI18n();
/**
 * Runs of one automation share its name, so each row also shows when it
 * started, in the compact form the sidebar has room for.
 */
const runStartedAt = computed(() => {
  const startedAt = props.session.automationRun?.startedAt;
  if (!startedAt) return undefined;
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale.value, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
});

const emit = defineEmits<{
  open: [];
  rename: [];
  export: [];
  move: [groupId: string | null];
  delete: [];
  dragstart: [event: DragEvent];
}>();
</script>

<template>
  <SidebarMenuSubItem @dragstart="emit('dragstart', $event)">
    <SessionContextMenu
      :groups="groups"
      :session="session"
      @rename="emit('rename')"
      @export="emit('export')"
      @move="emit('move', $event)"
      @delete="emit('delete')"
    >
      <SidebarMenuSubButton
        as="button"
        class="w-full translate-x-0"
        :data-session-id="session.id"
        :data-project-id="session.projectId"
        :draggable="true"
        :is-active="isActive"
        :title="title"
        @click="emit('open')"
      >
        <WorkflowIcon
          v-if="session.automationRun"
          data-slot="session-automation-icon"
          class="text-muted-foreground"
          aria-hidden="true"
        />
        <span
          data-slot="session-title"
          :data-running="isRunning || undefined"
          :class="cn('truncate', isRunning && 'shimmer')"
          >{{ title }}</span
        >
        <span
          v-if="runStartedAt && !isRunning"
          data-slot="session-automation-time"
          class="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums"
          >{{ runStartedAt }}</span
        >
        <span
          v-if="isRunning"
          aria-hidden="true"
          data-slot="session-running-dot"
          class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
        />
      </SidebarMenuSubButton>
    </SessionContextMenu>
  </SidebarMenuSubItem>
</template>

<script setup lang="ts">
import { ListTreeIcon, ShieldAlertIcon, WorkflowIcon } from "@lucide/vue";
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
const props = withDefaults(
  defineProps<{
    groups: PineSessionGroup[];
    isActive: boolean;
    session: ProjectSessionSearchResult;
    title: string;
    /** 1 for a sub-session, shown under the session that started it. */
    depth?: number;
    /** Sub-sessions shown under this row when it is expanded. */
    subSessionCount?: number;
    expanded?: boolean;
  }>(),
  { depth: 0, subSessionCount: 0, expanded: false },
);

const sessionStore = useSessionStore();
const isRunning = computed(() =>
  sessionStore.isSessionRunning(props.session.id),
);

const isAwaitingApproval = computed(() =>
  sessionStore.isSessionAwaitingApproval(props.session.id),
);

const { locale, t } = useI18n();
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
  toggle: [];
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
        :class="cn('w-full translate-x-0', depth > 0 && 'ps-7')"
        :data-sub-session="depth > 0 || undefined"
        :data-session-id="session.id"
        :data-project-id="session.projectId"
        :draggable="true"
        :is-active="isActive"
        :title="title"
        @click="emit('open')"
      >
        <!-- Keeps the title clear of the toggle drawn over this spot. -->
        <span
          v-if="subSessionCount > 0"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
        <WorkflowIcon
          v-else-if="session.automationRun"
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
          v-if="isAwaitingApproval"
          data-slot="session-awaiting-approval"
          class="ms-auto flex shrink-0 text-warning"
          role="img"
          :aria-label="t('sessions.awaitingApproval')"
          :title="t('sessions.awaitingApproval')"
        >
          <ShieldAlertIcon aria-hidden="true" />
        </span>
        <span
          v-else-if="isRunning"
          aria-hidden="true"
          data-slot="session-running-dot"
          class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
        />
      </SidebarMenuSubButton>
    </SessionContextMenu>
    <button
      v-if="subSessionCount > 0"
      type="button"
      data-slot="session-sub-sessions-toggle"
      class="absolute start-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      :aria-expanded="expanded"
      :aria-label="
        t(expanded ? 'sessions.hideSubSessions' : 'sessions.showSubSessions', {
          count: subSessionCount,
        })
      "
      :title="
        t(expanded ? 'sessions.hideSubSessions' : 'sessions.showSubSessions', {
          count: subSessionCount,
        })
      "
      @click.stop="emit('toggle')"
    >
      <ListTreeIcon class="size-4" aria-hidden="true" />
    </button>
  </SidebarMenuSubItem>
</template>

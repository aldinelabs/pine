<script setup lang="ts">
import { ChevronRightIcon, ShieldAlertIcon, WorkflowIcon } from "@lucide/vue";
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
    /** The bottom sub-session of its parent, where the tree line ends. */
    lastSubSession?: boolean;
  }>(),
  { depth: 0, subSessionCount: 0, expanded: false, lastSubSession: false },
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

const toggleLabel = computed(() =>
  t(props.expanded ? "sessions.hideSubSessions" : "sessions.showSubSessions", {
    count: props.subSessionCount,
  }),
);

/** Tree keys: right shows sub-sessions, left hides them. */
function onKeydown(event: KeyboardEvent) {
  if (props.subSessionCount === 0) return;
  if (
    (event.key === "ArrowRight" && !props.expanded) ||
    (event.key === "ArrowLeft" && props.expanded)
  ) {
    event.preventDefault();
    emit("toggle");
  }
}

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
        :class="cn('w-full translate-x-0', depth > 0 && 'ps-9')"
        :aria-expanded="subSessionCount > 0 ? expanded : undefined"
        :data-sub-session="depth > 0 || undefined"
        :data-session-id="session.id"
        :data-project-id="session.projectId"
        :draggable="true"
        :is-active="isActive"
        :title="title"
        @click="emit('open')"
        @keydown="onKeydown"
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
          v-if="isAwaitingApproval"
          data-slot="session-awaiting-approval"
          class="ms-auto flex shrink-0 text-warning"
          role="img"
          :aria-label="t('sessions.awaitingApproval')"
          :title="t('sessions.awaitingApproval')"
        >
          <ShieldAlertIcon class="size-3.5" aria-hidden="true" />
        </span>
        <span
          v-else-if="isRunning"
          aria-hidden="true"
          data-slot="session-running-dot"
          class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
        />
        <!-- A span, not a button: the row is already one; keyboard users
             expand with the arrow keys. A 20px box in the 28px row sits 4px
             from its edge, so its radius is the row's minus 4px. -->
        <span
          v-if="subSessionCount > 0"
          data-slot="session-sub-sessions-toggle"
          :class="
            cn(
              '-me-2 flex size-5 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-border hover:text-sidebar-accent-foreground',
              !isAwaitingApproval && 'ms-auto',
            )
          "
          :title="toggleLabel"
          @click.stop="emit('toggle')"
        >
          <ChevronRightIcon
            :class="
              cn(
                'size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
                expanded && 'rotate-90',
              )
            "
            aria-hidden="true"
          />
        </span>
      </SidebarMenuSubButton>
    </SessionContextMenu>
    <!-- Tree line joining sub-sessions to their parent. Sub-sessions sit
         24px in, the same step as sessions under their project; the line
         reaches 2px into the 4px gap on each side so it runs unbroken. -->
    <span
      v-if="depth > 0"
      data-slot="session-tree-line"
      aria-hidden="true"
      :class="
        cn(
          'pointer-events-none absolute start-3.5 -top-0.5 border-s border-muted-foreground/40',
          lastSubSession
            ? 'h-[calc(50%+2px)] w-3 rounded-es-lg border-b'
            : '-bottom-0.5',
        )
      "
    />
  </SidebarMenuSubItem>
</template>

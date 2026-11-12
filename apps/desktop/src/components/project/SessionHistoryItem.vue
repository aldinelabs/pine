<script setup lang="ts">
import {
  ChevronRightIcon,
  MessageCircleIcon,
  ShieldAlertIcon,
  WorkflowIcon,
} from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
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
    /** Folding in as it appears in the list, or out as it leaves it. */
    motion?: "enter" | "leave";
  }>(),
  { depth: 0, subSessionCount: 0, expanded: false },
);

/** Matches the rows the line runs beside as they fold in or out. */
const LINE_DURATION = `${DURATION_MS}ms`;

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

/** Started from WeChat, or sent a message from WeChat; not for automation runs. */
const weChatLabel = computed(() => {
  if (props.session.automationRun) return undefined;
  switch (props.session.origin) {
    case "wechat":
      return t("sessions.fromWeChat");
    case "wechat-used":
      return t("sessions.usedFromWeChat");
    default:
      return undefined;
  }
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

const row = ref<{ $el: HTMLElement }>();
const FOLDED = { maxHeight: "0px", opacity: 0, marginTop: "-0.25rem" };
const UNFOLDED = { maxHeight: "1.75rem", opacity: 1, marginTop: "0px" };
let folding: Animation | undefined;

/** Folds the row's height (and the 4px gap above it) so rows below follow. */
function fold(motion: "enter" | "leave") {
  const element = row.value?.$el;
  if (!element?.animate) return;
  folding?.cancel();
  element.style.overflow = "hidden";
  folding = element.animate(
    motion === "enter" ? [FOLDED, UNFOLDED] : [UNFOLDED, FOLDED],
    {
      duration: DURATION_MS,
      easing: EASE_OUT_EXPO,
      fill: motion === "leave" ? "forwards" : "none",
    },
  );
  if (motion === "enter")
    folding.onfinish = () => {
      element.style.overflow = "";
    };
}

onMounted(() => {
  if (props.motion === "enter") fold("enter");
});
watch(
  () => props.motion,
  (motion, previous) => {
    if (motion === "leave") fold("leave");
    // Back before it finished leaving, as when expanded again at once.
    else if (previous === "leave") fold("enter");
  },
);

/**
 * A click on the row already open toggles its sub-sessions: opening it again
 * would do nothing, so the user means the list under it.
 */
function onClick() {
  if (props.isActive && props.subSessionCount > 0) emit("toggle");
  else emit("open");
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
  <SidebarMenuSubItem
    ref="row"
    :class="motion === 'leave' && 'pointer-events-none'"
    :inert="motion === 'leave' || undefined"
    @dragstart="emit('dragstart', $event)"
  >
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
        @click="onClick"
        @keydown="onKeydown"
      >
        <WorkflowIcon
          v-if="session.automationRun"
          data-slot="session-automation-icon"
          class="text-muted-foreground"
          aria-hidden="true"
        />
        <span
          v-else-if="weChatLabel"
          data-slot="session-wechat-origin"
          class="flex shrink-0 text-muted-foreground"
          role="img"
          :aria-label="weChatLabel"
          :title="weChatLabel"
        >
          <MessageCircleIcon class="size-4" aria-hidden="true" />
        </span>
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
    <!--
      Tree line from the parent down to its last sub-session, centred under
      the parent's first character (12px padding + half a 14px glyph). One
      element, so it stays whole while rows fold in or out: its height
      follows them on the same curve. It starts at the first sub-session's
      top edge, past the 4px gap; each row is 28px plus that gap, and the
      line ends in a curve at the last row's middle.
    -->
    <span
      v-if="subSessionCount > 0"
      data-slot="session-tree-line"
      aria-hidden="true"
      class="session-tree-line pointer-events-none absolute start-[18.5px] top-[calc(100%+0.25rem)] z-10 w-2.5 rounded-es-lg border-s border-b border-muted-foreground/40"
      :style="{
        height: expanded ? `calc(${subSessionCount} * 2rem - 1.125rem)` : '0px',
        opacity: expanded ? 1 : 0,
      }"
    />
  </SidebarMenuSubItem>
</template>

<style scoped>
.session-tree-line {
  transition-duration: v-bind(LINE_DURATION);
  transition-property: height, opacity;
  transition-timing-function: v-bind(EASE_OUT_EXPO);
}

@media (prefers-reduced-motion: reduce) {
  .session-tree-line {
    transition: none;
  }
}
</style>

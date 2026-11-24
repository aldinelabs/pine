<script setup lang="ts">
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleStopIcon,
  CircleXIcon,
  MessageSquareShareIcon,
  ShieldAlertIcon,
} from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { Spinner } from "@/components/ui/spinner";
import type { AssistantDispatchEntry } from "./dispatchEntry";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

/**
 * A session the Assistant dispatched, in its conversation: the dispatch
 * itself or what the session reported since, as "Project › Session". Once
 * the session exists the card opens it.
 */
const props = defineProps<{ entry: AssistantDispatchEntry }>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const displayName = useProjectDisplayName();
const tabNavigation = useContentTabNavigation();

const session = computed(() =>
  props.entry.sessionId
    ? sessionStore.allRecentSessions.find(
        (candidate) => candidate.id === props.entry.sessionId,
      )
    : undefined,
);
const name = computed(
  () =>
    session.value?.name ||
    props.entry.title ||
    t("project.transcript.sessionNotice.untitled"),
);
const projectName = computed(
  () =>
    displayName(projectStore.projectById(props.entry.projectId)) ||
    props.entry.projectName ||
    "",
);
const LABEL_KEYS = {
  dispatching: "assistant.dispatch.dispatching",
  dispatched: "assistant.dispatch.dispatched",
  "dispatch-failed": "assistant.dispatch.dispatchFailed",
  finished: "assistant.dispatch.finished",
  failed: "assistant.dispatch.failed",
  "awaiting-approval": "assistant.dispatch.awaitingApproval",
  stopped: "assistant.dispatch.stopped",
} as const;
const canOpen = computed(() => !!props.entry.sessionId);

function open(): void {
  const sessionId = props.entry.sessionId;
  if (!sessionId) return;
  // Listed or not yet, the session opens; its tab loads the rest.
  tabNavigation.openSession(
    session.value ?? {
      id: sessionId,
      createdAt: "",
      updatedAt: "",
      messageCount: 0,
      ...(props.entry.title ? { name: props.entry.title } : {}),
    },
    props.entry.projectId,
  );
}
</script>

<template>
  <component
    :is="canOpen ? 'button' : 'div'"
    :type="canOpen ? 'button' : undefined"
    data-testid="assistant-dispatch-card"
    :data-state="entry.state"
    class="flex w-full max-w-md items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 text-left text-sm"
    :class="canOpen && 'cursor-pointer transition-colors hover:bg-muted/60'"
    @click="open"
  >
    <Spinner
      v-if="entry.state === 'dispatching'"
      class="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <MessageSquareShareIcon
      v-else-if="entry.state === 'dispatched'"
      class="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <ShieldAlertIcon
      v-else-if="entry.state === 'awaiting-approval'"
      class="size-4 shrink-0 text-warning"
      aria-hidden="true"
    />
    <CircleXIcon
      v-else-if="entry.state === 'failed' || entry.state === 'dispatch-failed'"
      class="size-4 shrink-0 text-destructive"
      aria-hidden="true"
    />
    <CircleStopIcon
      v-else-if="entry.state === 'stopped'"
      class="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <CircleCheckIcon
      v-else
      class="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="text-xs text-muted-foreground">
        {{ t(LABEL_KEYS[entry.state]) }}
      </span>
      <span data-slot="dispatch-target" class="flex min-w-0 items-center gap-1">
        <span v-if="projectName" class="shrink-0 text-muted-foreground">{{
          projectName
        }}</span>
        <ChevronRightIcon
          v-if="projectName"
          class="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="truncate font-medium">{{ name }}</span>
      </span>
    </span>
  </component>
</template>

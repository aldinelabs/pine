<script setup lang="ts">
import { ConciergeBell, Download, Trash2 } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import SessionDeleteDialog from "@/components/sessions/SessionDeleteDialog.vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Spinner } from "@/components/ui/spinner";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAssistantEntry } from "@/composables/useAssistantEntry";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useSessionExport } from "@/composables/useSessionExport";
import { ASSISTANT_PROJECT_ID, isAssistantProject } from "@/shared/assistant";
import type { PineSessionSummary } from "@/shared/sessions";
import { useAssistantStore } from "@/stores/assistant";
import { useSessionStore } from "@/stores/session";

/**
 * The sidebar's fixed entry for Pine's Assistant, above every project: it
 * opens the Assistant's one tab and shows whether it is working or waits
 * on the user. Its right-click menu offers what a session row's does that
 * applies here: Export, and Delete as Clear conversation.
 */
const { t } = useI18n();
const assistant = useAssistantStore();
const sessionStore = useSessionStore();
const { activeTab } = useContentTabNavigation();
const { openAssistant } = useAssistantEntry();
const { exportSession } = useSessionExport();
const isClearOpen = ref(false);
const isContextMenuOpen = ref(false);

onMounted(() => {
  void assistant.load().catch(() => undefined);
});

const isActive = computed(
  () =>
    activeTab.value?.kind === "session" &&
    isAssistantProject(activeTab.value.projectId),
);

/** Its conversation: the open tab's, else the one main last reported. */
const sessionId = computed(() => {
  const tab = activeTab.value;
  if (
    tab?.kind === "session" &&
    tab.state === "bound" &&
    isAssistantProject(tab.projectId)
  )
    return tab.sessionId;
  return assistant.session?.id;
});

const session = computed<PineSessionSummary | null>(() => {
  const id = sessionId.value;
  if (!id) return null;
  return (
    sessionStore
      .recentSessionsFor(ASSISTANT_PROJECT_ID)
      .find((candidate) => candidate.id === id) ??
    (assistant.session?.id === id ? assistant.session : null) ??
    (sessionStore.activeSession?.id === id ? sessionStore.activeSession : null)
  );
});

const status = computed(() => {
  const id = sessionId.value;
  if (!id) return "idle";
  if (sessionStore.isSessionAwaitingApproval(id)) return "approval";
  if (sessionStore.isSessionAwaitingAnswer(id)) return "answer";
  if (sessionStore.isSessionRunning(id)) return "running";
  return "idle";
});

const STATUS_LABELS = {
  approval: "sessions.awaitingApproval",
  answer: "sessions.awaitingAnswer",
  running: "sessions.statusRunning",
} as const;
</script>

<template>
  <SidebarMenuItem>
    <ContextMenu @update:open="isContextMenuOpen = $event">
      <ContextMenuTrigger as-child>
        <SidebarMenuButton
          data-testid="assistant-entry"
          :data-status="status"
          :is-active="isActive"
          :class="{ 'bg-accent text-accent-foreground': isContextMenuOpen }"
          @click="openAssistant"
        >
          <ConciergeBell aria-hidden="true" />
          <span>{{ t("assistant.name") }}</span>
          <span v-if="status !== 'idle'" class="sr-only">{{
            t(STATUS_LABELS[status])
          }}</span>
          <Spinner
            v-if="status === 'running'"
            class="ms-auto size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            v-else-if="status !== 'idle'"
            data-slot="assistant-entry-waiting"
            class="ms-auto size-2 rounded-full bg-warning"
            aria-hidden="true"
          />
        </SidebarMenuButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem
            :disabled="!session"
            @select="session && exportSession(session.id)"
          >
            <Download aria-hidden="true" />
            {{ t("sessions.exportAction") }}
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            data-testid="assistant-entry-clear"
            :disabled="!session"
            @select="isClearOpen = true"
          >
            <Trash2 aria-hidden="true" />
            {{ t("assistant.clear.action") }}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
    <SessionDeleteDialog
      v-model:open="isClearOpen"
      :session="session"
      assistant
    />
  </SidebarMenuItem>
</template>

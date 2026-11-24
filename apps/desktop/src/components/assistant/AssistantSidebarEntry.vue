<script setup lang="ts">
import { ConciergeBell } from "@lucide/vue";
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Spinner } from "@/components/ui/spinner";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAssistantEntry } from "@/composables/useAssistantEntry";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { isAssistantProject } from "@/shared/assistant";
import { useAssistantStore } from "@/stores/assistant";
import { useSessionStore } from "@/stores/session";

/**
 * The sidebar's fixed entry for Pine's Assistant, above every project: it
 * opens the Assistant's one tab and shows whether it is working or waits
 * on the user.
 */
const { t } = useI18n();
const assistant = useAssistantStore();
const sessionStore = useSessionStore();
const { activeTab } = useContentTabNavigation();
const { openAssistant } = useAssistantEntry();

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
    <SidebarMenuButton
      data-testid="assistant-entry"
      :data-status="status"
      :is-active="isActive"
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
  </SidebarMenuItem>
</template>

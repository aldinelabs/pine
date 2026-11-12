<script setup lang="ts">
import { CheckIcon, CircleXIcon, ShieldAlertIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import type { PineSessionNotice } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";

/** What a sub-session reported to this session; opens the sub-session. */
const props = defineProps<{ notice: PineSessionNotice }>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const tabNavigation = useContentTabNavigation();

/** The sub-session as the sidebar lists it, once it is there. */
const session = computed(() =>
  sessionStore.allRecentSessions.find(
    (candidate) => candidate.id === props.notice.sessionId,
  ),
);
const name = computed(
  () =>
    session.value?.name ||
    props.notice.title ||
    t("project.transcript.sessionNotice.untitled"),
);

const labelKey = computed(() =>
  props.notice.state === "awaiting-approval"
    ? "awaitingApproval"
    : props.notice.state,
);

function open(): void {
  if (session.value)
    tabNavigation.openSession(session.value, props.notice.projectId);
}
</script>

<template>
  <Marker
    :as="session ? 'button' : 'div'"
    :type="session ? 'button' : undefined"
    data-testid="project-session-notice-marker"
    :data-state="notice.state"
    :class="session && 'cursor-pointer text-left hover:text-foreground'"
    @click="open"
  >
    <MarkerIcon>
      <ShieldAlertIcon
        v-if="notice.state === 'awaiting-approval'"
        class="text-warning"
      />
      <CircleXIcon
        v-else-if="notice.state === 'failed'"
        class="text-destructive"
      />
      <CheckIcon v-else />
    </MarkerIcon>
    <MarkerContent>
      {{ t(`project.transcript.sessionNotice.${labelKey}`, { name }) }}
    </MarkerContent>
  </Marker>
</template>

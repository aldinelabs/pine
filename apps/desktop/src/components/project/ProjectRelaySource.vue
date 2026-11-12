<script setup lang="ts">
import { CornerDownRightIcon, MessageSquareIcon } from "@lucide/vue";
import { computed } from "vue";
import { I18nT, useI18n } from "vue-i18n";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import type { PineRelaySource } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";

/**
 * The session a routed message came from, shown above it in place of Pine's
 * routing line; opens that session.
 */
const props = defineProps<{ source: PineRelaySource }>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const tabNavigation = useContentTabNavigation();

/** The sending session as the sidebar lists it, once it is there. */
const session = computed(() =>
  sessionStore.allRecentSessions.find(
    (candidate) => candidate.id === props.source.sessionId,
  ),
);
const name = computed(
  () =>
    session.value?.name ||
    props.source.title ||
    t("project.transcript.sessionNotice.untitled"),
);

function open(): void {
  if (session.value)
    tabNavigation.openSession(session.value, session.value.projectId);
}
</script>

<template>
  <component
    :is="session ? 'button' : 'div'"
    :type="session ? 'button' : undefined"
    data-testid="project-relay-source"
    :data-kind="source.kind"
    class="flex max-w-[80%] items-center gap-1.5 self-end text-xs text-muted-foreground"
    :class="session && 'cursor-pointer hover:text-foreground'"
    @click="open"
  >
    <CornerDownRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
    <I18nT
      :keypath="
        source.kind === 'parent'
          ? 'project.transcript.relay.startedBy'
          : 'project.transcript.relay.from'
      "
      tag="span"
      class="flex min-w-0 items-center gap-1 whitespace-nowrap"
    >
      <template #name>
        <span
          data-slot="relay-source-name"
          class="inline-flex min-w-0 items-center gap-1 font-semibold text-foreground/80"
        >
          <MessageSquareIcon class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ name }}</span>
        </span>
      </template>
    </I18nT>
  </component>
</template>

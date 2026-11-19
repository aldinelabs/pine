<script setup lang="ts">
import {
  CircleAlertIcon,
  MessageSquareTextIcon,
  MicOffIcon,
  RadioIcon,
  SquareIcon,
  UsersRoundIcon,
  Volume2Icon,
  XIcon,
} from "@lucide/vue";
import { useElementSize } from "@vueuse/core";
import { computed, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import LiveContextNotice from "@/components/workbench/LiveContextNotice.vue";
import LiveContextSetup from "@/components/workbench/LiveContextSetup.vue";
import LiveContextStatusBar from "@/components/workbench/LiveContextStatusBar.vue";
import LiveContextTranscript from "@/components/workbench/LiveContextTranscript.vue";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import {
  LIVE_CONTEXT_LOCALES,
  type LiveContextError,
  type LiveContextSource,
  type LiveContextSpeakerKey,
} from "@/shared/liveContext";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useLiveContextStore } from "@/stores/liveContext";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

/**
 * Live Context for the active session: start, pause, or stop transcribing
 * the microphone and system audio, and follow the transcript. The capture is
 * app-wide, so another session's capture shows here as busy. On a new
 * session's page, Start first creates the conversation it captures into.
 */
const { t, locale: uiLocale } = useI18n();
const liveContext = useLiveContextStore();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const tabNavigation = useContentTabNavigation();
const contentTabsStore = useContentTabsStore();

const sources = ref<LiveContextSource[]>(["mic", "system"]);
/** The last capture's language, else the one Pine's interface speaks. */
const locale = ref<string>(
  liveContext.status.locale ??
    LIVE_CONTEXT_LOCALES.find((option) => option === uiLocale.value) ??
    LIVE_CONTEXT_LOCALES.find((option) =>
      option.startsWith(uiLocale.value.slice(0, 2)),
    ) ??
    "en-US",
);
const isBusy = ref(false);
// "Jump to latest" floats just above the controls.
const { height: footerHeight } = useElementSize(
  useTemplateRef("footer"),
  undefined,
  {
    box: "border-box",
  },
);

const target = computed(() => {
  const sessionId = sessionStore.activeSession?.id;
  if (!sessionId) return undefined;
  const projectId =
    sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId;
  return projectId ? { projectId, sessionId } : undefined;
});
/** The new-session tab in front, which Start turns into a conversation. */
const draftTab = computed(() => {
  const tab = tabNavigation.activeSessionTab.value;
  return !target.value && tab?.state === "draft" ? tab : undefined;
});
const status = computed(() => liveContext.status);
const isHere = computed(
  () =>
    liveContext.isCapturing &&
    status.value.sessionId === target.value?.sessionId,
);
const isElsewhere = computed(() => liveContext.isCapturing && !isHere.value);
const segments = computed(() =>
  target.value ? liveContext.segmentsOf(target.value.sessionId) : [],
);
const pending = computed(() =>
  target.value ? liveContext.volatileOf(target.value.sessionId) : [],
);
const speakers = computed(() =>
  target.value
    ? liveContext.speakersOf(target.value.sessionId)
    : { names: {}, merges: {} },
);

/** What the transcript shows while this conversation captures. */
const capture = computed(() => {
  if (!isHere.value) return undefined;
  if (status.value.state === "listening") return "listening";
  if (status.value.state === "paused") return "paused";
  return "starting";
});

/** The capturing conversation, when it is another one. */
const elsewhereSession = computed(() =>
  isElsewhere.value
    ? sessionStore.allRecentSessions.find(
        (session) => session.id === status.value.sessionId,
      )
    : undefined,
);

function showElsewhere(): void {
  const session = elsewhereSession.value;
  if (session) tabNavigation.openSession(session, session.projectId);
}

const identifySpeakers = computed({
  get: () => liveContext.identifySpeakers,
  set: (value: boolean) => (liveContext.identifySpeakers = value),
});

// The transcript loads once per conversation shown.
const loadingSessionId = ref<string>();
watch(
  target,
  (next) => {
    if (!next) return;
    loadingSessionId.value = next.sessionId;
    void liveContext
      .load(next)
      .catch((error: unknown) =>
        handleError(error, {
          id: "live-context.load",
          title: t("project.workbench.liveContext.loadFailed"),
        }),
      )
      .finally(() => {
        if (loadingSessionId.value === next.sessionId)
          loadingSessionId.value = undefined;
      });
  },
  { immediate: true },
);
const loading = computed(
  () =>
    target.value !== undefined &&
    loadingSessionId.value === target.value.sessionId,
);

async function run(action: () => Promise<void>): Promise<void> {
  if (isBusy.value) return;
  isBusy.value = true;
  try {
    await action();
  } catch (error) {
    handleError(error, {
      id: "live-context.action",
      title: t("project.workbench.liveContext.actionFailed"),
    });
  } finally {
    isBusy.value = false;
  }
}

function start(): void {
  if (sources.value.length === 0) return;
  dismissedError.value = undefined;
  const next = target.value;
  if (next) {
    void run(() => liveContext.start(next, sources.value, locale.value));
    return;
  }
  const draft = draftTab.value;
  if (draft) void run(() => startInNewSession(draft.id, draft.projectId));
}

/**
 * Create the conversation the way the composer's first message does, show
 * it in the draft's tab, then capture into it. A failed creation leaves the
 * draft as it was and starts nothing.
 */
async function startInNewSession(
  tabId: string,
  projectId: string,
): Promise<void> {
  const opened = await projectStore.ensureOpen(projectId);
  if (!opened.opened) throw new Error("The project is open elsewhere.");
  // The approval mode the draft's composer would send its first message with.
  const session = await sessionStore.createLiveContextSession(
    projectId,
    contentTabsStore.draftApprovalModeFor(tabId),
  );
  tabNavigation.bindSession(tabId, session);
  await liveContext.start(
    { projectId, sessionId: session.id },
    sources.value,
    locale.value,
  );
}

function rename(speaker: LiveContextSpeakerKey, name: string): void {
  const next = target.value;
  if (next) void run(() => liveContext.renameSpeaker(next, speaker, name));
}

function merge(from: LiveContextSpeakerKey, into: LiveContextSpeakerKey): void {
  const next = target.value;
  if (next) void run(() => liveContext.mergeSpeakers(next, from, into));
}

function openSettings(source: LiveContextSource): void {
  void run(() => liveContext.openPrivacySettings(source));
}

// The last error, until the user dismisses it or starts again.
const dismissedError = ref<LiveContextError>();
const SPEAKER_ERRORS = new Set([
  "speaker_models_failed",
  "speakers_unavailable",
]);
const error = computed(() => {
  const last = status.value.lastError;
  if (!last) return undefined;
  if (!isHere.value && liveContext.isCapturing) return undefined;
  // Compared by content: each status update is a new object.
  const dismissed = dismissedError.value;
  if (
    dismissed &&
    dismissed.code === last.code &&
    dismissed.message === last.message
  )
    return undefined;
  return last;
});
/** The error, as a notice: a permission to grant, or what went wrong. */
const errorNotice = computed(() => {
  const last = error.value;
  if (!last) return undefined;
  const key = "project.workbench.liveContext.error";
  if (last.code === "permission_denied")
    return {
      kind: "permission" as const,
      source: last.source ?? "mic",
      icon: MicOffIcon,
      title: t(`${key}.permission.${last.source ?? "mic"}.title`),
      description: t(`${key}.permission.${last.source ?? "mic"}.description`),
    };
  if (SPEAKER_ERRORS.has(last.code))
    return {
      kind: "speakers" as const,
      icon: UsersRoundIcon,
      title: t("project.workbench.liveContext.speakers.failedTitle"),
      description: last.message,
    };
  const known = ["unsupported_locale", "assets_failed"].includes(last.code)
    ? last.code
    : "generic";
  return {
    kind: "error" as const,
    source: last.code === "capture_failed" ? last.source : undefined,
    icon: CircleAlertIcon,
    title: t(`${key}.${known}`),
    description: last.message,
  };
});

function dismissError(): void {
  dismissedError.value = status.value.lastError;
}
</script>

<template>
  <div
    class="flex min-h-full flex-col px-(--workbench-inset) [--live-context-text-inset:calc(0.75rem+1px)]"
    :style="{ '--live-context-footer-height': `${footerHeight}px` }"
    data-testid="workbench-live-context"
  >
    <Empty
      v-if="!liveContext.available"
      class="flex-1 border-0"
      data-testid="live-context-unavailable"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MicOffIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>
          {{
            t(
              `project.workbench.liveContext.unavailable.${status.unavailableReason ?? "platform"}`,
            )
          }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <Empty
      v-else-if="!target && !draftTab"
      class="flex-1 border-0"
      data-testid="live-context-no-session"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquareTextIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>
          {{ t("project.workbench.liveContext.noSession") }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <template v-else>
      <LiveContextTranscript
        :segments="segments"
        :pending="pending"
        :speakers="speakers"
        :capture="capture"
        :loading="loading"
        @rename="rename"
        @merge="merge"
      />
      <!-- Like the composer: the controls stay at the foot of the card,
           below a long transcript, with any notice right above them. -->
      <div
        ref="footer"
        class="bg-card sticky bottom-0 z-10 mt-auto flex flex-col gap-2 pt-2 pb-(--workbench-inset)"
        data-testid="live-context-controls"
      >
        <LiveContextNotice
          v-if="errorNotice"
          :icon="errorNotice.icon"
          :title="errorNotice.title"
          :description="errorNotice.description"
          :tone="errorNotice.kind === 'speakers' ? 'warning' : 'destructive'"
          data-testid="live-context-error"
          :data-code="error?.code"
        >
          <template #actions>
            <Button
              v-if="errorNotice.kind !== 'speakers' && errorNotice.source"
              size="xs"
              variant="outline"
              data-testid="live-context-open-settings"
              @click="openSettings(errorNotice.source)"
            >
              {{ t("project.workbench.liveContext.openSettings") }}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              data-testid="live-context-dismiss-error"
              @click="dismissError"
            >
              <XIcon data-icon="inline-start" aria-hidden="true" />
              {{ t("project.workbench.liveContext.dismiss") }}
            </Button>
          </template>
        </LiveContextNotice>
        <LiveContextNotice
          v-if="isHere && status.systemSilent"
          :icon="Volume2Icon"
          tone="warning"
          :title="t('project.workbench.liveContext.systemSilent.title')"
          :description="
            t('project.workbench.liveContext.systemSilent.description')
          "
          data-testid="live-context-system-silent"
        >
          <template #actions>
            <Button
              size="xs"
              variant="outline"
              data-testid="live-context-open-settings"
              @click="openSettings('system')"
            >
              {{ t("project.workbench.liveContext.openSettings") }}
            </Button>
          </template>
        </LiveContextNotice>
        <LiveContextNotice
          v-if="isHere && status.speakersDegraded"
          :icon="UsersRoundIcon"
          :title="
            t(
              `project.workbench.liveContext.speakers.degraded.${status.speakersDegraded}`,
            )
          "
          data-testid="live-context-speakers-degraded"
        />
        <LiveContextNotice
          v-if="isElsewhere"
          :icon="RadioIcon"
          :title="t('project.workbench.liveContext.elsewhere')"
          :description="elsewhereSession?.name || undefined"
          data-testid="live-context-elsewhere"
        >
          <template #actions>
            <Button
              v-if="elsewhereSession"
              size="xs"
              variant="outline"
              @click="showElsewhere"
            >
              {{ t("project.workbench.liveContext.showElsewhere") }}
            </Button>
            <Button
              size="xs"
              variant="outline"
              :disabled="isBusy"
              data-testid="live-context-stop"
              @click="run(liveContext.stop)"
            >
              <SquareIcon
                data-icon="inline-start"
                class="size-3 fill-current"
                aria-hidden="true"
              />
              {{ t("project.workbench.liveContext.stop") }}
            </Button>
          </template>
        </LiveContextNotice>
        <LiveContextStatusBar
          v-else-if="isHere"
          :status="status"
          :elapsed-at="liveContext.elapsedAt"
          :levels="liveContext.levelHistory"
          :busy="isBusy"
          @pause="run(liveContext.pause)"
          @resume="run(liveContext.resume)"
          @stop="run(liveContext.stop)"
        />
        <LiveContextSetup
          v-else
          v-model:sources="sources"
          v-model:locale="locale"
          v-model:identify-speakers="identifySpeakers"
          :speakers-available="status.speakersAvailable"
          :continues="segments.length > 0"
          :disabled="isBusy"
          @start="start"
        />
      </div>
    </template>
  </div>
</template>

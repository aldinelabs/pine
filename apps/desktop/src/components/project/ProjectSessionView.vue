<script setup lang="ts">
import {
  containsFileDrag,
  externalFilePaths,
  readProjectEntryDrag,
} from "@/lib/projectFileDrag";
import { hasSessionDrag, readSessionDrag } from "@/lib/sessionDrag";
import { FilesIcon } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import type { PineApprovalAction, PineApprovalMode } from "@/shared/agent";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import {
  attachmentMessagePreview,
  parseAttachmentMessage,
  type PineAttachment,
} from "@/shared/attachments";
import { PineCharacter } from "@/components/pine";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useToolActivityExpansion } from "@/composables/useToolActivityExpansion";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore, type PineTranscriptMessage } from "@/stores/session";
import ProjectSessionParallaxBackground from "./ProjectSessionParallaxBackground.vue";
import ProjectSessionComposer from "./ProjectSessionComposer.vue";
import ProjectTranscriptMessage from "./ProjectTranscriptMessage.vue";
import type { PineToolCall } from "@/shared/sessions";
import { toolFileRequest } from "./toolViewAdapter";
import ProjectTranscriptOutline from "./ProjectTranscriptOutline.vue";
import {
  collapsesTranscriptGap,
  transcriptMessageRenderSignature,
} from "./transcriptLayout";

const { t } = useI18n();
const props = defineProps<{
  /** The tab's project; for a draft, where its first message is sent. */
  projectId: string;
  sessionId?: string;
  tabId: string;
}>();
const contentTabsStore = useContentTabsStore();
const projectStore = useProjectStore();
const tabNavigation = useContentTabNavigation();
const sessionStore = useSessionStore();
const HISTORY_LOAD_THRESHOLD = 240;
const isSubmitting = ref(false);

async function openToolFile(
  path: string,
  toolCall: PineToolCall,
): Promise<boolean> {
  const presentedTarget = contentTabsStore.presentedTargetFor(toolCall.id);
  if (presentedTarget) {
    tabNavigation.activate(
      contentTabsStore.presentFile(presentedTarget, props.projectId).id,
    );
    return true;
  }
  const request = toolFileRequest(
    path,
    projectStore.projectById(props.projectId),
  );
  if (request) {
    tabNavigation.openFile(request);
    return true;
  }
  const presented = tabNavigation.tabs.value.find(
    (tab) =>
      tab.kind === "file" && tab.source === "presented" && tab.path === path,
  );
  if (presented) {
    tabNavigation.activate(presented.id);
    return true;
  }
  if (toolCall.name !== "ui_present_file" || !props.sessionId) return false;
  const target = await window.pine.reopenPresentedToolFile({
    projectId: props.projectId,
    sessionId: props.sessionId,
    toolCallId: toolCall.id,
  });
  if (!target) return false;
  tabNavigation.activate(
    contentTabsStore.presentFile(target, props.projectId, toolCall.id).id,
  );
  return true;
}
// A retained tab always observes its own session, including background events.
const tabState = computed(() =>
  props.sessionId ? sessionStore.stateFor(props.sessionId) : null,
);
const hasEarlierMessages = computed(
  () => tabState.value?.hasEarlierMessages ?? false,
);
const isLoadingMessages = computed(
  () => tabState.value?.isLoadingMessages ?? false,
);
const isRunning = computed(
  () => isSubmitting.value || (tabState.value?.isRunning ?? false),
);
const messages = computed(() => tabState.value?.messages ?? []);
const outlineMessages = computed(() => tabState.value?.outlineMessages ?? []);
const transcriptTurns = computed((previous?: PineTranscriptMessage[]) => {
  const allMessages = new Map(
    outlineMessages.value.map((message) => [message.id, message]),
  );
  for (const message of messages.value) allMessages.set(message.id, message);
  const next = [...allMessages.values()].filter(
    (message) => message.role === "user",
  );
  return previous &&
    previous.length === next.length &&
    next.every((message, index) => previous[index] === message)
    ? previous
    : next;
});
const pendingApprovals = computed(() => tabState.value?.pendingApprovals ?? []);
const pendingQuestionnaires = computed(
  () => tabState.value?.pendingQuestionnaires ?? [],
);
const steeringMessages = computed(() => tabState.value?.steeringMessages ?? []);
const reviewingToolCallIds = computed(
  () => tabState.value?.reviewingToolCallIds ?? new Set<string>(),
);
const draft = ref("");
const hasSubmittedPrompt = ref(false);
const hasConversation = computed(
  () => messages.value.length > 0 || outlineMessages.value.length > 0,
);
const isNewConversation = computed(
  () => props.sessionId === undefined && !hasConversation.value,
);
const attachments = computed<PineAttachment[]>({
  get: () => contentTabsStore.attachmentsFor(props.tabId),
  set: (value) => {
    contentTabsStore.setAttachments(props.tabId, value);
  },
});
const approvalMode = ref<PineApprovalMode>("auto-approve");
const isDraggingFiles = ref(false);
const isTranscriptNavigationActive = ref(false);
let fileDragDepth = 0;
/** The oldest pending approval renders above the composer. */
const pendingApproval = computed(() => pendingApprovals.value[0]);
const pendingQuestionnaire = computed(() => pendingQuestionnaires.value[0]);
/** Tool calls waiting for the user's decision (Let Me Review mode). */
const awaitingApprovalToolCallIds = computed(
  () => new Set(pendingApprovals.value.map((approval) => approval.toolCallId)),
);

/** While a response runs, its last two tool units (folded groups and
 * standalone calls alike) stay expanded; everything folds when it ends. */
const expandedToolRuns = useToolActivityExpansion({ messages, isRunning });

/**
 * Turn gap collapses to the in-turn tool spacing (gap-3) when the model
 * skips thinking and starts a turn directly with a tool call, cancelling the
 * MessageScrollerContent `gap-8` down to that rhythm.
 */
const TOOL_CALL_TURN_MARGIN_CLASS = "-mt-5";

/** Per-message `v-memo` key: only the transcript state a message reads. */
function messageRenderSignature(message: PineTranscriptMessage): string {
  return transcriptMessageRenderSignature(message, {
    expandedToolRuns: expandedToolRuns.value,
    reviewingToolCallIds: reviewingToolCallIds.value,
    awaitingApprovalToolCallIds: awaitingApprovalToolCallIds.value,
    isRunning: isRunning.value,
    hasRewriteHandler: Boolean(props.sessionId),
  });
}

onMounted(() => sessionStore.connectAgentEvents());

watch(approvalMode, (value) => {
  // Prompt requests carry the same value as a fallback; this eager update
  // makes the new policy apply to later tool calls in an already-running turn.
  void sessionStore
    .setApprovalMode(value, props.sessionId ?? null)
    .catch(() => undefined);
});

function submit(message: string): void {
  if (isRunning.value) {
    draft.value = "";
    void sessionStore
      .steer(message, approvalMode.value, props.sessionId ?? null)
      .catch(() => {
        restoreComposerMessage(message);
        toast.error(t("errors.sessionPrompt.title"), {
          description: t("errors.sessionPrompt.description"),
        });
      });
    return;
  }

  const sessionId = props.sessionId;
  const projectId = props.projectId;
  if (
    !contentTabsStore.beginPrompt(
      props.tabId,
      attachmentMessagePreview(message),
    )
  ) {
    return;
  }
  hasSubmittedPrompt.value = true;
  isSubmitting.value = true;
  draft.value = "";
  void projectStore
    .ensureOpen(projectId)
    .then((result) => {
      // Another window owns the project; main has focused that window.
      if (!result.opened) throw new Error("The project is open elsewhere.");
      return sessionStore.prompt(
        message,
        { projectId, sessionId },
        approvalMode.value,
      );
    })
    .then((session) => {
      tabNavigation.bindSession(props.tabId, session);
    })
    .catch(() => {
      restoreComposerMessage(message);
      tabNavigation.failPrompt(props.tabId);
      hasSubmittedPrompt.value = false;
      toast.error(t("errors.sessionPrompt.title"), {
        description: t("errors.sessionPrompt.description"),
      });
    })
    .finally(() => {
      isSubmitting.value = false;
    });
}

async function rewriteMessage(
  messageId: string,
  message: string,
): Promise<boolean> {
  const sessionId = props.sessionId;
  if (!sessionId || isRunning.value) return false;
  try {
    await sessionStore.rewrite(
      sessionId,
      messageId,
      message,
      approvalMode.value,
    );
    return true;
  } catch {
    toast.error(t("project.transcript.editMessageFailed"));
    return false;
  }
}

/** A draft may still change the project its first message goes to. */
function selectDraftProject(projectId: string): void {
  if (props.sessionId || isRunning.value) return;
  contentTabsStore.setDraftProject(props.tabId, projectId);
}

function restoreComposerMessage(message: string): void {
  const parsed = parseAttachmentMessage(message);
  draft.value = [parsed.prompt, draft.value]
    .filter((value) => value.trim())
    .join("\n\n");
  contentTabsStore.addAttachments(props.tabId, parsed.attachments);
}

async function withdrawSteering(message: string): Promise<void> {
  try {
    const restored = await sessionStore.dequeueSteering(
      message,
      props.sessionId ?? null,
    );
    if (!restored) return;
    restoreComposerMessage(restored);
  } catch {
    toast.error(t("project.composer.withdrawSteeringFailed"));
  }
}

function respondToApproval(
  action: PineApprovalAction,
  guidance?: string,
): void {
  void sessionStore
    .respondApproval(
      action,
      guidance,
      pendingApproval.value?.requestId,
      props.sessionId ?? null,
    )
    .catch(() => toast.error(t("errors.sessionPrompt.title")));
}

function respondToQuestionnaire(submission: AskUserQuestionSubmission): void {
  void sessionStore
    .respondQuestionnaire(
      submission,
      pendingQuestionnaire.value?.requestId,
      props.sessionId ?? null,
    )
    .catch(() => toast.error(t("errors.sessionPrompt.title")));
}

function abort(): void {
  void sessionStore.abort(props.sessionId ?? null).catch(() => {
    toast.error(t("errors.sessionAbort.title"), {
      description: t("errors.sessionAbort.description"),
    });
  });
}

async function loadEarlierMessages(): Promise<void> {
  try {
    await sessionStore.loadEarlierMessages(props.sessionId ?? null);
  } catch (error) {
    toast.error(t("errors.sessionHistory.title"), {
      description: t("errors.sessionHistory.description"),
    });
    throw error;
  }
}

function handleTranscriptScroll(
  event: Event,
  isProgrammaticScroll = false,
): void {
  const viewport = event.currentTarget;
  if (!(viewport instanceof HTMLElement)) return;
  if (isProgrammaticScroll || isTranscriptNavigationActive.value) return;
  if (viewport.scrollTop <= HISTORY_LOAD_THRESHOLD) {
    void loadEarlierMessages().catch(() => undefined);
  }
}

async function ensureTranscriptMessageLoaded(messageId: string): Promise<void> {
  while (
    !messages.value.some((message) => message.id === messageId) &&
    hasEarlierMessages.value
  ) {
    const previousCount = messages.value.length;
    await loadEarlierMessages();
    if (messages.value.length === previousCount && hasEarlierMessages.value) {
      throw new Error(`Transcript message ${messageId} was not loaded`);
    }
  }
  if (!messages.value.some((message) => message.id === messageId)) {
    throw new Error(`Transcript message ${messageId} was not found`);
  }
}

function dragContainsAttachments(event: DragEvent): boolean {
  return (
    containsFileDrag(event.dataTransfer) || hasSessionDrag(event.dataTransfer)
  );
}

function handleDragEnter(event: DragEvent): void {
  if (!dragContainsAttachments(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  isDraggingFiles.value = true;
}

function handleDragOver(event: DragEvent): void {
  if (!dragContainsAttachments(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleDragLeave(event: DragEvent): void {
  if (!isDraggingFiles.value) return;
  event.preventDefault();
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) isDraggingFiles.value = false;
}

async function handleDrop(event: DragEvent): Promise<void> {
  if (!dragContainsAttachments(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  isDraggingFiles.value = false;

  try {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const sessionId = readSessionDrag(transfer);
    if (sessionId) {
      // Sessions are dragged from the sidebar, which shows this project.
      const result = await window.pine.attachSession({
        projectId: sessionStore.projectOf(sessionId) ?? props.projectId,
        sessionId,
      });
      const byPath = new Map(
        attachments.value.map((attachment) => [attachment.path, attachment]),
      );
      byPath.set(result.attachment.path, result.attachment);
      attachments.value = [...byPath.values()];
      return;
    }
    // Files from another project's tree stay outside this session's sandbox.
    const entries = readProjectEntryDrag(transfer)?.filter(
      (entry) => entry.projectId === props.projectId,
    );
    if (entries?.length === 0) return;
    const paths = entries ? [] : externalFilePaths(transfer);
    if (!entries && !paths.length) return;
    const result = entries
      ? await window.pine.inspectProjectAttachments(entries)
      : await window.pine.inspectAttachments({ paths });
    const byPath = new Map(
      attachments.value.map((attachment) => [attachment.path, attachment]),
    );
    for (const attachment of result.attachments) {
      byPath.set(attachment.path, attachment);
    }
    attachments.value = [...byPath.values()];
  } catch {
    toast.error(t("project.composer.attachmentDropFailed"));
  }
}
</script>

<template>
  <MessageScrollerProvider
    auto-scroll
    default-scroll-position="last-anchor"
    :scroll-previous-item-peek="64"
    :follow-animated="isRunning"
  >
    <div
      class="session-layout relative flex h-full min-h-0 flex-col"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div
        data-slot="session-transcript-region"
        class="relative isolate min-h-0 w-full flex-1"
      >
        <ProjectSessionParallaxBackground
          v-if="isNewConversation && !hasSubmittedPrompt"
          class="-z-10"
        />

        <div
          v-if="
            isLoadingMessages &&
            messages.length &&
            !isTranscriptNavigationActive
          "
          data-slot="history-loading"
          class="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
          aria-live="polite"
        >
          <Spinner :aria-label="t('project.transcript.loadingHistory')" />
        </div>

        <MessageScroller>
          <MessageScrollerViewport
            @scroll="handleTranscriptScroll"
            @user-scroll-intent="isTranscriptNavigationActive = false"
          >
            <MessageScrollerContent
              class="session-transcript-content mx-auto py-8"
              spacer-class="h-16"
            >
              <Empty v-if="!messages.length && !isLoadingMessages">
                <EmptyHeader>
                  <PineCharacter decorative size="lg" />
                  <EmptyTitle class="font-semibold">
                    {{ t("project.transcript.emptyTitle") }}
                  </EmptyTitle>
                  <EmptyDescription>
                    {{ t("project.transcript.emptyDescription") }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>

              <MessageScrollerItem
                v-for="(message, index) in messages"
                :key="message.id"
                v-memo="[
                  message,
                  messageRenderSignature(message),
                  collapsesTranscriptGap(messages, index),
                ]"
                :message-id="message.id"
                :scroll-anchor="message.role === 'user'"
                :class="
                  collapsesTranscriptGap(messages, index)
                    ? TOOL_CALL_TURN_MARGIN_CLASS
                    : undefined
                "
              >
                <ProjectTranscriptMessage
                  :message="message"
                  :open-file="openToolFile"
                  :expanded-tool-runs="expandedToolRuns"
                  :reviewing-tool-call-ids="reviewingToolCallIds"
                  :awaiting-approval-tool-call-ids="awaitingApprovalToolCallIds"
                  :can-rewrite="!isRunning"
                  :rewrite-message="
                    props.sessionId ? rewriteMessage : undefined
                  "
                />
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>

        <ProjectTranscriptOutline
          :turns="transcriptTurns"
          :ensure-message-loaded="ensureTranscriptMessageLoaded"
          @navigation-state-change="isTranscriptNavigationActive = $event"
        />
      </div>

      <ProjectSessionComposer
        v-model="draft"
        v-model:attachments="attachments"
        v-model:approvalMode="approvalMode"
        :is-running="isRunning"
        :is-active="tabNavigation.activeTabId.value === props.tabId"
        :pending-approval="pendingApproval"
        :is-responding="
          pendingApproval
            ? tabState?.respondingRequestIds.has(pendingApproval.requestId)
            : false
        "
        :pending-questionnaire="pendingQuestionnaire"
        :project-id="props.projectId"
        :session-id="props.sessionId"
        :steering-messages="steeringMessages"
        @select-project="selectDraftProject"
        @abort="abort"
        @respond="respondToApproval"
        @respond-questionnaire="respondToQuestionnaire"
        @submit="submit"
        @withdraw-steering="withdrawSteering"
      />

      <Empty
        v-if="isDraggingFiles"
        data-slot="attachment-drop-overlay"
        class="pointer-events-none absolute inset-x-3 bottom-3 top-0 z-20 w-auto border bg-background/95 shadow-sm backdrop-blur-sm"
        role="status"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilesIcon />
          </EmptyMedia>
          <EmptyTitle>
            {{ t("project.composer.dropAttachmentsTitle") }}
          </EmptyTitle>
          <EmptyDescription>
            {{ t("project.composer.dropAttachmentsDescription") }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  </MessageScrollerProvider>
</template>

<style scoped>
.session-transcript-content {
  width: calc(
    100% - var(--session-composer-gutter) - var(--session-composer-gutter) -
      var(--session-input-padding-inline) - var(--session-input-padding-inline)
  );
  max-width: var(--session-content-max-width);
}
</style>

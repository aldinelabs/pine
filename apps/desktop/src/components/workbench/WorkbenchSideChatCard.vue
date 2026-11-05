<script setup lang="ts">
import {
  ArrowUpIcon,
  CircleAlertIcon,
  MessagesSquareIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import ProjectQuoteList from "@/components/project/ProjectQuoteList.vue";
import ProjectTranscriptMessage from "@/components/project/ProjectTranscriptMessage.vue";
import {
  collapsesTranscriptGap,
  TOOL_CALL_TURN_MARGIN_CLASS,
} from "@/components/project/transcriptLayout";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { useSideChat } from "@/composables/useSideChat";
import type { PineQuote } from "@/shared/quotes";
import { SIDE_CHAT_PANEL, type WorkbenchPosition } from "@/shared/workbench";
import { useSessionStore } from "@/stores/session";
import { useSideChatStore } from "@/stores/sideChat";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchCardAddMenu from "./WorkbenchCardAddMenu.vue";
import WorkbenchCardPanelMenu from "./WorkbenchCardPanelMenu.vue";

/**
 * The side chat of the active conversation, as a workbench card: its first
 * question starts one. It follows the other cards' header and corner rule,
 * and shows its conversation with the transcript's own message rendering; a
 * follow-up shows the passage it asks about above it.
 */
defineProps<{ position: WorkbenchPosition }>();
const { t } = useI18n();
const sessionStore = useSessionStore();
const sideChats = useSideChatStore();
const sideChat = useSideChat();
const workbench = useWorkbenchStore();
const chat = computed(() => sideChats.active(sessionStore.activeSession?.id));
const messages = computed(() => chat.value?.messages ?? []);
const draft = ref("");
const isSending = ref(false);
const isConfirmingDelete = ref(false);
const input = ref<InstanceType<typeof InputGroupTextarea> | null>(null);

const anchorQuote = computed<PineQuote[]>(() =>
  chat.value?.anchor ? [{ text: chat.value.anchor.quote }] : [],
);
const title = computed(() =>
  chat.value?.anchor
    ? t("project.sideChat.followUpTitle")
    : t("project.sideChat.title"),
);

const canSend = computed(
  () =>
    Boolean(sessionStore.activeSession) &&
    !chat.value?.isRunning &&
    !isSending.value &&
    !sideChats.isOpening &&
    draft.value.trim().length > 0,
);

/**
 * Sends a question. The first one starts the side chat, so it forks the
 * conversation as it stands when it is asked.
 */
async function send(): Promise<void> {
  if (!canSend.value) return;
  isSending.value = true;
  try {
    if (!chat.value && !(await sideChat.open())) return;
    const current = chat.value;
    if (!current) return;
    const message = draft.value.trim();
    draft.value = "";
    try {
      await sideChats.prompt(current.id, message);
    } catch {
      draft.value = message;
      toast.error(t("project.sideChat.sendFailed"));
    }
  } finally {
    isSending.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void send();
}

/** Edits an earlier question and asks it again from there. */
async function rewriteMessage(
  messageId: string,
  message: string,
): Promise<boolean> {
  const current = chat.value;
  if (!current || current.isRunning) return false;
  try {
    await sideChats.rewrite(current.id, messageId, message);
    return true;
  } catch {
    toast.error(t("project.transcript.editMessageFailed"));
    return false;
  }
}

async function stop(): Promise<void> {
  if (chat.value) await sideChats.abort(chat.value.id).catch(() => undefined);
}

async function remove(): Promise<void> {
  const current = chat.value;
  const parent = sideChat.parent();
  isConfirmingDelete.value = false;
  if (!current || !parent) return;
  try {
    await sideChats.remove(current.id, parent);
    // A deleted follow-up leaves nothing to show; its card goes with it,
    // and the column folds away when it was the last card.
    workbench.closeCard(SIDE_CHAT_PANEL);
  } catch {
    toast.error(t("project.sideChat.deleteFailed"));
  }
}

// The card, and each side chat it shows, is ready for a question.
watch(
  () => chat.value?.id,
  async () => {
    await nextTick();
    (input.value?.$el as HTMLTextAreaElement | undefined)?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <Card
    size="sm"
    data-testid="workbench-card"
    data-panel="side-chat"
    :data-position="position"
    class="h-full min-h-0 gap-0 rounded-(--workbench-radius) py-0 shadow-none ring-0 [--side-chat-text-inset:calc(var(--workbench-inset)+0.75rem+1px)]"
  >
    <!-- The same header as the other cards: controls at the card's inset,
         the title where their panel switch sits, state on the right. -->
    <CardHeader class="flex shrink-0 items-center gap-1 p-(--workbench-inset)">
      <WorkbenchCardPanelMenu
        :panel="SIDE_CHAT_PANEL"
        :position="position"
        :label="title"
      />
      <span class="text-muted-foreground ml-auto min-w-0 truncate px-1 text-xs">
        {{ chat?.persistent ? "" : t("project.sideChat.notSaved") }}
      </span>
      <div class="flex shrink-0 items-center">
        <WorkbenchCardAddMenu :panel="SIDE_CHAT_PANEL" :position="position" />
        <Button
          v-if="chat?.persistent"
          variant="ghost"
          size="icon"
          :aria-label="t('project.sideChat.delete')"
          :title="t('project.sideChat.delete')"
          @click="isConfirmingDelete = true"
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="workbench-card-close"
          :aria-label="t('project.sideChat.close')"
          :title="t('project.sideChat.close')"
          @click="sideChat.close()"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </CardHeader>
    <CardContent class="flex min-h-0 flex-1 flex-col px-0">
      <!-- The passage sits at the card's inset, a raised surface whose
             corners, and its icon tile's, stay concentric with the card. -->
      <ProjectQuoteList
        v-if="anchorQuote.length"
        class="shrink-0 px-(--workbench-inset) py-0"
        item-class="w-full rounded-(--workbench-inner-radius) bg-muted"
        :quotes="anchorQuote"
        surface="message"
      />
      <Empty v-if="!messages.length" class="flex-1 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription>
            {{ t("project.sideChat.readOnlyHint") }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <MessageScrollerProvider
        v-else
        :key="chat?.id"
        auto-scroll
        default-scroll-position="last-anchor"
        :follow-animated="chat?.isRunning"
      >
        <MessageScroller class="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent
              class="px-(--side-chat-text-inset) py-4"
              spacer-class="h-4"
            >
              <MessageScrollerItem
                v-for="(message, index) in messages"
                :key="message.id"
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
                  :can-rewrite="!chat?.isRunning"
                  :rewrite-message="rewriteMessage"
                />
              </MessageScrollerItem>
              <MessageScrollerItem
                v-if="chat?.error"
                class="flex items-start gap-2 text-sm text-destructive"
              >
                <CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
                {{ chat?.error }}
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <!-- Mirrors the header: a field and its button at the card's inset,
             both on the card's inner corner, text in line with the title. -->
      <form
        class="flex shrink-0 items-end gap-1 p-(--workbench-inset)"
        @submit.prevent="send"
      >
        <InputGroup
          class="h-auto min-h-8 flex-1 rounded-(--workbench-inner-radius) border-0 bg-muted shadow-none has-[textarea]:rounded-(--workbench-inner-radius) dark:bg-muted"
        >
          <InputGroupTextarea
            ref="input"
            v-model="draft"
            data-slot="side-chat-input"
            rows="1"
            class="scroll-fade-y max-h-32 min-h-8 overflow-y-auto px-[calc(var(--side-chat-text-inset)-var(--workbench-inset))] py-1.5 text-sm leading-5"
            :placeholder="t('project.sideChat.placeholder')"
            :aria-label="t('project.sideChat.placeholder')"
            @keydown="handleKeydown"
          />
        </InputGroup>
        <Button
          v-if="chat?.isRunning"
          type="button"
          size="icon"
          variant="secondary"
          :aria-label="t('project.sideChat.stop')"
          :title="t('project.sideChat.stop')"
          @click="stop"
        >
          <SquareIcon />
        </Button>
        <Button
          v-else
          type="submit"
          size="icon"
          :disabled="!canSend"
          :aria-label="t('project.sideChat.send')"
          :title="t('project.sideChat.send')"
        >
          <ArrowUpIcon />
        </Button>
      </form>
    </CardContent>
    <AlertDialog v-model:open="isConfirmingDelete">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("project.sideChat.deleteTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("project.sideChat.deleteDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <Button variant="destructive" @click="remove">
            {{ t("project.sideChat.deleteConfirm") }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Card>
</template>

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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { useSideChat } from "@/composables/useSideChat";
import type { PineQuote } from "@/shared/quotes";
import { SIDE_CHAT_PANEL, type WorkbenchPosition } from "@/shared/workbench";
import { useSessionStore } from "@/stores/session";
import { useSideChatStore } from "@/stores/sideChat";
import WorkbenchCardAddMenu from "./WorkbenchCardAddMenu.vue";
import WorkbenchCardPanelMenu from "./WorkbenchCardPanelMenu.vue";

/**
 * The side chat of the active conversation, as a workbench card: showing
 * the panel starts one. It follows the other cards' header and corner rule,
 * and shows its conversation with the transcript's own message rendering; a
 * follow-up shows the passage it asks about above it.
 */
defineProps<{ position: WorkbenchPosition }>();
const { t } = useI18n();
const sessionStore = useSessionStore();
const sideChats = useSideChatStore();
const sideChat = useSideChat();
const chat = computed(() => sideChats.active(sessionStore.activeSession?.id));
const messages = computed(() => chat.value?.messages ?? []);
const draft = ref("");
const isSending = ref(false);
const input = ref<InstanceType<typeof InputGroupTextarea> | null>(null);

const anchorQuote = computed<PineQuote[]>(() =>
  chat.value?.anchor ? [{ text: chat.value.anchor.quote }] : [],
);
const title = computed(() =>
  chat.value?.anchor
    ? t("project.sideChat.followUpTitle")
    : t("project.sideChat.title"),
);
/** A question is out and nothing has come back yet. */
const isAwaitingReply = computed(
  () =>
    Boolean(chat.value?.isRunning) && messages.value.at(-1)?.role === "user",
);

const canSend = computed(
  () =>
    Boolean(chat.value) &&
    !chat.value?.isRunning &&
    !isSending.value &&
    draft.value.trim().length > 0,
);

async function send(): Promise<void> {
  const current = chat.value;
  if (!current || !canSend.value) return;
  const message = draft.value.trim();
  isSending.value = true;
  draft.value = "";
  try {
    await sideChats.prompt(current.id, message);
  } catch {
    draft.value = message;
    toast.error(t("project.sideChat.sendFailed"));
  } finally {
    isSending.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void send();
}

async function stop(): Promise<void> {
  if (chat.value) await sideChats.abort(chat.value.id).catch(() => undefined);
}

async function remove(): Promise<void> {
  const current = chat.value;
  const parent = sideChat.parent();
  if (!current || !parent) return;
  try {
    await sideChats.remove(current.id, parent);
  } catch {
    toast.error(t("project.sideChat.deleteFailed"));
  }
}

// A card that shows the panel starts a side chat of the conversation, once
// for each conversation it shows.
const startedFor = new Set<string>();
watch(
  () => [sessionStore.activeSession?.id, Boolean(chat.value)] as const,
  ([sessionId, hasChat]) => {
    if (!sessionId || hasChat || startedFor.has(sessionId)) return;
    startedFor.add(sessionId);
    void sideChat.open();
  },
  { immediate: true },
);

// A new side chat is ready for its first question.
watch(
  () => chat.value?.id,
  async (id) => {
    if (!id) return;
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
        {{ chat && !chat.persistent ? t("project.sideChat.notSaved") : "" }}
      </span>
      <div class="flex shrink-0 items-center">
        <WorkbenchCardAddMenu :panel="SIDE_CHAT_PANEL" :position="position" />
        <Button
          v-if="chat?.persistent"
          variant="ghost"
          size="icon"
          :aria-label="t('project.sideChat.delete')"
          :title="t('project.sideChat.delete')"
          @click="remove"
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
      <Empty v-if="!chat" class="flex-1 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{{ t("project.sideChat.emptyTitle") }}</EmptyTitle>
          <EmptyDescription>
            {{ t("project.sideChat.emptyDescription") }}
          </EmptyDescription>
        </EmptyHeader>
        <Button
          :disabled="!sessionStore.activeSession || sideChats.isOpening"
          @click="sideChat.open()"
        >
          {{ t("project.sideChat.start") }}
        </Button>
      </Empty>
      <template v-else>
        <!-- The passage sits at the card's inset, a raised surface whose
             corners, and its icon tile's, stay concentric with the card. -->
        <ProjectQuoteList
          v-if="anchorQuote.length"
          class="shrink-0 px-(--workbench-inset) py-0"
          item-class="w-full max-w-full rounded-(--workbench-inner-radius) border-0 bg-muted"
          media-class="rounded-[calc(var(--workbench-inner-radius)-0.375rem)] bg-background/60"
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
          :key="chat.id"
          auto-scroll
          default-scroll-position="last-anchor"
          :follow-animated="chat.isRunning"
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
                  <ProjectTranscriptMessage :message="message" />
                </MessageScrollerItem>
                <MessageScrollerItem
                  v-if="isAwaitingReply"
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Spinner />
                  {{ t("project.sideChat.thinking") }}
                </MessageScrollerItem>
                <MessageScrollerItem
                  v-if="chat.error"
                  class="flex items-start gap-2 text-sm text-destructive"
                >
                  <CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
                  {{ chat.error }}
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
            v-if="chat.isRunning"
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
      </template>
    </CardContent>
  </Card>
</template>

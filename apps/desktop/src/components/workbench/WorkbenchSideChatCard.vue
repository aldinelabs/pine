<script setup lang="ts">
import {
  ArrowUpIcon,
  CircleAlertIcon,
  MessagesSquareIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import ProjectQuoteList from "@/components/project/ProjectQuoteList.vue";
import { toolIconForName } from "@/components/project/toolKinds";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useSideChat } from "@/composables/useSideChat";
import { cn } from "@/lib/utils";
import type { PineQuote } from "@/shared/quotes";
import type { PineToolCall } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";
import { useSideChatStore } from "@/stores/sideChat";

/**
 * The side chat of the active conversation, as a workbench card: a short
 * conversation of its own, with only replies, compact tool lines and a
 * message box. A follow-up shows the passage it asks about.
 */
defineProps<{ position: "top" | "bottom" }>();
const { t } = useI18n();
const sessionStore = useSessionStore();
const sideChats = useSideChatStore();
const sideChat = useSideChat();
const chat = computed(() => sideChats.active(sessionStore.activeSession?.id));
const draft = ref("");
const isSending = ref(false);
const scroller = useTemplateRef<HTMLElement>("scroller");
const input = ref<InstanceType<typeof Textarea> | null>(null);

const anchorQuote = computed<PineQuote[]>(() =>
  chat.value?.anchor ? [{ text: chat.value.anchor.quote }] : [],
);
const title = computed(() =>
  chat.value?.anchor
    ? t("project.sideChat.followUpTitle")
    : t("project.sideChat.title"),
);

interface Row {
  key: string;
  kind: "user" | "text" | "tool" | "thinking";
  text?: string;
  quotes?: PineQuote[];
  toolCall?: PineToolCall;
  final?: boolean;
}

const rows = computed<Row[]>(() =>
  (chat.value?.messages ?? []).flatMap((message): Row[] => {
    if (message.role === "user") {
      const text = message.blocks
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      const quotes = message.blocks.flatMap((block) =>
        block.type === "quotes" ? block.quotes : [],
      );
      return text || quotes.length
        ? [{ key: message.id, kind: "user", text, quotes }]
        : [];
    }
    return message.blocks.flatMap((block, index): Row[] => {
      const key = `${message.id}:${index}`;
      if (block.type === "text" && block.text.trim())
        return [
          {
            key,
            kind: "text",
            text: block.text,
            final: message.status === "complete",
          },
        ];
      if (block.type === "toolCall")
        return [{ key, kind: "tool", toolCall: block.toolCall }];
      if (
        block.type === "thinking" &&
        message.status === "streaming" &&
        index === message.blocks.length - 1
      )
        return [{ key, kind: "thinking" }];
      return [];
    });
  }),
);

function toolSummary(toolCall: PineToolCall): string {
  const input =
    typeof toolCall.input === "object" &&
    toolCall.input !== null &&
    !Array.isArray(toolCall.input)
      ? (toolCall.input as Record<string, unknown>)
      : {};
  for (const key of ["path", "query", "url", "pattern", "name"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

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

// Follow the newest reply while it streams.
watch(
  () => {
    const last = chat.value?.messages.at(-1);
    return [chat.value?.id, chat.value?.messages.length, last?.blocks];
  },
  async () => {
    await nextTick();
    const element = scroller.value;
    if (element) element.scrollTop = element.scrollHeight;
  },
  { flush: "post" },
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
    class="h-full min-h-0 gap-0 rounded-(--workbench-radius) py-0 shadow-none ring-0"
  >
    <CardHeader class="flex shrink-0 items-center gap-1 p-(--workbench-inset)">
      <span class="flex min-w-0 items-center gap-2 px-2 text-sm font-medium">
        <MessagesSquareIcon
          class="size-4 shrink-0 text-side-chat"
          aria-hidden="true"
        />
        <span class="truncate">{{ title }}</span>
      </span>
      <span
        v-if="chat && !chat.persistent"
        class="truncate text-xs text-muted-foreground"
      >
        {{ t("project.sideChat.notSaved") }}
      </span>
      <div class="ml-auto flex shrink-0 items-center">
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
            <MessagesSquareIcon />
          </EmptyMedia>
          <EmptyTitle>{{ t("project.sideChat.emptyTitle") }}</EmptyTitle>
          <EmptyDescription>
            {{ t("project.sideChat.emptyDescription") }}
          </EmptyDescription>
        </EmptyHeader>
        <Button
          size="sm"
          :disabled="!sessionStore.activeSession || sideChats.isOpening"
          @click="sideChat.open()"
        >
          {{ t("project.sideChat.start") }}
        </Button>
      </Empty>
      <template v-else>
        <ProjectQuoteList
          v-if="anchorQuote.length"
          class="side-chat-anchor shrink-0 px-(--workbench-inset) pb-2"
          :quotes="anchorQuote"
          surface="composer"
        />
        <div
          ref="scroller"
          data-slot="side-chat-messages"
          class="scroll-fade-y min-h-0 flex-1 overflow-y-auto px-3 py-2"
        >
          <p
            v-if="!rows.length"
            class="py-6 text-center text-xs text-muted-foreground"
          >
            {{ t("project.sideChat.readOnlyHint") }}
          </p>
          <div class="flex flex-col gap-3">
            <template v-for="row in rows" :key="row.key">
              <div
                v-if="row.kind === 'user'"
                class="flex max-w-[85%] flex-col items-end gap-1 self-end"
              >
                <ProjectQuoteList
                  v-if="row.quotes?.length"
                  :quotes="row.quotes"
                  surface="message"
                />
                <div
                  v-if="row.text"
                  class="rounded-2xl bg-secondary px-3 py-1.5 text-sm whitespace-pre-wrap text-secondary-foreground"
                >
                  {{ row.text }}
                </div>
              </div>
              <div
                v-else-if="row.kind === 'text'"
                class="transcript-prose text-sm"
              >
                <MarkdownContent :source="row.text ?? ''" :final="row.final" />
              </div>
              <div
                v-else-if="row.kind === 'tool' && row.toolCall"
                data-slot="side-chat-tool"
                :class="
                  cn(
                    'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
                    row.toolCall.status === 'error' && 'text-destructive',
                  )
                "
              >
                <Spinner
                  v-if="
                    row.toolCall.status === 'running' ||
                    row.toolCall.status === 'pending'
                  "
                  class="size-3.5 shrink-0"
                />
                <component
                  :is="toolIconForName(row.toolCall.name)"
                  v-else
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span class="shrink-0 font-medium">{{
                  row.toolCall.name
                }}</span>
                <span class="truncate">{{ toolSummary(row.toolCall) }}</span>
              </div>
              <div
                v-else-if="row.kind === 'thinking'"
                class="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Spinner class="size-3.5" />
                {{ t("project.sideChat.thinking") }}
              </div>
            </template>
            <div
              v-if="chat.isRunning && rows.at(-1)?.kind === 'user'"
              class="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Spinner class="size-3.5" />
              {{ t("project.sideChat.thinking") }}
            </div>
            <p
              v-if="chat.error"
              class="flex items-start gap-1.5 text-xs text-destructive"
            >
              <CircleAlertIcon class="mt-0.5 size-3.5 shrink-0" />
              {{ chat.error }}
            </p>
          </div>
        </div>
        <form
          class="flex shrink-0 items-end gap-1.5 border-t p-(--workbench-inset)"
          @submit.prevent="send"
        >
          <Textarea
            ref="input"
            v-model="draft"
            data-slot="side-chat-input"
            rows="1"
            class="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
            :placeholder="t('project.sideChat.placeholder')"
            :aria-label="t('project.sideChat.placeholder')"
            @keydown="handleKeydown"
          />
          <Button
            v-if="chat.isRunning"
            type="button"
            size="icon-sm"
            variant="secondary"
            class="rounded-full"
            :aria-label="t('project.sideChat.stop')"
            @click="stop"
          >
            <SquareIcon class="fill-current" />
          </Button>
          <Button
            v-else
            type="submit"
            size="icon-sm"
            class="rounded-full"
            :disabled="!canSend"
            :aria-label="t('project.sideChat.send')"
          >
            <ArrowUpIcon />
          </Button>
        </form>
      </template>
    </CardContent>
  </Card>
</template>

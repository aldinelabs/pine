import { acceptHMRUpdate, defineStore } from "pinia";
import { reactive, ref } from "vue";
import { agentLocale, isAppLocale } from "@/app/i18n";
import type { PineAgentEvent, PineJsonValue } from "@/shared/agent";
import {
  parseMessageBlocks,
  transcriptRole,
  type PineContentBlock,
  type PineToolCall,
} from "@/shared/sessions";
import type {
  PineSideChatAnchor,
  PineSideChatMessage,
  PineSideChatSummary,
} from "@/shared/sideChats";
import {
  mergeToolCallBlocks,
  transcriptMessageFromEvent,
  messageCreatedAt,
  type PineTranscriptMessage,
} from "@/stores/session";

export interface SideChatState {
  id: string;
  projectId: string;
  parentSessionId: string;
  /** Saved with the conversation; a plain side chat is not. */
  persistent: boolean;
  anchor?: PineSideChatAnchor;
  messages: PineTranscriptMessage[];
  isRunning: boolean;
  error?: string;
}

export interface SideChatHighlight {
  sideChatId: string;
  anchor: PineSideChatAnchor;
}

function currentAgentLocale() {
  const locale = document.documentElement.lang;
  return agentLocale(isAppLocale(locale) ? locale : "en-US");
}

function record(
  value: PineJsonValue,
): Record<string, PineJsonValue | undefined> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

/**
 * Turns saved Pi messages into transcript messages; tool results complete
 * the tool calls they answer instead of showing on their own.
 */
export function sideChatTranscript(
  saved: readonly PineSideChatMessage[],
): PineTranscriptMessage[] {
  const messages: PineTranscriptMessage[] = [];
  for (const { id, message } of saved) {
    const value = record(message);
    if (value?.role === "toolResult" && typeof value.toolCallId === "string") {
      const toolCallId = value.toolCallId;
      const index = messages.findIndex((candidate) =>
        candidate.blocks.some(
          (block) =>
            block.type === "toolCall" && block.toolCall.id === toolCallId,
        ),
      );
      if (index < 0) continue;
      messages[index] = {
        ...messages[index],
        blocks: mergeToolCallBlocks(messages[index].blocks, toolCallId, {
          status: value.isError === true ? "error" : "complete",
          output: { content: value.content ?? null, details: null },
        }),
      };
      continue;
    }
    const role = transcriptRole(message);
    if (!role) continue;
    const blocks = parseMessageBlocks(message).map((block): PineContentBlock =>
      block.type === "toolCall" && block.toolCall.status === "pending"
        ? { ...block, toolCall: { ...block.toolCall, status: "complete" } }
        : block,
    );
    messages.push({
      id,
      role,
      blocks,
      createdAt: messageCreatedAt(message),
      status: "complete",
      ...(blocks.some((block) => block.type === "thinking")
        ? { thinkingStatus: "complete" as const }
        : {}),
    });
  }
  return messages;
}

/**
 * Side chats of the open conversations. Each conversation shows at most one
 * side chat at a time, in its workbench card; the follow-ups it saved are
 * listed so the transcript can highlight the passages they ask about.
 */
export const useSideChatStore = defineStore("sideChat", () => {
  const chats = reactive(new Map<string, SideChatState>());
  /** The side chat each conversation shows, by the conversation's id. */
  const activeByParent = reactive(new Map<string, string>());
  const savedByParent = reactive(new Map<string, PineSideChatSummary[]>());
  /**
   * Entry ids of messages the transcript still knows by a streamed id. The
   * saved anchor names the entry; the live transcript the streamed message.
   */
  const entryIdByMessageId = reactive(new Map<string, string>());
  const isOpening = ref(false);
  /** Waits for the user to agree to discard a plain side chat. */
  const discardRequest = ref<{ resolve: (confirmed: boolean) => void } | null>(
    null,
  );

  /** Asks before a plain side chat is closed, since it is not saved. */
  function confirmDiscard(): Promise<boolean> {
    discardRequest.value?.resolve(false);
    return new Promise((resolve) => {
      discardRequest.value = { resolve };
    });
  }

  function answerDiscard(confirmed: boolean): void {
    const request = discardRequest.value;
    discardRequest.value = null;
    request?.resolve(confirmed);
  }
  let disconnect: (() => void) | undefined;

  function connect(): void {
    disconnect ??= window.pine.onSideChatEvent(handleEvent);
  }

  function active(parentSessionId: string | undefined) {
    if (!parentSessionId) return undefined;
    const id = activeByParent.get(parentSessionId);
    return id ? chats.get(id) : undefined;
  }

  async function loadSaved(projectId: string, sessionId: string) {
    try {
      const { sideChats } = await window.pine.listSideChats({
        projectId,
        sessionId,
      });
      savedByParent.set(sessionId, sideChats);
    } catch {
      // A conversation without saved side chats, or not yet saved itself.
      savedByParent.set(sessionId, savedByParent.get(sessionId) ?? []);
    }
  }

  function highlightsFor(sessionId: string | undefined): SideChatHighlight[] {
    if (!sessionId) return [];
    return (savedByParent.get(sessionId) ?? []).map((summary) => ({
      sideChatId: summary.id,
      anchor: summary.anchor,
    }));
  }

  /** The entry id a transcript message id stands for. */
  function entryIdOf(messageId: string): string {
    return entryIdByMessageId.get(messageId) ?? messageId;
  }

  async function open(request: {
    projectId: string;
    sessionId: string;
    sideChatId?: string;
    anchor?: PineSideChatAnchor;
  }): Promise<SideChatState> {
    connect();
    const current = active(request.sessionId);
    if (current && request.sideChatId && current.id === request.sideChatId)
      return current;
    isOpening.value = true;
    try {
      if (current) await close(current.id);
      const anchor = request.anchor
        ? { ...request.anchor, messageId: entryIdOf(request.anchor.messageId) }
        : undefined;
      const result = await window.pine.openSideChat({
        projectId: request.projectId,
        sessionId: request.sessionId,
        ...(request.sideChatId ? { sideChatId: request.sideChatId } : {}),
        ...(anchor ? { anchor } : {}),
      });
      if (request.anchor && result.anchor)
        entryIdByMessageId.set(
          request.anchor.messageId,
          result.anchor.messageId,
        );
      const state: SideChatState = {
        id: result.sideChatId,
        projectId: request.projectId,
        parentSessionId: result.parentSessionId,
        persistent: result.persistent,
        ...(result.anchor ? { anchor: result.anchor } : {}),
        messages: sideChatTranscript(result.messages),
        isRunning: false,
      };
      chats.set(state.id, state);
      activeByParent.set(state.parentSessionId, state.id);
      if (state.persistent && state.anchor) {
        const saved = savedByParent.get(state.parentSessionId) ?? [];
        if (!saved.some((summary) => summary.id === state.id))
          savedByParent.set(state.parentSessionId, [
            ...saved,
            {
              id: state.id,
              parentSessionId: state.parentSessionId,
              anchor: state.anchor,
              updatedAt: new Date().toISOString(),
            },
          ]);
      }
      return chats.get(state.id) ?? state;
    } finally {
      isOpening.value = false;
    }
  }

  async function prompt(sideChatId: string, message: string): Promise<void> {
    const chat = chats.get(sideChatId);
    if (!chat || chat.isRunning) return;
    chat.isRunning = true;
    delete chat.error;
    try {
      const result = await window.pine.promptSideChat({
        projectId: chat.projectId,
        sideChatId,
        message,
        locale: currentAgentLocale(),
      });
      if (!result.accepted) chat.isRunning = false;
    } catch (error) {
      chat.isRunning = false;
      throw error;
    }
  }

  async function abort(sideChatId: string): Promise<void> {
    const chat = chats.get(sideChatId);
    if (!chat) return;
    await window.pine.abortSideChat({ projectId: chat.projectId, sideChatId });
  }

  function forget(chat: SideChatState): void {
    chats.delete(chat.id);
    if (activeByParent.get(chat.parentSessionId) === chat.id)
      activeByParent.delete(chat.parentSessionId);
  }

  /** Closes a side chat; a plain one, or a follow-up never asked, is gone. */
  async function close(sideChatId: string): Promise<void> {
    const chat = chats.get(sideChatId);
    if (!chat) return;
    forget(chat);
    try {
      await window.pine.closeSideChat({
        projectId: chat.projectId,
        sideChatId,
      });
    } finally {
      if (
        chat.persistent &&
        !chat.messages.some((message) => message.role === "user")
      )
        savedByParent.set(
          chat.parentSessionId,
          (savedByParent.get(chat.parentSessionId) ?? []).filter(
            (summary) => summary.id !== sideChatId,
          ),
        );
    }
  }

  async function remove(
    sideChatId: string,
    parent: {
      projectId: string;
      sessionId: string;
    },
  ): Promise<void> {
    const chat = chats.get(sideChatId);
    if (chat) forget(chat);
    await window.pine.deleteSideChat({
      projectId: parent.projectId,
      sessionId: parent.sessionId,
      sideChatId,
    });
    savedByParent.set(
      parent.sessionId,
      (savedByParent.get(parent.sessionId) ?? []).filter(
        (summary) => summary.id !== sideChatId,
      ),
    );
  }

  function putMessage(chat: SideChatState, message: PineTranscriptMessage) {
    const index = chat.messages.findIndex((item) => item.id === message.id);
    if (index < 0) chat.messages.push(message);
    else chat.messages[index] = message;
  }

  function toolMessageIndex(chat: SideChatState, toolCallId: string): number {
    for (let index = chat.messages.length - 1; index >= 0; index--)
      if (
        chat.messages[index].blocks.some(
          (block) =>
            block.type === "toolCall" && block.toolCall.id === toolCallId,
        )
      )
        return index;
    return -1;
  }

  function handleEvent(event: PineAgentEvent): void {
    const chat = chats.get(event.sessionId);
    if (!chat) return;
    switch (event.type) {
      case "run-state":
        chat.isRunning =
          event.state === "running" || event.state === "aborting";
        if (event.state === "failed" && event.error) chat.error = event.error;
        return;
      case "session-error":
        chat.error = event.message;
        return;
      case "tool-start":
      case "tool-update":
      case "tool-end": {
        const index = toolMessageIndex(chat, event.toolCallId);
        if (index < 0) return;
        const patch: Partial<PineToolCall> = {
          name: event.toolName,
          status:
            event.type === "tool-end"
              ? event.isError
                ? "error"
                : "complete"
              : "running",
          ...(event.type === "tool-start" && event.payload !== undefined
            ? { input: event.payload }
            : {}),
          ...(event.type === "tool-end" && event.payload !== undefined
            ? { output: event.payload }
            : {}),
        };
        const message = chat.messages[index];
        chat.messages[index] = {
          ...message,
          blocks: mergeToolCallBlocks(message.blocks, event.toolCallId, patch),
        };
        return;
      }
      case "message-start":
      case "message-update":
      case "message-end": {
        const previous = chat.messages.find(
          (message) => message.id === event.messageId,
        );
        const message = transcriptMessageFromEvent(event, previous);
        if (!message) return;
        putMessage(chat, message);
        const role = message.role;
        if (
          event.type === "message-end" &&
          role === "user" &&
          chat.persistent
        ) {
          // The first question becomes the follow-up's title.
          const saved = savedByParent.get(chat.parentSessionId);
          const summary = saved?.find((item) => item.id === chat.id);
          if (summary && !summary.title) {
            const text = parseMessageBlocks(event.message)
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (text) summary.title = text.slice(0, 120);
          }
        }
        return;
      }
      default:
        return;
    }
  }

  function reset(): void {
    chats.clear();
    activeByParent.clear();
    savedByParent.clear();
    entryIdByMessageId.clear();
  }

  return {
    abort,
    active,
    answerDiscard,
    confirmDiscard,
    discardRequest,
    chats,
    close,
    connect,
    entryIdOf,
    handleEvent,
    highlightsFor,
    isOpening,
    loadSaved,
    open,
    prompt,
    remove,
    reset,
    savedByParent,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSideChatStore, import.meta.hot));
}

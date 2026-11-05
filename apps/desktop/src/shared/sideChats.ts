import type { PineAgentEvent, PineJsonValue } from "./agent";

/**
 * Side chats fork a conversation to ask questions beside it with read-only
 * tools. A follow-up side chat is anchored to a passage of one message and
 * saved; a plain side chat lives until it is closed.
 */
export const LIST_SIDE_CHATS_CHANNEL = "side-chats:list" as const;
export const OPEN_SIDE_CHAT_CHANNEL = "side-chat:open" as const;
export const PROMPT_SIDE_CHAT_CHANNEL = "side-chat:prompt" as const;
export const ABORT_SIDE_CHAT_CHANNEL = "side-chat:abort" as const;
export const CLOSE_SIDE_CHAT_CHANNEL = "side-chat:close" as const;
export const DELETE_SIDE_CHAT_CHANNEL = "side-chat:delete" as const;
/** Agent events of side chats, in the shape of session events. */
export const SIDE_CHAT_EVENT_CHANNEL = "side-chat:event" as const;

/** Marks the start of a side chat's own entries and carries its anchor. */
export const PINE_SIDE_CHAT_ENTRY = "pine.side-chat" as const;

/** A passage of a transcript message, in the message's prose characters. */
export interface PineSideChatAnchor {
  messageId: string;
  start: number;
  end: number;
  /** The prose between the offsets, to find the passage again. */
  text: string;
  /** The passage as the user selected it. */
  quote: string;
}

export interface PineSideChatSummary {
  id: string;
  parentSessionId: string;
  anchor: PineSideChatAnchor;
  /** The first question asked, if any. */
  title?: string;
  updatedAt: string;
}

export interface PineSideChatMessage {
  id: string;
  message: PineJsonValue;
}

export interface ListSideChatsRequest {
  projectId: string;
  sessionId: string;
}

export interface ListSideChatsResult {
  sideChats: PineSideChatSummary[];
}

export interface OpenSideChatRequest {
  projectId: string;
  /** The conversation the side chat belongs to. */
  sessionId: string;
  /** Reopens a saved side chat. */
  sideChatId?: string;
  /** Starts a follow-up on this passage; without one, a plain side chat. */
  anchor?: PineSideChatAnchor;
}

export interface OpenSideChatResult {
  sideChatId: string;
  parentSessionId: string;
  persistent: boolean;
  anchor?: PineSideChatAnchor;
  messages: PineSideChatMessage[];
}

export interface PromptSideChatRequest {
  projectId: string;
  sideChatId: string;
  message: string;
  locale?: "en-US" | "zh-CN";
}

export interface PromptSideChatResult {
  accepted: boolean;
}

export interface SideChatControlRequest {
  projectId: string;
  sideChatId: string;
}

export interface DeleteSideChatRequest extends SideChatControlRequest {
  sessionId: string;
}

export function isSideChatAnchor(value: unknown): value is PineSideChatAnchor {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.messageId === "string" &&
    anchor.messageId.length > 0 &&
    typeof anchor.text === "string" &&
    typeof anchor.quote === "string" &&
    Number.isSafeInteger(anchor.start) &&
    Number.isSafeInteger(anchor.end) &&
    (anchor.start as number) >= 0 &&
    (anchor.end as number) > (anchor.start as number)
  );
}

export interface PineSideChatApi {
  listSideChats: (
    request: ListSideChatsRequest,
  ) => Promise<ListSideChatsResult>;
  openSideChat: (request: OpenSideChatRequest) => Promise<OpenSideChatResult>;
  promptSideChat: (
    request: PromptSideChatRequest,
  ) => Promise<PromptSideChatResult>;
  abortSideChat: (
    request: SideChatControlRequest,
  ) => Promise<{ aborted: boolean }>;
  /** Ends a side chat; a plain one is discarded. */
  closeSideChat: (
    request: SideChatControlRequest,
  ) => Promise<{ closed: boolean }>;
  deleteSideChat: (
    request: DeleteSideChatRequest,
  ) => Promise<{ deleted: boolean }>;
  onSideChatEvent: (listener: (event: PineAgentEvent) => void) => () => void;
}

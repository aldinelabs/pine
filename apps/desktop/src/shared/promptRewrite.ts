export const REWRITE_PROMPT_CHANNEL = "prompts:rewrite" as const;
export const SUGGEST_REPLY_CHANNEL = "prompts:suggest-reply" as const;

/** The longest reply suggestion the composer shows. */
export const MAX_REPLY_SUGGESTION_LENGTH = 200;

/** The longest composer text Pine sends to be rewritten. */
export const MAX_PROMPT_REWRITE_INPUT_LENGTH = 20_000;

/**
 * Marks information only the user can supply in a rewritten prompt, as
 * `[[what is missing]]`; the composer selects the first one.
 */
export const PROMPT_REWRITE_PLACEHOLDER_PATTERN = /\[\[[^\][\n]+\]\]/;

/*
 * How much of the conversation the rewriter sees, counted in turns (a user
 * message and the agent's reply to it), as the approval reviewer picks a
 * session's root goal and its latest statements. The rewriter needs the
 * task's goal and enough recent exchange to resolve references ("do it like
 * before", "that file"); the agent itself already has the full history. So:
 * the opening turn's request, which usually states the goal, and the latest
 * turns whole. A single message is cut only when it is unusually long, as a
 * safety limit, keeping its start and end.
 */
export const PROMPT_REWRITE_RECENT_TURNS = 3;
export const PROMPT_REWRITE_MESSAGE_LENGTH = 4_000;
export const PROMPT_REWRITE_MAX_ATTACHMENTS = 50;
export const PROMPT_REWRITE_MAX_QUOTES = 20;
export const PROMPT_REWRITE_QUOTE_LENGTH = 1_500;
export const PROMPT_REWRITE_MAX_FOLDERS = 20;
const PATH_LENGTH = 4_096;
const NAME_LENGTH = 512;

export interface PromptRewriteMessage {
  role: "assistant" | "user";
  text: string;
}

/** Background for the rewriter; none of it is copied into the prompt. */
export interface PromptRewriteContext {
  project?: { name: string; folders: string[] };
  /** Oldest first. */
  conversation?: PromptRewriteMessage[];
  /** Messages between the first one and the recent ones were left out. */
  conversationTrimmed?: boolean;
  /** Files, folders and conversations attached to the draft. */
  attachments?: { name: string; path: string; kind?: string }[];
  /** Passages quoted into the draft. */
  quotes?: { text: string; file?: string; lines?: string }[];
}

export interface RewritePromptRequest {
  prompt: string;
  context?: PromptRewriteContext;
}

export interface RewritePromptResult {
  prompt: string;
}

/** Asks for the user's likely next message once the agent has replied. */
export interface SuggestReplyRequest {
  context: PromptRewriteContext;
}

export interface SuggestReplyResult {
  /** Empty when there is no natural next message. */
  suggestion: string;
}

export const PROMPT_REWRITE_LIMITS = {
  messageLength: PROMPT_REWRITE_MESSAGE_LENGTH,
  // The opening request, then a request and a reply per recent turn.
  conversationMessages: 1 + PROMPT_REWRITE_RECENT_TURNS * 2,
  attachments: PROMPT_REWRITE_MAX_ATTACHMENTS,
  quotes: PROMPT_REWRITE_MAX_QUOTES,
  quoteLength: PROMPT_REWRITE_QUOTE_LENGTH,
  folders: PROMPT_REWRITE_MAX_FOLDERS,
  pathLength: PATH_LENGTH,
  nameLength: NAME_LENGTH,
} as const;

const TRUNCATION_MARK = "\n…[truncated]…\n";

/** Cut an unusually long message to its start and end. */
function clip(text: string, length: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= length) return trimmed;
  const keep = length - TRUNCATION_MARK.length;
  const head = Math.ceil(keep / 2);
  return `${trimmed.slice(0, head)}${TRUNCATION_MARK}${trimmed.slice(trimmed.length - (keep - head))}`;
}

interface Turn {
  request?: string;
  /** The agent's last text in the turn: its answer to the request. */
  reply?: string;
}

/**
 * The part of a conversation the rewriter sees: the opening turn's request
 * and the latest turns, each a request and the agent's final reply.
 * Messages without text are skipped.
 */
export function promptRewriteConversation(
  messages: readonly PromptRewriteMessage[],
): { conversation: PromptRewriteMessage[]; trimmed: boolean } {
  const turns: Turn[] = [];
  for (const message of messages) {
    const text = clip(message.text, PROMPT_REWRITE_MESSAGE_LENGTH);
    if (!text) continue;
    const current = turns.at(-1);
    if (message.role === "user") turns.push({ request: text });
    else if (current) current.reply = text;
    else turns.push({ reply: text });
  }
  const recent = turns.slice(-PROMPT_REWRITE_RECENT_TURNS);
  const opening =
    turns.length > recent.length && turns[0]?.request
      ? { request: turns[0].request }
      : undefined;
  const picked: Turn[] = opening ? [opening, ...recent] : recent;
  const conversation = picked.flatMap((turn) => [
    ...(turn.request ? [{ role: "user" as const, text: turn.request }] : []),
    ...(turn.reply ? [{ role: "assistant" as const, text: turn.reply }] : []),
  ]);
  return {
    conversation,
    trimmed: turns.length > recent.length + (opening ? 1 : 0),
  };
}

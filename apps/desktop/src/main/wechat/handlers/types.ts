// The contract between the inbound pipeline and the command handlers.
// Handlers never send anything themselves: they return the one reply, and
// the pipeline sends it and marks lists and cards delivered with the send
// time.

import type { WeChatSettings } from "../../../shared/wechatRemote";
import type { AskBook } from "../asks";
import type { HandleTables, Pager } from "../handles";
import type { Outbound } from "../outbound";
import type {
  InboundAttachmentsApi,
  WeChatCorePorts,
  WeChatHostPorts,
} from "../ports";
import type { RateLimits } from "../rateLimit";
import type { SessionDirectory } from "../sessionDirectory";
import type {
  CommandName,
  ConfirmAsk,
  HandleKind,
  Parsed,
  ParsedCommand,
  ReplyLanguage,
  WeChatStateStore,
} from "../types";

export interface CommandContext {
  readonly now: number;
  readonly lang: ReplyLanguage;
  readonly inbound: {
    id: string;
    createdAtMs: number;
    pollStartedAtMs: number;
    quotedText?: string;
  };
  /** Set when the command runs because its confirmation ask was approved. */
  readonly confirmed?: ConfirmAsk;
  /** Set when a held message is being executed after `.y`. */
  readonly heldConfirmed: boolean;
  readonly settings: Readonly<WeChatSettings>;
  readonly core: WeChatCorePorts;
  readonly host: Pick<
    WeChatHostPorts,
    "version" | "computerName" | "notify" | "localAutomationApprovals"
  >;
  readonly store: WeChatStateStore;
  readonly sessions: SessionDirectory;
  readonly asks: AskBook;
  readonly handles: HandleTables;
  readonly pager: Pager;
  /** Only `repeatAllowed` (there are no usage limits). */
  readonly limits: RateLimits;
  readonly outbound: Outbound;
  readonly attachments: InboundAttachmentsApi;
  readonly bridge: {
    pause(): Promise<void>;
    /** Runs another parsed input through the same gates (bare number, confirmed command, held batch). */
    dispatch(
      parsed: Parsed,
      options?: {
        confirmed?: ConfirmAsk;
        heldConfirmed?: boolean;
        quotedText?: string;
      },
    ): Promise<CommandResult>;
  };
}

export interface CommandResult {
  /** The one P0 reply. Absent = no reply (typing indicator only). */
  text?: string;
  /** Marks a numbered list as delivered once the reply is sent. */
  numbered?: { kind: HandleKind };
  /** Asks whose card text is part of this reply (`.show`, `.use`, `.pending`): marked delivered / shown at the send time. */
  shown?: { ask: number; full: boolean }[];
  /** Runs after the reply was sent (second message of `.file`, `.compact`). */
  after?: () => Promise<void>;
}

export type CommandHandler = (
  ctx: CommandContext,
  command: ParsedCommand,
) => Promise<CommandResult>;
export type MessageHandler = (
  ctx: CommandContext,
  text: string,
) => Promise<CommandResult>;
export type NumberHandler = (
  ctx: CommandContext,
  numbers: number[],
) => Promise<CommandResult>;
export type CommandHandlers = Partial<Record<CommandName, CommandHandler>>;
export interface HandlerRegistry {
  commands: CommandHandlers;
  message: MessageHandler;
  number: NumberHandler;
}

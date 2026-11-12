// WeChat remote on the headless server: the offline `pine-server wechat`
// commands, which edit the store files directly, and binding from a terminal.
// Nothing here may print the bot token, the QR content as text, the iLink
// verification code or the pairing code.
import path from "node:path";
import { renderUnicodeCompact } from "uqr";
import type { PineApprovalMode } from "../shared/agent";
import { PROJECTS_DIRECTORY } from "../shared/projects";
import {
  applyWeChatSettingsPatch,
  type WeChatBinding,
  type WeChatErrorCode,
  type WeChatNotification,
  type WeChatSettings,
  type WeChatStatus,
} from "../shared/wechatRemote";
import { ProjectRepository } from "../main/projects/projectRepository";
import { wechatUserDigest } from "../main/wechat/bridge";
import { WeChatStore } from "../main/wechat/store";
import type { WeChatSecureState } from "../main/wechat/types";
import { fileCredentialStorage } from "./credentialStorage";
import type { WeChatAction } from "./options";

/** Where the core keeps WeChat remote's two files, under the data directory. */
export function wechatStorePaths(dataDirectory: string): {
  statePath: string;
  securePath: string;
} {
  return {
    statePath: path.join(dataDirectory, "agent", "wechat-remote.json"),
    securePath: path.join(dataDirectory, "wechat-remote-secure"),
  };
}

export const WECHAT_SIGHUP_HINT =
  "A running server applies this when it receives SIGHUP (kill -HUP <pid>) or when it restarts.";

export const WECHAT_YOLO_WARNING =
  "Warning: the ceiling is yolo. Sessions driven from WeChat may then run every tool without asking, once the mode is raised and confirmed in WeChat.";

function modeWord(mode: PineApprovalMode): string {
  return mode === "YOLO" ? "yolo" : mode;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

async function projectLabel(
  dataDirectory: string,
  projectId: string | undefined,
): Promise<string> {
  if (!projectId) return "none (the temporary workspace)";
  try {
    const project = await new ProjectRepository(
      path.join(dataDirectory, PROJECTS_DIRECTORY),
    ).get(projectId);
    return `${project.name} (${projectId})`;
  } catch {
    return `${projectId} (not found; WeChat uses the temporary workspace)`;
  }
}

/** The settings as `wechat status` and `wechat config` print them. */
export function formatWeChatSettings(
  secure: Readonly<WeChatSecureState>,
  language: string,
  defaultProject: string,
): string {
  const { settings } = secure;
  const lines = [
    secure.owner && secure.token
      ? `WeChat: connected to account ${wechatUserDigest(secure.owner.userId)} since ${new Date(secure.owner.boundAt).toISOString()}`
      : "WeChat: not connected. Run the server with --wechat-bind in a terminal to connect an account.",
    `Listening: ${secure.paused ? "no, paused (resume with `wechat config --resume`)" : "yes"}`,
    `Ceiling: ${modeWord(settings.ceilingMode)}`,
    `Default mode: ${modeWord(settings.defaultMode)}`,
    `Default project: ${defaultProject}`,
    `Allow high-risk approvals: ${yesNo(settings.allowHighRiskApprovals)}`,
    `Send files to WeChat: ${yesNo(settings.allowFileSending)}`,
    `Reply language: ${language}`,
  ];
  if (settings.ceilingMode === "YOLO") lines.push("", WECHAT_YOLO_WARNING);
  return lines.join("\n");
}

const RESET_NOTE =
  "The sealed WeChat settings could not be read, so defaults apply and WeChat is paused.";

/**
 * Shows or changes WeChat remote's settings straight from its files. Secure
 * writes re-read the file first, so a change a running server made in the
 * meantime is kept; the server picks this change up on SIGHUP or restart.
 */
export async function runWeChatAction(
  dataDirectory: string,
  action: WeChatAction,
): Promise<string> {
  const store = new WeChatStore({
    ...wechatStorePaths(dataDirectory),
    storage: fileCredentialStorage,
  });
  const loaded = await store.load();
  const notes: string[] = [];

  if (action.kind === "unbind") {
    const wasBound = Boolean(store.secure().token || store.secure().owner);
    await store.clearBinding();
    notes.push(
      wasBound
        ? "Disconnected WeChat. The permission settings are back to their defaults."
        : "WeChat was not connected. The permission settings are back to their defaults.",
      WECHAT_SIGHUP_HINT,
    );
  } else if (action.kind === "config") {
    const projectId = action.patch.defaultProjectId;
    if (typeof projectId === "string") {
      try {
        await new ProjectRepository(
          path.join(dataDirectory, PROJECTS_DIRECTORY),
        ).get(projectId);
      } catch {
        throw new Error(`No project "${projectId}" in ${dataDirectory}.`);
      }
    }
    let settings: WeChatSettings | undefined;
    await store.updateSecure((draft) => {
      draft.settings = applyWeChatSettingsPatch(draft.settings, action.patch);
      if (action.paused !== undefined) draft.paused = action.paused;
      settings = draft.settings;
    });
    const language = action.language;
    if (language !== undefined) {
      await store.update((draft) => {
        draft.language = language;
      });
    }
    const requested = action.patch.defaultMode;
    if (requested && settings && settings.defaultMode !== requested)
      notes.push(
        `The default mode was lowered to ${modeWord(settings.defaultMode)}, the ceiling.`,
      );
    notes.push(WECHAT_SIGHUP_HINT);
  } else if (loaded === "reset") {
    notes.push(RESET_NOTE);
  }

  const secure = store.secure();
  const summary = formatWeChatSettings(
    secure,
    store.get().language,
    await projectLabel(dataDirectory, secure.settings.defaultProjectId),
  );
  return [summary, ...(notes.length ? ["", ...notes] : [])].join("\n");
}

/** The text for the person at the terminal while a WeChat account is bound. */
export function formatWeChatBinding(binding: WeChatBinding): string {
  switch (binding.phase) {
    case "starting":
      return "Asking WeChat for a QR code…";
    case "qr": {
      if (!binding.qrContent) return "Waiting for the QR code…";
      const lines = [
        "Open WeChat on your phone and scan this QR code:",
        "",
        renderUnicodeCompact(binding.qrContent, { border: 2 }),
      ];
      if (binding.expiresAt !== undefined)
        lines.push(
          `Valid until ${new Date(binding.expiresAt).toLocaleTimeString()}.`,
        );
      return lines.join("\n");
    }
    case "scanned":
      return "Scanned. Confirm the connection in WeChat on your phone.";
    case "verify-code":
      return binding.verifyRetry
        ? "That verification code was not accepted."
        : "WeChat asks for the verification code it shows on your phone.";
    case "confirming":
      return "Confirming with WeChat…";
    case "pairing":
      return binding.pairing?.codeSent
        ? "WeChat has answered with a 6-digit pairing code."
        : "Now send any message to the bot in WeChat. It answers with a 6-digit pairing code to type here.";
  }
}

/** Binding asks for codes, so it needs a person at a terminal on both ends. */
export function canBindInteractively(tty: {
  stdinTTY: boolean | undefined;
  stdoutTTY: boolean | undefined;
}): boolean {
  return tty.stdinTTY === true && tty.stdoutTTY === true;
}

export const WECHAT_BIND_NEEDS_TTY =
  "--wechat-bind needs an interactive terminal, because it shows a QR code and asks for the codes WeChat sends. Run `pine-server --wechat-bind` from a terminal (for a service, stop it and run it once in the foreground, or use `docker run -it`). Serving without connecting WeChat.";

const ERROR_TEXT: Record<WeChatErrorCode, string> = {
  "encryption-unavailable":
    "WeChat remote cannot store its settings safely on this system.",
  "binding-expired": "The QR code expired. Run with --wechat-bind again.",
  "binding-blocked":
    "WeChat refused this connection. Try again later, or from another account.",
  "pairing-failed":
    "The pairing code was not confirmed in time. Run with --wechat-bind again.",
  "binding-failed":
    "WeChat could not be connected. Run with --wechat-bind again.",
  "account-mismatch":
    "A different WeChat account is connected. Run `pine-server wechat unbind` first.",
  network: "WeChat could not be reached. Check the network and try again.",
  "settings-reset":
    "The WeChat settings could not be read; defaults apply and WeChat is paused.",
};

export function describeWeChatError(error: WeChatErrorCode): string {
  return ERROR_TEXT[error];
}

function connectionText(status: WeChatStatus): string {
  if (!status.bound) return "not connected";
  if (status.connection === "reauth-required")
    return "needs a new scan; restart the server with --wechat-bind in a terminal";
  const connection =
    status.connection === "online"
      ? "online"
      : status.connection === "retrying"
        ? "reconnecting"
        : "connecting";
  return status.paused ? `${connection}, paused` : connection;
}

/**
 * One log line when the connection, the pause state or an error changed, so
 * the log shows what WeChat remote is doing without any secret in it.
 */
export function describeWeChatChange(
  previous: WeChatStatus | undefined,
  next: WeChatStatus,
): string | undefined {
  const before = previous ? connectionText(previous) : undefined;
  const after = connectionText(next);
  const lines: string[] = [];
  if (before !== after && (previous !== undefined || next.bound))
    lines.push(`WeChat: ${after}.`);
  if (next.error && next.error !== previous?.error)
    lines.push(`WeChat: ${describeWeChatError(next.error)}`);
  return lines.length ? lines.join("\n") : undefined;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function formatWeChatNotification(
  notification: WeChatNotification,
): string {
  const body = oneLine(notification.body);
  return `WeChat: ${oneLine(notification.title)}${body ? ` - ${body}` : ""}`;
}

/** The bridge members terminal binding uses. */
export interface WeChatBindingTarget {
  status(): WeChatStatus;
  startBinding(): Promise<WeChatStatus>;
  cancelBinding(): WeChatStatus;
  submitVerifyCode(code: string): WeChatStatus;
  submitPairingCode(code: string): Promise<WeChatStatus>;
}

/** A question at the terminal; aborting it rejects the answer. */
export interface TerminalPrompt {
  question(text: string, signal: AbortSignal): Promise<string>;
  close(): void;
}

type PromptKind = "verify" | "pairing";

/**
 * Drives one binding from a terminal: prints each QR code, asks for the
 * verification code and then the pairing code, and reports the result.
 * Feed it every status change with `update`. Nothing is approved on its own.
 */
export class WeChatTerminalBinding {
  private active = false;
  private lastText: string | undefined;
  private lastAttemptsLeft: number | undefined;
  private pending: { kind: PromptKind; abort: AbortController } | undefined;
  private settle!: (result: "bound" | "failed") => void;
  /** Resolves when the binding has ended. */
  readonly done: Promise<"bound" | "failed">;

  constructor(
    private readonly deps: {
      bridge: WeChatBindingTarget;
      write: (text: string) => void;
      prompt: TerminalPrompt;
    },
  ) {
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  async start(): Promise<void> {
    let status: WeChatStatus;
    try {
      status = await this.deps.bridge.startBinding();
    } catch (error) {
      this.deps.write(error instanceof Error ? error.message : String(error));
      this.finish("failed");
      return;
    }
    this.active = true;
    this.update(status);
  }

  /** Ends the binding from this side (the server is stopping). */
  cancel(): void {
    if (!this.active) return;
    this.deps.bridge.cancelBinding();
    this.finish("failed");
  }

  update(status: WeChatStatus): void {
    if (!this.active) return;
    const binding = status.binding;
    if (!binding) {
      if (status.bound && !status.error) {
        const owner = status.owner
          ? ` (account ${status.owner.userDigest})`
          : "";
        this.deps.write(`WeChat is connected${owner}. Send .help in WeChat.`);
        this.finish("bound");
      } else {
        this.deps.write(
          status.error
            ? describeWeChatError(status.error)
            : "WeChat binding was cancelled.",
        );
        this.finish("failed");
      }
      return;
    }

    const text = formatWeChatBinding(binding);
    if (text !== this.lastText) {
      this.lastText = text;
      this.deps.write(text);
    }

    const wanted = this.wantedPrompt(binding);
    if (this.pending && this.pending.kind !== wanted) {
      this.pending.abort.abort();
      this.pending = undefined;
    }
    if (!wanted || this.pending) return;
    if (wanted === "verify") this.ask("verify", "Verification code: ");
    else {
      const left = binding.pairing?.attemptsLeft;
      const retry =
        left !== undefined &&
        this.lastAttemptsLeft !== undefined &&
        left < this.lastAttemptsLeft;
      this.lastAttemptsLeft = left;
      this.ask(
        "pairing",
        retry
          ? `Wrong code, ${left} ${left === 1 ? "attempt" : "attempts"} left. Pairing code: `
          : "Pairing code from WeChat: ",
      );
    }
  }

  private wantedPrompt(binding: WeChatBinding): PromptKind | undefined {
    if (binding.phase === "verify-code") return "verify";
    if (binding.phase === "pairing" && binding.pairing?.codeSent)
      return "pairing";
    return undefined;
  }

  private ask(kind: PromptKind, text: string): void {
    const abort = new AbortController();
    const pending = { kind, abort };
    this.pending = pending;
    this.deps.prompt.question(text, abort.signal).then(
      (answer) => {
        if (this.pending !== pending) return;
        this.pending = undefined;
        void this.answer(kind, answer.trim());
      },
      () => {
        if (this.pending === pending) this.pending = undefined;
      },
    );
  }

  private async answer(kind: PromptKind, code: string): Promise<void> {
    const { bridge } = this.deps;
    if (!code) {
      this.update(bridge.status());
      return;
    }
    if (kind === "verify") {
      this.update(bridge.submitVerifyCode(code));
      return;
    }
    let status: WeChatStatus;
    try {
      status = await bridge.submitPairingCode(code);
    } catch {
      status = bridge.status();
    }
    this.update(status);
  }

  private finish(result: "bound" | "failed"): void {
    this.active = false;
    this.pending?.abort.abort();
    this.pending = undefined;
    this.deps.prompt.close();
    this.settle(result);
  }
}

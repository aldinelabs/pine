import { createHash, randomInt } from "node:crypto";
import path from "node:path";
import type { PineAgentEvent } from "../../shared/agent";
import {
  applyWeChatSettingsPatch,
  resetWeChatPermissions,
  type WeChatBinding,
  type WeChatConnection,
  type WeChatErrorCode,
  type WeChatNotificationKind,
  type WeChatSettings,
  type WeChatSettingsPatch,
  type WeChatStatus,
} from "../../shared/wechatRemote";
import type {
  ChannelBinding,
  ChannelBindingEvent,
  ChannelCredentials,
  ChannelFactory,
  ChannelInboundMessage,
  ChannelState,
  MessageChannel,
} from "./channel";
import { createClawBotChannels } from "./clawbotChannel";
import { notice, type NoticeData } from "./notices";
import { PairingMachine } from "./pairing";
import type { WeChatBridgeApi, WeChatBridgeOptions } from "./ports";
import { render } from "./replies";
import { WeChatStore, defaultPersistedState } from "./store";
import type { ReplyLanguage, WeChatStateStore } from "./types";

/** Marks parameters kept for the signature that this version does not read yet. */
function unused(...values: unknown[]): void {
  void values;
}

function defaultRandomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** First 8 hex digits of SHA-256, upper case, as `XXXX-XXXX`. */
export function wechatUserDigest(userId: string): string {
  const hex = createHash("sha256")
    .update(userId, "utf8")
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

interface BindingAttempt {
  handle: ChannelBinding | undefined;
  phase: WeChatBinding["phase"];
  qrContent?: string;
  expiresAt?: number;
  verifyRetry?: boolean;
}

interface PairingAttempt {
  credentials: ChannelCredentials;
  channel: MessageChannel;
  contextToken?: string;
  contextTokenAtMs?: number;
  sends: number;
  cursor: string;
  seen: string[];
  timer?: ReturnType<typeof setTimeout>;
  /** Set once the right code was entered, while the binding is written. */
  completing?: boolean;
}

const FAILED_BINDING: Record<
  Extract<ChannelBindingEvent, { type: "failed" }>["reason"],
  WeChatErrorCode | undefined
> = {
  expired: "binding-expired",
  timeout: "binding-expired",
  blocked: "binding-blocked",
  protocol: "binding-failed",
  cancelled: undefined,
};

/**
 * Connects one WeChat account to Pine: binding and pairing, the sealed
 * settings, pause, and the message channel's lifecycle. The command pipeline
 * is composed on top of this (plan T5A); until then an accepted message only
 * advances the cursor and the dedupe list.
 */
export class WeChatBridge implements WeChatBridgeApi {
  private storeInstance: WeChatStateStore | undefined;
  private channelFactory: ChannelFactory | undefined;
  private readonly now: () => number;
  private readonly randomCode: () => string;
  private loading: Promise<void> | undefined;
  private started = false;
  private disposed = false;

  private channel: MessageChannel | undefined;
  private channelState: ChannelState | undefined;
  private reauth = false;
  private reauthNotified = false;
  private error: WeChatErrorCode | undefined;

  private binding: BindingAttempt | undefined;
  private pairing: PairingAttempt | undefined;
  private readonly pairingMachine = new PairingMachine();

  constructor(protected readonly options: WeChatBridgeOptions) {
    this.now = options.now ?? Date.now;
    this.randomCode = options.randomCode ?? defaultRandomCode;
  }

  // Lifecycle

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    await this.ready();
    this.connectStored();
    this.applyKeepAwake();
    this.emit();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.cancelBindingAttempt();
    await this.endPairing(undefined);
    const channel = this.channel;
    this.channel = undefined;
    this.channelState = undefined;
    await channel?.stop().catch(() => undefined);
    await this.storeInstance?.flush().catch(() => undefined);
    this.options.host.keepAwake(false);
  }

  dispose(): void {
    this.disposed = true;
    this.started = false;
    this.cancelBindingAttempt();
    const pairing = this.pairing;
    this.pairing = undefined;
    this.pairingMachine.reset();
    if (pairing?.timer) clearTimeout(pairing.timer);
    void pairing?.channel.stop().catch(() => undefined);
    void this.channel?.stop().catch(() => undefined);
    this.channel = undefined;
    void this.storeInstance?.flush().catch(() => undefined);
  }

  status(): WeChatStatus {
    const secure = this.store.secure();
    const bound = this.isBound();
    const status: WeChatStatus = {
      bound,
      paused: secure.paused,
      connection: this.connection(),
      settings: { ...secure.settings },
    };
    if (bound && secure.owner) {
      status.owner = {
        userDigest: wechatUserDigest(secure.owner.userId),
        boundAt: secure.owner.boundAt,
      };
    }
    const binding = this.bindingView();
    if (binding) status.binding = binding;
    if (this.error) status.error = this.error;
    return status;
  }

  isListening(): boolean {
    return this.isBound() && !this.store.secure().paused;
  }

  async setPaused(paused: boolean): Promise<WeChatStatus> {
    await this.ready();
    await this.store.updateSecure((draft) => {
      draft.paused = paused;
    });
    this.applyKeepAwake();
    return this.emit();
  }

  async setSettings(patch: WeChatSettingsPatch): Promise<WeChatStatus> {
    await this.ready();
    const candidate =
      typeof patch.defaultProjectId === "string"
        ? patch.defaultProjectId
        : this.store.secure().settings.defaultProjectId;
    const keep = candidate ? await this.projectExists(candidate) : false;
    await this.store.updateSecure((draft) => {
      const next = applyWeChatSettingsPatch(draft.settings, patch);
      if (
        next.defaultProjectId &&
        !(next.defaultProjectId === candidate && keep)
      ) {
        delete next.defaultProjectId;
      }
      draft.settings = next;
    });
    return this.settingsChanged();
  }

  async reloadLocalConfig(): Promise<WeChatStatus> {
    await this.ready();
    const result = await this.store.reloadSecure();
    if (result === "reset") this.settingsReset();
    if (!this.isBound() && this.channel) {
      // The binding was removed on disk (headless `wechat unbind`).
      const channel = this.channel;
      this.channel = undefined;
      this.channelState = undefined;
      await channel.stop().catch(() => undefined);
      await this.store.update((draft) => {
        const language = draft.language;
        Object.assign(draft, defaultPersistedState(), { language });
      });
    }
    if (this.started) this.connectStored();
    return this.settingsChanged();
  }

  wake(): void {
    this.channel?.wake();
    this.pairing?.channel.wake();
  }

  // Binding

  async startBinding(): Promise<WeChatStatus> {
    await this.ready();
    if (!this.store.canEncrypt()) {
      this.error = "encryption-unavailable";
      return this.emit();
    }
    if (this.isBound() && this.connection() !== "reauth-required") {
      throw new Error("WeChat is already connected. Disconnect it first.");
    }
    this.cancelBindingAttempt();
    await this.endPairing(undefined);
    this.error = undefined;
    const attempt: BindingAttempt = { handle: undefined, phase: "starting" };
    this.binding = attempt;
    const existingToken = this.isBound()
      ? this.store.secure().token
      : undefined;
    try {
      attempt.handle = this.channels.bind(
        (event) => this.onBindingEvent(attempt, event),
        existingToken,
      );
    } catch (error) {
      if (this.binding === attempt) this.binding = undefined;
      this.error = "binding-failed";
      console.error("WeChat binding could not start.", describe(error));
    }
    if (this.binding !== attempt) attempt.handle?.cancel();
    return this.emit();
  }

  cancelBinding(): WeChatStatus {
    // A pairing that is already being written finishes; it is not undone.
    if (this.pairing?.completing) return this.status();
    if (this.pairing) {
      void this.endPairing("pairing-failed").then(() => this.emit());
      return this.status();
    }
    this.cancelBindingAttempt();
    return this.emit();
  }

  submitVerifyCode(code: string): WeChatStatus {
    const attempt = this.binding;
    if (attempt?.handle && attempt.phase === "verify-code") {
      attempt.phase = "confirming";
      attempt.verifyRetry = false;
      attempt.handle.submitVerifyCode(code.trim());
    }
    return this.emit();
  }

  async submitPairingCode(code: string): Promise<WeChatStatus> {
    const pairing = this.pairing;
    if (!pairing) throw new Error("No WeChat pairing is in progress.");
    // A second submit while the first one is written changes nothing.
    if (pairing.completing) return this.status();
    const result = this.pairingMachine.submit(code, this.now());
    if (result === "wrong") return this.emit();
    if (result === "failed") {
      await this.endPairing("pairing-failed");
      return this.emit();
    }
    pairing.completing = true;
    await this.completePairing(pairing);
    return this.emit();
  }

  async unbind(): Promise<WeChatStatus> {
    await this.ready();
    this.cancelBindingAttempt();
    await this.endPairing(undefined);
    const channel = this.channel;
    this.channel = undefined;
    this.channelState = undefined;
    await channel?.stop().catch(() => undefined);
    await this.store.clearBinding();
    this.error = undefined;
    this.reauth = false;
    this.reauthNotified = false;
    this.applyKeepAwake();
    return this.emit();
  }

  // Core observers (filled by the command pipeline)

  observeAgentEvent(event: PineAgentEvent, ownerId: number | undefined): void {
    unused(event, ownerId);
  }

  sessionSpawned(
    parentSessionId: string,
    childSessionId: string,
    projectId: string,
  ): void {
    unused(parentSessionId, childSessionId, projectId);
  }

  sessionMoved(
    sessionId: string,
    fromProjectId: string,
    projectId: string,
  ): void {
    unused(sessionId, fromProjectId, projectId);
  }

  automationsChanged(): void {}

  originOf(sessionId: string): "wechat" | "wechat-used" | undefined {
    const origin = this.store
      .get()
      .origins.find((entry) => entry.sessionId === sessionId);
    if (!origin) return undefined;
    return origin.kind === "used" ? "wechat-used" : "wechat";
  }

  automationRunRefusal(
    sessionId: string | undefined,
    automation: { id: string; name: string; enabled: boolean },
  ): string | undefined {
    unused(sessionId, automation);
    return undefined;
  }

  // Internals

  protected get store(): WeChatStateStore {
    if (!this.storeInstance) {
      const { host } = this.options;
      this.storeInstance =
        this.options.store ??
        new WeChatStore({
          statePath: path.join(host.agentDirectory, "wechat-remote.json"),
          securePath: path.join(host.dataDirectory, "wechat-remote-secure"),
          storage: host.credentialStorage,
        });
    }
    return this.storeInstance;
  }

  protected get channels(): ChannelFactory {
    this.channelFactory ??=
      this.options.channels ??
      createClawBotChannels({
        fetch: (url, init) => this.options.host.fetch(url, init),
        version: this.options.host.version,
      });
    return this.channelFactory;
  }

  protected lang(): ReplyLanguage {
    const language = this.store.get().language;
    if (language !== "auto") return language;
    return this.options.host.locale?.() === "zh-CN" ? "zh" : "en";
  }

  private ready(): Promise<void> {
    this.loading ??= this.store.load().then((result) => {
      if (result === "reset") this.settingsReset();
    });
    return this.loading;
  }

  private isBound(): boolean {
    const secure = this.store.secure();
    return Boolean(secure.token && secure.owner);
  }

  private connection(): WeChatConnection {
    if (!this.isBound() && !this.pairing) return "unbound";
    if (this.reauth) return "reauth-required";
    switch (this.channelState) {
      case "online":
      case "retrying":
      case "reauth-required":
        return this.channelState;
      default:
        return "connecting";
    }
  }

  private bindingView(): WeChatBinding | undefined {
    if (this.pairing) {
      const view: WeChatBinding = { phase: "pairing" };
      const pairing = this.pairingMachine.view();
      if (pairing) view.pairing = pairing;
      return view;
    }
    const attempt = this.binding;
    if (!attempt) return undefined;
    const view: WeChatBinding = { phase: attempt.phase };
    if (attempt.qrContent !== undefined) view.qrContent = attempt.qrContent;
    if (attempt.expiresAt !== undefined) view.expiresAt = attempt.expiresAt;
    if (attempt.verifyRetry) view.verifyRetry = true;
    return view;
  }

  private emit(): WeChatStatus {
    const status = this.status();
    try {
      this.options.host.changed(status);
    } catch (error) {
      console.error("WeChat status listener failed.", describe(error));
    }
    return status;
  }

  private notify<K extends WeChatNotificationKind>(
    kind: K,
    ...data: Record<never, never> extends NoticeData[K]
      ? [data?: NoticeData[K]]
      : [data: NoticeData[K]]
  ): void {
    try {
      const texts = notice(kind, this.lang(), ...data);
      this.options.host.notify({ kind, ...texts });
    } catch (error) {
      console.error("WeChat notification failed.", describe(error));
    }
  }

  private settingsReset(): void {
    this.error = "settings-reset";
    this.notify("settings-reset");
  }

  private settingsChanged(): WeChatStatus {
    this.applyKeepAwake();
    return this.emit();
  }

  private applyKeepAwake(): void {
    const on = this.store.secure().settings.keepAwake && this.isListening();
    this.options.host.keepAwake(on);
  }

  private async projectExists(projectId: string): Promise<boolean> {
    try {
      await this.options.core.repository.get(projectId);
      return true;
    } catch {
      return false;
    }
  }

  /** Opens the channel of the stored binding, re-checking its base URL. */
  private connectStored(): void {
    if (this.channel || !this.isBound()) return;
    const secure = this.store.secure();
    const owner = secure.owner;
    const token = secure.token;
    if (!owner || !token) return;
    if (!this.channels.allowsBaseUrl(owner.baseUrl)) {
      this.enterReauth();
      return;
    }
    this.openChannel(
      {
        token,
        botId: owner.botId,
        userId: owner.userId,
        baseUrl: owner.baseUrl,
      },
      this.store.get().cursor,
    );
  }

  private openChannel(credentials: ChannelCredentials, cursor: string): void {
    let channel: MessageChannel;
    try {
      channel = this.channels.open(credentials);
    } catch (error) {
      this.error = "network";
      console.error("WeChat channel could not open.", describe(error));
      return;
    }
    this.channel = channel;
    this.channelState = "connecting";
    this.reauth = false;
    channel.start(
      {
        onMessages: (batch, next) => this.onBoundMessages(channel, batch, next),
        onState: (state) => this.onChannelState(channel, state),
      },
      cursor,
    );
  }

  private onChannelState(channel: MessageChannel, state: ChannelState): void {
    if (channel !== this.channel && channel !== this.pairing?.channel) return;
    this.channelState = state;
    if (state === "reauth-required") {
      if (channel === this.pairing?.channel) {
        void this.endPairing("pairing-failed").then(() => this.emit());
        return;
      }
      this.enterReauth();
    } else if (state === "online") {
      this.reauth = false;
      this.reauthNotified = false;
    }
    this.emit();
  }

  private enterReauth(): void {
    this.reauth = true;
    if (!this.reauthNotified) {
      this.reauthNotified = true;
      this.notify("reauth-required");
    }
  }

  /** Acceptance of plan 5.1 invariant 1, against the given account. */
  private accepted(
    message: ChannelInboundMessage,
    account: { userId: string; botId: string },
    seen: ReadonlySet<string>,
  ): boolean {
    return (
      message.id.length > 0 &&
      message.isUserMessage &&
      message.fromUserId === account.userId &&
      (message.toUserId === undefined ||
        message.toUserId === "" ||
        message.toUserId === account.botId) &&
      !message.groupId &&
      !seen.has(message.id)
    );
  }

  private onBoundMessages(
    channel: MessageChannel,
    batch: ChannelInboundMessage[],
    cursor: string | undefined,
  ): Promise<void> {
    if (channel !== this.channel) return Promise.resolve();
    const owner = this.store.secure().owner;
    const seen = new Set(this.store.get().seenMessageIds);
    const fresh: string[] = [];
    for (const message of batch) {
      if (!owner || !this.accepted(message, owner, seen)) continue;
      seen.add(message.id);
      fresh.push(message.id);
    }
    // The command pipeline (T5A) persists and dispatches accepted messages.
    return this.store.update((draft) => {
      if (cursor !== undefined) draft.cursor = cursor;
      draft.seenMessageIds.push(...fresh);
    });
  }

  private onBindingEvent(
    attempt: BindingAttempt,
    event: ChannelBindingEvent,
  ): void {
    if (this.binding !== attempt) return;
    switch (event.type) {
      case "qr":
        attempt.phase = "qr";
        attempt.qrContent = event.content;
        attempt.expiresAt = event.expiresAtMs;
        break;
      case "scanned":
        attempt.phase = "scanned";
        delete attempt.qrContent;
        delete attempt.expiresAt;
        break;
      case "need-verify-code":
        attempt.phase = "verify-code";
        attempt.verifyRetry = event.retry;
        break;
      case "already-bound":
        this.binding = undefined;
        this.reconnectStored();
        break;
      case "failed":
        this.binding = undefined;
        this.error = FAILED_BINDING[event.reason];
        break;
      case "confirmed":
        attempt.phase = "confirming";
        void this.onConfirmed(attempt, event.credentials).catch(
          (error: unknown) => {
            if (this.binding === attempt) this.binding = undefined;
            this.error = "binding-failed";
            console.error("WeChat binding failed.", describe(error));
            this.emit();
          },
        );
        break;
    }
    this.emit();
  }

  /** iLink says this installation's token is still valid: reconnect with it. */
  private reconnectStored(): void {
    if (!this.isBound()) {
      this.error = "binding-failed";
      return;
    }
    const channel = this.channel;
    this.channel = undefined;
    this.channelState = undefined;
    void channel?.stop().catch(() => undefined);
    this.reauth = false;
    this.reauthNotified = false;
    this.connectStored();
  }

  private async onConfirmed(
    attempt: BindingAttempt,
    credentials: ChannelCredentials,
  ): Promise<void> {
    if (!this.channels.allowsBaseUrl(credentials.baseUrl)) {
      this.binding = undefined;
      this.error = "binding-failed";
      this.emit();
      return;
    }
    const owner = this.store.secure().owner;
    if (owner && this.isBound() && owner.userId === credentials.userId) {
      await this.rescan(credentials);
      if (this.binding === attempt) this.binding = undefined;
      this.emit();
      return;
    }
    if (owner) {
      this.binding = undefined;
      this.error = "account-mismatch";
      this.emit();
      return;
    }
    this.binding = undefined;
    this.beginPairing(credentials);
    this.emit();
  }

  /** The verified account scanned again (after `-14`): new token, same sessions. */
  private async rescan(credentials: ChannelCredentials): Promise<void> {
    const channel = this.channel;
    this.channel = undefined;
    this.channelState = undefined;
    await channel?.stop().catch(() => undefined);
    await this.store.updateSecure((draft) => {
      draft.token = credentials.token;
      if (draft.owner) {
        draft.owner.botId = credentials.botId;
        draft.owner.baseUrl = credentials.baseUrl;
      }
    });
    await this.store.update((draft) => {
      draft.cursor = "";
      delete draft.contextToken;
      draft.seenMessageIds = [];
      draft.inbox = [];
    });
    this.reauth = false;
    this.reauthNotified = false;
    this.error = undefined;
    this.connectStored();
    this.applyKeepAwake();
  }

  private beginPairing(credentials: ChannelCredentials): void {
    let channel: MessageChannel;
    try {
      channel = this.channels.open(credentials);
    } catch (error) {
      this.error = "binding-failed";
      console.error("WeChat channel could not open.", describe(error));
      return;
    }
    const pairing: PairingAttempt = {
      credentials,
      channel,
      sends: 0,
      cursor: "",
      seen: [],
    };
    this.pairing = pairing;
    this.channelState = "connecting";
    this.reauth = false;
    this.pairingMachine.start(this.randomCode(), this.now());
    const expiresAt = this.pairingMachine.expiresAt() ?? this.now();
    pairing.timer = setTimeout(
      () => {
        if (this.pairing !== pairing) return;
        void this.endPairing("pairing-failed").then(() => this.emit());
      },
      Math.max(0, expiresAt - this.now()),
    );
    pairing.timer.unref?.();
    // After pairing this channel becomes the bound one and keeps polling.
    channel.start(
      {
        onMessages: (batch, cursor) =>
          this.pairing === pairing
            ? this.onPairingMessages(pairing, batch, cursor)
            : this.onBoundMessages(channel, batch, cursor),
        onState: (state) => this.onChannelState(channel, state),
      },
      "",
    );
  }

  /** Nothing from WeChat is executed or forwarded here; the only reply is the code. */
  private async onPairingMessages(
    pairing: PairingAttempt,
    batch: ChannelInboundMessage[],
    cursor: string | undefined,
  ): Promise<void> {
    if (this.pairing !== pairing) return;
    if (cursor !== undefined) pairing.cursor = cursor;
    const seen = new Set(pairing.seen);
    let changed = false;
    for (const message of batch) {
      if (!this.accepted(message, pairing.credentials, seen)) continue;
      seen.add(message.id);
      pairing.seen.push(message.id);
      if (message.contextToken) {
        pairing.contextToken = message.contextToken;
        pairing.contextTokenAtMs = this.now();
        pairing.sends = 0;
      }
      if (this.pairingMachine.expired(this.now())) {
        await this.endPairing("pairing-failed");
        this.emit();
        return;
      }
      const decision = this.pairingMachine.onMessage(this.now());
      if (!decision.send || !decision.code) continue;
      changed = true;
      const result = await pairing.channel
        .sendText(
          pairing.credentials.userId,
          pairing.contextToken,
          render("T-PAIR", this.lang(), { code: decision.code }),
        )
        .catch(() => ({ ok: false as const, reason: "network" as const }));
      if (result.ok) pairing.sends += 1;
      if (this.pairing !== pairing) return;
    }
    if (changed) this.emit();
  }

  private async completePairing(pairing: PairingAttempt): Promise<void> {
    if (pairing.timer) clearTimeout(pairing.timer);
    const { credentials } = pairing;
    const boundAt = this.now();
    let settings: WeChatSettings | undefined;
    await this.store.updateSecure((draft) => {
      draft.token = credentials.token;
      draft.owner = {
        userId: credentials.userId,
        botId: credentials.botId,
        baseUrl: credentials.baseUrl,
        boundAt,
      };
      draft.settings = resetWeChatPermissions(draft.settings);
      // Binding is an explicit local act: the new account is listened to.
      draft.paused = false;
      settings = draft.settings;
    });
    await this.store.update((draft) => {
      const language = draft.language;
      Object.assign(draft, defaultPersistedState(), {
        language,
        // Messages seen while pairing are never handled later.
        cursor: pairing.cursor,
        seenMessageIds: [...pairing.seen],
      });
      if (settings?.defaultProjectId) {
        draft.currentProjectId = settings.defaultProjectId;
      }
      if (pairing.contextToken) {
        draft.contextToken = {
          value: pairing.contextToken,
          receivedAtMs: pairing.contextTokenAtMs ?? boundAt,
          sent: pairing.sends + 1,
          budgetNoticeSent: false,
        };
      }
    });
    this.pairing = undefined;
    this.pairingMachine.reset();
    this.error = undefined;
    this.channel = pairing.channel;
    // Messages that arrived while the state was written are kept as seen too.
    this.store.updateSoon((draft) => {
      draft.cursor = pairing.cursor;
      const known = new Set(draft.seenMessageIds);
      draft.seenMessageIds.push(...pairing.seen.filter((id) => !known.has(id)));
    });
    this.applyKeepAwake();
    const secure = this.store.secure();
    await pairing.channel
      .sendText(
        credentials.userId,
        pairing.contextToken,
        render("R-WELCOME", this.lang(), {
          computer: this.options.host.computerName,
          ceiling: secure.settings.ceilingMode,
          files: secure.settings.allowFileSending,
        }),
      )
      .catch(() => undefined);
  }

  /** Stops a pairing in progress and forgets its credentials. */
  private async endPairing(error: WeChatErrorCode | undefined): Promise<void> {
    const pairing = this.pairing;
    if (!pairing) return;
    // A failure seen while the right code is being written does not undo it.
    if (pairing.completing && error !== undefined) return;
    this.pairing = undefined;
    this.pairingMachine.reset();
    if (pairing.timer) clearTimeout(pairing.timer);
    if (!this.channel) this.channelState = undefined;
    if (error) this.error = error;
    await pairing.channel.stop().catch(() => undefined);
  }

  private cancelBindingAttempt(): void {
    const attempt = this.binding;
    this.binding = undefined;
    attempt?.handle?.cancel();
  }
}

/** Error text for the log: the message only, never a request body. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

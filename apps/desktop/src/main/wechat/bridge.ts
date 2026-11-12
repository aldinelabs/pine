import type { PineAgentEvent } from "../../shared/agent";
import {
  DEFAULT_WECHAT_STATUS,
  type WeChatSettingsPatch,
  type WeChatStatus,
} from "../../shared/wechatRemote";
import type { WeChatBridgeApi, WeChatBridgeOptions } from "./ports";

const UNAVAILABLE = "WeChat remote is not available.";

function unavailable(): Promise<WeChatStatus> {
  return Promise.reject(new Error(UNAVAILABLE));
}

/** Marks parameters this inert version keeps for the signature but does not read. */
function unused(...values: unknown[]): void {
  void values;
}

/**
 * Connects one WeChat account to Pine. This version is inert: it reports an
 * unbound status, refuses every change and ignores what the core reports.
 */
export class WeChatBridge implements WeChatBridgeApi {
  constructor(protected readonly options: WeChatBridgeOptions) {}

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {}

  status(): WeChatStatus {
    return {
      ...DEFAULT_WECHAT_STATUS,
      settings: { ...DEFAULT_WECHAT_STATUS.settings },
    };
  }

  isListening(): boolean {
    return false;
  }

  setPaused(paused: boolean): Promise<WeChatStatus> {
    unused(paused);
    return unavailable();
  }

  setSettings(patch: WeChatSettingsPatch): Promise<WeChatStatus> {
    unused(patch);
    return unavailable();
  }

  startBinding(): Promise<WeChatStatus> {
    return unavailable();
  }

  cancelBinding(): WeChatStatus {
    return this.status();
  }

  submitVerifyCode(code: string): WeChatStatus {
    unused(code);
    return this.status();
  }

  submitPairingCode(code: string): Promise<WeChatStatus> {
    unused(code);
    return unavailable();
  }

  unbind(): Promise<WeChatStatus> {
    return unavailable();
  }

  reloadLocalConfig(): Promise<WeChatStatus> {
    return unavailable();
  }

  wake(): void {}

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
    unused(sessionId);
    return undefined;
  }

  automationRunRefusal(
    sessionId: string | undefined,
    automation: { id: string; name: string; enabled: boolean },
  ): string | undefined {
    unused(sessionId, automation);
    return undefined;
  }
}

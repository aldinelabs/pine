// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPROVAL_MODE_ORDER } from "../../../shared/agent";
import {
  DEFAULT_WECHAT_SETTINGS,
  DEFAULT_WECHAT_STATUS,
  WECHAT_CLIENT_ID,
  WECHAT_NOTIFICATION_KINDS,
  applyWeChatSettingsPatch,
  clampWeChatSettings,
  resetWeChatPermissions,
  type WeChatSettings,
} from "../../../shared/wechatRemote";
import { InboundAttachments } from "../attachments";
import { WeChatBridge } from "../bridge";
import { createClawBotChannels } from "../clawbotChannel";
import {
  ALLOW_BARE_APPROVE,
  ASK_MAX,
  ASK_MIN,
  BUDGET,
  PAGE_ROWS,
  PUSH_SLOT,
  USABLE,
} from "../constants";
import type { WeChatBridgeOptions } from "../ports";
import { COMMAND_NAMES, type WeChatStateStore } from "../types";

const wide: WeChatSettings = {
  ceilingMode: "YOLO",
  defaultMode: "autonomous",
  defaultProjectId: "project-1",
  allowHighRiskApprovals: true,
  allowFileSending: true,
  keepAwake: true,
};

describe("command names", () => {
  it("lists 41 unique commands", () => {
    expect(COMMAND_NAMES).toHaveLength(41);
    expect(new Set(COMMAND_NAMES).size).toBe(41);
  });
});

describe("notification kinds", () => {
  it("are unique", () => {
    expect(new Set(WECHAT_NOTIFICATION_KINDS).size).toBe(
      WECHAT_NOTIFICATION_KINDS.length,
    );
  });
});

describe("settings", () => {
  it("clamps the default mode to the ceiling", () => {
    expect(
      clampWeChatSettings({
        ...DEFAULT_WECHAT_SETTINGS,
        ceilingMode: "let-me-review",
        defaultMode: "YOLO",
      }).defaultMode,
    ).toBe("let-me-review");
    expect(clampWeChatSettings(wide)).toEqual(wide);
  });

  it("never returns a default mode above the ceiling", () => {
    for (const ceilingMode of APPROVAL_MODE_ORDER) {
      for (const defaultMode of APPROVAL_MODE_ORDER) {
        const clamped = clampWeChatSettings({
          ...DEFAULT_WECHAT_SETTINGS,
          ceilingMode,
          defaultMode,
        });
        expect(
          APPROVAL_MODE_ORDER.indexOf(clamped.defaultMode),
        ).toBeLessThanOrEqual(APPROVAL_MODE_ORDER.indexOf(ceilingMode));
      }
    }
  });

  it("clears, keeps or sets the default project", () => {
    expect(
      applyWeChatSettingsPatch(wide, { defaultProjectId: null }),
    ).not.toHaveProperty("defaultProjectId");
    expect(
      applyWeChatSettingsPatch(wide, { defaultProjectId: undefined })
        .defaultProjectId,
    ).toBe("project-1");
    expect(applyWeChatSettingsPatch(wide, {}).defaultProjectId).toBe(
      "project-1",
    );
    expect(
      applyWeChatSettingsPatch(DEFAULT_WECHAT_SETTINGS, {
        defaultProjectId: "project-2",
      }).defaultProjectId,
    ).toBe("project-2");
  });

  it("clamps after applying a lower ceiling", () => {
    const next = applyWeChatSettingsPatch(wide, {
      ceilingMode: "auto-approve",
    });
    expect(next.ceilingMode).toBe("auto-approve");
    expect(next.defaultMode).toBe("auto-approve");
    expect(next.keepAwake).toBe(true);
  });

  it("resets the permissions and keeps the rest", () => {
    expect(resetWeChatPermissions(wide)).toEqual({
      ...DEFAULT_WECHAT_SETTINGS,
      defaultProjectId: "project-1",
      keepAwake: true,
    });
  });
});

describe("numbers", () => {
  it("keeps list rows, the push slot and ask numbers apart", () => {
    expect(PAGE_ROWS).toBeLessThan(PUSH_SLOT);
    expect(PUSH_SLOT).toBeLessThan(ASK_MIN);
    expect(ASK_MIN).toBeLessThan(ASK_MAX);
    expect(ASK_MAX).toBeLessThanOrEqual(99);
  });

  it("leaves room in the reply budget", () => {
    expect(USABLE).toBeLessThan(BUDGET);
  });

  it("does not approve on a bare .y", () => {
    expect(ALLOW_BARE_APPROVE).toBe(false);
  });

  it("gives the bridge a virtual client id", () => {
    expect(WECHAT_CLIENT_ID).toBeLessThan(0);
  });
});

describe("inert bridge", () => {
  const bridge = new WeChatBridge({} as WeChatBridgeOptions);

  it("reports an unbound status", async () => {
    await expect(bridge.start()).resolves.toBeUndefined();
    expect(bridge.status()).toEqual(DEFAULT_WECHAT_STATUS);
    expect(bridge.isListening()).toBe(false);
    expect(bridge.cancelBinding()).toEqual(DEFAULT_WECHAT_STATUS);
    expect(bridge.submitVerifyCode("123456")).toEqual(DEFAULT_WECHAT_STATUS);
    expect(bridge.originOf("session-1")).toBeUndefined();
    expect(
      bridge.automationRunRefusal("session-1", {
        id: "a",
        name: "A",
        enabled: true,
      }),
    ).toBeUndefined();
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it("refuses every change", async () => {
    const message = "WeChat remote is not available.";
    await expect(bridge.setPaused(true)).rejects.toThrow(message);
    await expect(bridge.setSettings({ keepAwake: true })).rejects.toThrow(
      message,
    );
    await expect(bridge.startBinding()).rejects.toThrow(message);
    await expect(bridge.submitPairingCode("123456")).rejects.toThrow(message);
    await expect(bridge.unbind()).rejects.toThrow(message);
    await expect(bridge.reloadLocalConfig()).rejects.toThrow(message);
  });

  it("does not let a caller change the shared default status", () => {
    bridge.status().settings.keepAwake = true;
    expect(DEFAULT_WECHAT_STATUS.settings.keepAwake).toBe(false);
  });
});

describe("stubs", () => {
  it("are not implemented yet", async () => {
    expect(() =>
      createClawBotChannels({ fetch: globalThis.fetch, version: "1.0.0" }),
    ).toThrow("not implemented");
    const attachments = new InboundAttachments({
      store: {} as WeChatStateStore,
      directory: "/tmp/wechat-inbox",
      now: () => 0,
    });
    expect(() => attachments.list()).toThrow("not implemented");
    await expect(attachments.drop()).rejects.toThrow("not implemented");
  });
});

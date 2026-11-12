import { describe, expect, it } from "vitest";
import {
  DEFAULT_WECHAT_SETTINGS,
  DEFAULT_WECHAT_STATUS,
  WECHAT_REMOTE_CHANGED_CHANNEL,
  WECHAT_REQUEST_CHANNELS,
  applyWeChatSettingsPatch,
  clampWeChatSettings,
  resetWeChatPermissions,
} from "../wechatRemote";

describe("WeChat remote channels", () => {
  it("lists eight distinct request channels under wechat:", () => {
    expect(WECHAT_REQUEST_CHANNELS).toHaveLength(8);
    expect(new Set(WECHAT_REQUEST_CHANNELS).size).toBe(8);
    for (const channel of WECHAT_REQUEST_CHANNELS) {
      expect(channel.startsWith("wechat:")).toBe(true);
    }
  });

  it("keeps the change event out of the request channels", () => {
    expect(WECHAT_REQUEST_CHANNELS).not.toContain(
      WECHAT_REMOTE_CHANGED_CHANNEL,
    );
  });
});

describe("WeChat remote defaults", () => {
  it("starts unbound with nothing widened", () => {
    expect(DEFAULT_WECHAT_STATUS).toMatchObject({
      bound: false,
      paused: false,
      connection: "unbound",
    });
    expect(DEFAULT_WECHAT_STATUS.settings).toEqual(DEFAULT_WECHAT_SETTINGS);
    expect(DEFAULT_WECHAT_SETTINGS).toEqual({
      ceilingMode: "auto-approve",
      defaultMode: "auto-approve",
      allowHighRiskApprovals: false,
      allowFileSending: false,
      keepAwake: false,
    });
  });
});

describe("WeChat settings helpers", () => {
  it("do not change their input", () => {
    const settings = {
      ...DEFAULT_WECHAT_SETTINGS,
      ceilingMode: "let-me-review" as const,
      defaultMode: "YOLO" as const,
      defaultProjectId: "project-1",
    };
    const copy = { ...settings };
    clampWeChatSettings(settings);
    applyWeChatSettingsPatch(settings, { defaultProjectId: null });
    resetWeChatPermissions(settings);
    expect(settings).toEqual(copy);
  });

  it("raise the default mode only up to the ceiling", () => {
    const next = applyWeChatSettingsPatch(DEFAULT_WECHAT_SETTINGS, {
      defaultMode: "YOLO",
    });
    expect(next.defaultMode).toBe("auto-approve");
    const raised = applyWeChatSettingsPatch(DEFAULT_WECHAT_SETTINGS, {
      ceilingMode: "YOLO",
      defaultMode: "YOLO",
    });
    expect(raised.defaultMode).toBe("YOLO");
  });

  it("reset a raised default mode with the ceiling", () => {
    const reset = resetWeChatPermissions({
      ...DEFAULT_WECHAT_SETTINGS,
      ceilingMode: "YOLO",
      defaultMode: "let-me-review",
    });
    expect(reset.ceilingMode).toBe("auto-approve");
    expect(reset.defaultMode).toBe("auto-approve");
  });
});

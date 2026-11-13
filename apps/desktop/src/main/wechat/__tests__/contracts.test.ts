// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPROVAL_MODE_ORDER } from "../../../shared/agent";
import {
  DEFAULT_WECHAT_SETTINGS,
  WECHAT_CLIENT_ID,
  WECHAT_NOTIFICATION_KINDS,
  applyWeChatSettingsPatch,
  clampWeChatSettings,
  resetWeChatPermissions,
  type WeChatSettings,
} from "../../../shared/wechatRemote";
import {
  ALLOW_BARE_APPROVE,
  ASK_MAX,
  ASK_MIN,
  PAGE_ROWS,
  PUSH_SLOT,
} from "../constants";

const wide: WeChatSettings = {
  ceilingMode: "YOLO",
  defaultMode: "autonomous",
  defaultProjectId: "project-1",
  allowHighRiskApprovals: true,
  allowFileSending: true,
};

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
    expect(next.defaultProjectId).toBe("project-1");
  });

  it("resets the permissions and keeps the rest", () => {
    expect(resetWeChatPermissions(wide)).toEqual({
      ...DEFAULT_WECHAT_SETTINGS,
      defaultProjectId: "project-1",
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

  it("does not approve on a bare .y", () => {
    expect(ALLOW_BARE_APPROVE).toBe(false);
  });

  it("gives the bridge a virtual client id", () => {
    expect(WECHAT_CLIENT_ID).toBeLessThan(0);
  });
});

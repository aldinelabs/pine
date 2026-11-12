// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  WECHAT_NOTIFICATION_KINDS,
  type WeChatNotificationKind,
} from "../../../shared/wechatRemote";
import {
  NOTICE_BODY_MAX,
  NOTICE_SUBJECT_MAX,
  notice,
  type NoticeData,
} from "../notices";
import { codePointLength } from "../text";
import type { ReplyLanguage } from "../types";

const long = "很长的标题".repeat(30);

const SAMPLES: { [K in WeChatNotificationKind]: NoticeData[K] } = {
  "session-started": { project: "pine", title: long, text: long },
  "session-used": { project: "pine", title: "修登录页" },
  "reauth-required": {},
  paused: { running: 2 },
  "file-sent": {
    name: "/Users/kw/secret/report.pdf",
    sizeBytes: 4096,
    title: "修登录页",
  },
  "session-deleted": { project: "pine", title: "旧的调研" },
  "automation-run": { name: "nightly", project: "pine" },
  "mode-raised": { project: "pine", title: "修登录页", mode: "YOLO" },
  "high-risk-approved": {
    project: "pine",
    title: "修登录页",
    tool: "bash",
    subject: `sudo rm -rf ${"x".repeat(200)}`,
  },
  "settings-reset": {},
};

const LANGS: ReplyLanguage[] = ["zh", "en"];

function build(kind: WeChatNotificationKind, lang: ReplyLanguage) {
  const call = notice as (
    kind: WeChatNotificationKind,
    lang: ReplyLanguage,
    data?: unknown,
  ) => { title: string; body: string };
  return call(kind, lang, SAMPLES[kind]);
}

describe("notice", () => {
  it("has a sample for every notification kind", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(
      [...WECHAT_NOTIFICATION_KINDS].sort(),
    );
  });

  describe.each(LANGS)("%s", (lang) => {
    it.each([...WECHAT_NOTIFICATION_KINDS])("renders %s", (kind) => {
      const { title, body } = build(kind, lang);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(codePointLength(body)).toBeLessThanOrEqual(NOTICE_BODY_MAX);
      expect(body).not.toContain("/Users/");
      expect(`${title}${body}`).not.toMatch(/[\n\r]/);
    });
  });

  it("differs between the two languages", () => {
    for (const kind of WECHAT_NOTIFICATION_KINDS)
      expect(build(kind, "zh").title).not.toBe(build(kind, "en").title);
  });

  it("cuts an approval subject to NOTICE_SUBJECT_MAX", () => {
    const { body } = notice(
      "high-risk-approved",
      "en",
      SAMPLES["high-risk-approved"],
    );
    const subject = body.slice(body.indexOf("sudo"));
    expect(codePointLength(subject)).toBe(NOTICE_SUBJECT_MAX);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("works without data where none is needed", () => {
    expect(notice("settings-reset", "en").body).toBe(
      "WeChat settings could not be read and were reset. WeChat remote is paused.",
    );
    expect(notice("paused", "zh").body).toBe(
      "已从微信暂停，可在 设置 › 远程控制 中恢复。",
    );
    expect(notice("mode-raised", "zh", SAMPLES["mode-raised"])).toEqual({
      title: "微信提高了审批模式",
      body: "pine › 修登录页：干就完了",
    });
  });

  it("shows only the base name of a sent file", () => {
    expect(build("file-sent", "en").body).toBe(
      'report.pdf (4 KB), from "修登录页"',
    );
  });
});

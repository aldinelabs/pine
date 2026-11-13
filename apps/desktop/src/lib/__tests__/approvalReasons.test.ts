import { describe, expect, it } from "vitest";
import { APP_LOCALES, createAppI18n } from "@/app/i18n";
import { REVIEW_FAILURE_MESSAGES } from "@/shared/approvalReasons";
import type { PineApprovalReasonCode } from "@/shared/sessions";
import { approvalFailureText, approvalReasonText } from "../approvalReasons";

const CODES: PineApprovalReasonCode[] = [
  "autoReviewUnavailable",
  "autoReviewerDenied",
  "escalationLimit",
  "authorizationUnclear",
];

function translator(locale: (typeof APP_LOCALES)[number]) {
  const i18n = createAppI18n(locale).global;
  return {
    t: (key: string, named?: Record<string, unknown>) =>
      i18n.t(key, named ?? {}),
    te: (key: string) => i18n.te(key, locale),
  };
}

describe("approvalReasons", () => {
  it.each(APP_LOCALES)("has every reason and failure in %s", (locale) => {
    const { te } = translator(locale);
    for (const code of CODES) {
      expect(te(`project.approvalReasons.${code}`)).toBe(true);
    }
    for (const code of Object.keys(REVIEW_FAILURE_MESSAGES)) {
      expect(te(`project.approvalReasons.failures.${code}`)).toBe(true);
    }
  });

  it("renders each code localized, with a known failure detail localized too", () => {
    const { t } = translator("zh-CN");
    expect(
      approvalReasonText(
        {
          reason: "Auto-review unavailable: provider down",
          reasonCode: "autoReviewUnavailable",
          reasonDetail: "provider down",
        },
        t,
      ),
    ).toBe("自动审查不可用：provider down");
    expect(
      approvalReasonText(
        {
          reasonCode: "autoReviewUnavailable",
          reasonDetail: REVIEW_FAILURE_MESSAGES.omittedCall,
        },
        t,
      ),
    ).toBe("自动审查不可用：审查模型的裁决遗漏了这次工具调用。");
    expect(approvalReasonText({ reasonCode: "autoReviewerDenied" }, t)).toBe(
      "自动审查拒绝了这次调用。",
    );
    expect(approvalReasonText({ reasonCode: "escalationLimit" }, t)).toMatch(
      /^本轮升级审查次数过多/,
    );
    expect(
      approvalReasonText({ reasonCode: "authorizationUnclear" }, t),
    ).toMatch(/^理由尚不足以证明/);
  });

  it("recognises the English text of records saved without a code", () => {
    const { t } = translator("zh-CN");
    const legacy: Record<string, string> = {
      "Auto-review unavailable: The reviewer omitted this tool call from its rulings.":
        "自动审查不可用：审查模型的裁决遗漏了这次工具调用。",
      "Auto-review unavailable: No approval model is configured.":
        "自动审查不可用：未配置审批模型。",
      "The auto-reviewer denied this call.": "自动审查拒绝了这次调用。",
      "Too many escalations in this turn; revise the requested action and its rationale before retrying.":
        "本轮升级审查次数过多；智能体需修改操作及理由后再重试。",
      "The rationale does not yet establish authorization for this call. Explain the exact need and scope before retrying.":
        "理由尚不足以证明这次调用已获授权；智能体需说明确切需要和范围后再重试。",
    };
    for (const [reason, expected] of Object.entries(legacy)) {
      expect(approvalReasonText({ reason }, t)).toBe(expected);
    }
  });

  it("keeps reviewer prose and provider errors as written", () => {
    const { t } = translator("zh-CN");
    expect(approvalReasonText({ reason: "Use git clean -n first." }, t)).toBe(
      "Use git clean -n first.",
    );
    expect(approvalFailureText("HTTP 503", t)).toBe("HTTP 503");
    expect(approvalReasonText({}, t)).toBeUndefined();
  });
});

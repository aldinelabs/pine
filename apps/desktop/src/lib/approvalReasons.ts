import { reviewFailureCode } from "@/shared/approvalReasons";
import type { PineApprovalReasonCode } from "@/shared/sessions";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export interface ApprovalReasonSource {
  reason?: string;
  reasonCode?: PineApprovalReasonCode;
  reasonDetail?: string;
}

const UNAVAILABLE_PREFIX = "Auto-review unavailable: ";

// Records saved before reasons carried a code only have the English text;
// recognise those so older transcripts are localized too.
const legacyApprovalReasonCodes: Record<string, PineApprovalReasonCode> = {
  "The auto-reviewer denied this call.": "autoReviewerDenied",
  "Too many escalations in this turn; revise the requested action and its rationale before retrying.":
    "escalationLimit",
  "The rationale does not yet establish authorization for this call. Explain the exact need and scope before retrying.":
    "authorizationUnclear",
};

function codedReason(
  source: ApprovalReasonSource,
): { code: PineApprovalReasonCode; detail?: string } | undefined {
  if (source.reasonCode) {
    return { code: source.reasonCode, detail: source.reasonDetail };
  }
  const reason = source.reason;
  if (!reason) return undefined;
  const legacy = legacyApprovalReasonCodes[reason];
  if (legacy) return { code: legacy };
  if (reason.startsWith(UNAVAILABLE_PREFIX)) {
    return {
      code: "autoReviewUnavailable",
      detail: reason.slice(UNAVAILABLE_PREFIX.length),
    };
  }
  return undefined;
}

/** A failure message Pine wrote in the UI language; provider errors as written. */
export function approvalFailureText(message: string, t: Translate): string {
  const code = reviewFailureCode(message);
  return code ? t(`project.approvalReasons.failures.${code}`) : message;
}

/** A Pine-authored approval reason in the UI language; other reasons as written. */
export function approvalReasonText(
  source: ApprovalReasonSource,
  t: Translate,
): string | undefined {
  const coded = codedReason(source);
  if (!coded) return source.reason;
  return t(`project.approvalReasons.${coded.code}`, {
    detail: coded.detail ? approvalFailureText(coded.detail, t) : "",
  });
}

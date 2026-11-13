/**
 * Fixed English failure messages Pine writes when the approval model cannot
 * rule. The agent and stored records keep this text; the UI recognises the
 * exact strings and shows them in the interface language.
 */
export const REVIEW_FAILURE_MESSAGES = {
  noApprovalModel: "No approval model is configured.",
  noResponse: "The reviewer returned no response.",
  noRuling: "The reviewer did not submit a ruling.",
  malformedRulings: "The reviewer's rulings were malformed.",
  rulingCountMismatch: "The reviewer did not return one ruling per tool call.",
  streamFailed: "The reviewer stream failed.",
  omittedCall: "The reviewer omitted this tool call from its rulings.",
} as const;

export type ReviewFailureCode = keyof typeof REVIEW_FAILURE_MESSAGES;

const failureCodes = new Map<string, ReviewFailureCode>(
  Object.entries(REVIEW_FAILURE_MESSAGES).map(([code, message]) => [
    message,
    code as ReviewFailureCode,
  ]),
);

export function reviewFailureCode(
  message: string | undefined,
): ReviewFailureCode | undefined {
  return message === undefined ? undefined : failureCodes.get(message);
}

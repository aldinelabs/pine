import type { IlinkCredentials } from "./client";
import type { IlinkTransportOptions } from "./http";

export type QrLoginEvent =
  /** A code to show. `content` is the text to draw as a QR code. */
  | { type: "qr"; content: string; expiresAtMs: number; refresh: number }
  | { type: "scanned" }
  /** The phone shows digits the user has to type here. */
  | { type: "need-verify-code"; retry: boolean }
  | { type: "confirmed"; credentials: IlinkCredentials }
  /** The scanned bot is one of `localTokens`; nothing new was issued. */
  | { type: "already-bound" }
  | {
      type: "failed";
      reason: "expired" | "blocked" | "timeout" | "cancelled" | "protocol";
      message: string;
    };

export interface QrLogin {
  /** Settles with the event that ended the login. Never rejects. */
  readonly done: Promise<
    Extract<QrLoginEvent, { type: "confirmed" | "already-bound" | "failed" }>
  >;
  submitVerifyCode(code: string): void;
  cancel(): void;
}

export function startQrLogin(
  options: IlinkTransportOptions & {
    /** Bot tokens this installation already holds, newest first. */
    localTokens?: readonly string[];
    onEvent(event: QrLoginEvent): void;
    deadlineMs?: number;
  },
): QrLogin {
  throw new Error("not implemented");
}

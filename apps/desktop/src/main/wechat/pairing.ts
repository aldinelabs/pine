// The pairing step of binding (plan 5.4, steps 3-5). After the QR code is
// confirmed, the first messages from the scanning account are answered with
// a 6-digit code in WeChat, and the person at the computer types it in. The
// code travels phone → computer, so someone who only sees the screen or a
// log cannot finish the binding.
import { timingSafeEqual } from "node:crypto";
import type { WeChatBinding } from "../../shared/wechatRemote";
import {
  PAIR_ATTEMPTS_MAX,
  PAIR_CODE_TTL_MS,
  PAIR_SENDS_MAX,
} from "./constants";

export type PairingResult = "ok" | "wrong" | "failed";

interface Active {
  code: string;
  expiresAt: number;
  attemptsLeft: number;
  sends: number;
}

function normalise(code: string): string {
  return code.normalize("NFKC").trim();
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A pure state machine: the bridge feeds it the clock and the events. */
export class PairingMachine {
  private active: Active | undefined;

  start(code: string, nowMs: number): void {
    this.active = {
      code: normalise(code),
      expiresAt: nowMs + PAIR_CODE_TTL_MS,
      attemptsLeft: PAIR_ATTEMPTS_MAX,
      sends: 0,
    };
  }

  isActive(): boolean {
    return this.active !== undefined;
  }

  /**
   * A message arrived from the scanning account. `send` says whether to
   * answer it with the code (`code`); at most PAIR_SENDS_MAX times.
   */
  onMessage(nowMs: number): { send: boolean; code?: string } {
    const active = this.active;
    if (!active || this.expired(nowMs) || active.sends >= PAIR_SENDS_MAX) {
      return { send: false };
    }
    active.sends += 1;
    return { send: true, code: active.code };
  }

  /** `failed` ends the pairing: no attempts left, expired, or not pairing. */
  submit(code: string, nowMs: number): PairingResult {
    const active = this.active;
    if (!active) return "failed";
    if (this.expired(nowMs)) {
      this.active = undefined;
      return "failed";
    }
    if (same(normalise(code), active.code)) {
      this.active = undefined;
      return "ok";
    }
    active.attemptsLeft -= 1;
    if (active.attemptsLeft <= 0) {
      this.active = undefined;
      return "failed";
    }
    return "wrong";
  }

  expired(nowMs: number): boolean {
    return this.active !== undefined && nowMs >= this.active.expiresAt;
  }

  expiresAt(): number | undefined {
    return this.active?.expiresAt;
  }

  /** What the binding dialog shows; never the code. */
  view(): WeChatBinding["pairing"] {
    const active = this.active;
    if (!active) return undefined;
    return {
      codeSent: active.sends > 0,
      attemptsLeft: active.attemptsLeft,
      expiresAt: active.expiresAt,
    };
  }

  reset(): void {
    this.active = undefined;
  }
}

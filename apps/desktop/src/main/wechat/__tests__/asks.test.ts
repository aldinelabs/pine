// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskBook, bareAnswerAllowed, bareApproveAllowed } from "../asks";
import type { AskInput } from "../asks";
import {
  ASK_MAX,
  ASK_MIN,
  CONFIRM_TTL_MS,
  HELD_TTL_MS,
  TOMBSTONE_TTL_MS,
} from "../constants";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

let requests = 0;
function approval(overrides: Partial<AskInput> = {}): AskInput {
  requests += 1;
  return {
    kind: "approval",
    requestId: `request-${requests}`,
    sessionId: "session-1",
    projectId: "project-1",
    trigger: "pre-execution",
    toolName: "bash",
    input: { subject: "ls" },
    subjectCut: false,
    external: false,
    ...overrides,
  } as AskInput;
}

function confirm(): AskInput {
  return {
    kind: "confirm",
    command: { kind: "command", name: "delete", args: ["1"] },
    resolved: { sessionId: "session-1" },
  };
}

function held(): AskInput {
  return { kind: "held", reason: "stale", items: [] };
}

describe("AskBook numbers", () => {
  it("starts at 11, counts up and wraps after 99", () => {
    const time = clock();
    const book = new AskBook({ now: time.now, nextAsk: ASK_MAX - 1 });
    expect(book.open(approval())?.number).toBe(98);
    expect(book.open(approval())?.number).toBe(99);
    expect(book.open(approval())?.number).toBe(ASK_MIN);
    expect(book.nextAsk).toBe(12);
  });

  it("ignores a persisted number out of range and reports moves", () => {
    const onNextAsk = vi.fn();
    const book = new AskBook({ now: () => 0, nextAsk: 5, onNextAsk });
    expect(book.open(approval())?.number).toBe(11);
    expect(onNextAsk).toHaveBeenCalledWith(12);
  });

  it("skips open and tombstoned numbers", () => {
    const time = clock();
    const book = new AskBook({ now: time.now });
    for (let n = ASK_MIN; n <= ASK_MAX; n += 1) book.open(approval());
    expect(book.nextAsk).toBe(ASK_MIN);
    book.close(13, "used");
    time.advance(TOMBSTONE_TTL_MS - 1);
    book.close(14, "used");
    time.advance(1);
    // 11 and 12 are open, 13's tombstone is gone, 14's is not.
    expect(book.open(approval())?.number).toBe(13);
    expect(book.status(14)).toBe("tombstone");
    expect(book.open(approval())).toBeUndefined();
  });

  it("returns undefined when all 89 numbers are taken", () => {
    const time = clock();
    const book = new AskBook({ now: time.now });
    for (let n = ASK_MIN; n <= ASK_MAX; n += 1) {
      expect(book.open(approval())?.number).toBe(n);
    }
    expect(book.open(approval())).toBeUndefined();
    book.close(40, "used");
    // A tombstone still blocks the number.
    expect(book.open(approval())).toBeUndefined();
    time.advance(TOMBSTONE_TTL_MS);
    expect(book.open(approval())?.number).toBe(40);
  });

  it("returns the open ask of the same request instead of a second number", () => {
    const book = new AskBook({ now: () => 0 });
    const input = approval();
    const first = book.open(input);
    expect(book.open(input)).toBe(first);
    expect(book.list()).toHaveLength(1);
    expect(book.byRequest((input as { requestId: string }).requestId)).toBe(
      first,
    );
  });
});

describe("AskBook lifecycle", () => {
  it("is single use and leaves a tombstone for E-DONE", () => {
    const time = clock();
    const book = new AskBook({ now: time.now });
    const ask = book.open(approval());
    expect(book.status(11)).toBe("open");
    expect(book.close(11, "used")).toBe(ask);
    expect(book.close(11, "used")).toBeUndefined();
    expect(book.get(11)).toBeUndefined();
    expect(book.status(11)).toBe("tombstone");
    expect(book.tombstoneOf(11)).toEqual({
      number: 11,
      kind: "approval",
      reason: "used",
      closedAtMs: time.now(),
    });
    expect(book.knownNumbers()).toEqual(new Set([11]));
    time.advance(TOMBSTONE_TTL_MS);
    expect(book.status(11)).toBe("unknown");
    expect(book.status(50)).toBe("unknown");
  });

  it("expires confirmations and held batches", () => {
    const time = clock();
    const book = new AskBook({ now: time.now });
    const c = book.open(confirm());
    const h = book.open(held());
    expect(c?.kind === "confirm" && c.expiresAtMs).toBe(
      time.now() + CONFIRM_TTL_MS,
    );
    expect(h?.kind === "held" && h.expiresAtMs).toBe(time.now() + HELD_TTL_MS);
    time.advance(CONFIRM_TTL_MS);
    expect(book.sweep().map((ask) => ask.number)).toEqual([11]);
    expect(book.status(11)).toBe("tombstone");
    expect(book.tombstoneOf(11)?.reason).toBe("expired");
    time.advance(HELD_TTL_MS);
    expect(book.status(12)).toBe("tombstone");
    expect(book.list()).toEqual([]);
  });

  it("keeps an explicit expiry", () => {
    const time = clock();
    const book = new AskBook({ now: time.now });
    book.open({ ...confirm(), expiresAtMs: time.now() + 10 } as AskInput);
    time.advance(10);
    expect(book.get(11)).toBeUndefined();
  });

  it("closes by predicate and lists the open ones oldest first", () => {
    const time = clock();
    const book = new AskBook({ now: time.now });
    book.open(approval({ sessionId: "a" }));
    time.advance(1);
    book.open(approval({ sessionId: "b" }));
    time.advance(1);
    book.open(approval({ sessionId: "a" }));
    const closed = book.closeWhere(
      (ask) => ask.kind === "approval" && ask.sessionId === "a",
      "invalidated",
    );
    expect(closed.map((ask) => ask.number)).toEqual([11, 13]);
    expect(book.list().map((ask) => ask.number)).toEqual([12]);
  });

  it("records the first delivery and the full view", () => {
    const book = new AskBook({ now: () => 0 });
    book.open(approval({ subjectCut: true }));
    book.markDelivered(11, 100);
    book.markDelivered(11, 200);
    book.markShown(11, 300);
    const ask = book.get(11);
    expect(ask?.deliveredAtMs).toBe(100);
    expect(ask?.kind === "approval" && ask.shownAtMs).toBe(300);
    book.open(confirm());
    book.markShown(12, 400);
    expect(book.get(12)?.deliveredAtMs).toBeUndefined();
  });
});

describe("bare approve", () => {
  const message = { createdAtMs: 100_000, pollStartedAtMs: 100_500 };

  it("is allowed only for a single held batch by default", () => {
    const book = new AskBook({ now: () => 0 });
    book.open(held());
    expect(bareApproveAllowed(book, message)).toBe(true);
    book.open(approval());
    expect(bareApproveAllowed(book, message)).toBe(false);

    const single = new AskBook({ now: () => 0 });
    single.open(approval());
    single.markDelivered(11, 1_000);
    expect(bareApproveAllowed(single, message)).toBe(false);

    const confirmation = new AskBook({ now: () => 0 });
    confirmation.open(confirm());
    expect(bareApproveAllowed(confirmation, message)).toBe(false);
  });

  describe("with ALLOW_BARE_APPROVE on", () => {
    afterEach(() => {
      vi.doUnmock("../constants");
      vi.resetModules();
    });

    async function load() {
      vi.resetModules();
      vi.doMock("../constants", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../constants")>()),
        ALLOW_BARE_APPROVE: true,
      }));
      return import("../asks");
    }

    it("approves one delivered card written after the skew", async () => {
      const asks = await load();
      const book = new asks.AskBook({ now: () => 0 });
      book.open(approval());
      expect(asks.bareApproveAllowed(book, message)).toBe(false);
      book.markDelivered(11, 90_000);
      expect(asks.bareApproveAllowed(book, message)).toBe(true);
    });

    it("refuses with two asks or with a confirmation", async () => {
      const asks = await load();
      const two = new asks.AskBook({ now: () => 0 });
      two.open(approval());
      two.open(approval());
      two.markDelivered(11, 90_000);
      two.markDelivered(12, 90_000);
      expect(asks.bareApproveAllowed(two, message)).toBe(false);

      const confirmation = new asks.AskBook({ now: () => 0 });
      confirmation.open(confirm());
      confirmation.markDelivered(11, 90_000);
      expect(asks.bareApproveAllowed(confirmation, message)).toBe(false);
    });

    it("refuses a card delivered after the message was written", async () => {
      const asks = await load();
      const book = new asks.AskBook({ now: () => 0 });
      book.open(approval());
      // Inside the skew window.
      book.markDelivered(11, message.createdAtMs - 5_000);
      expect(asks.bareApproveAllowed(book, message)).toBe(false);
    });

    it("refuses a card delivered after the poll started", async () => {
      const asks = await load();
      const book = new asks.AskBook({ now: () => 0 });
      book.open(approval());
      book.markDelivered(11, 90_000);
      expect(
        asks.bareApproveAllowed(book, {
          createdAtMs: 200_000,
          pollStartedAtMs: 90_000,
        }),
      ).toBe(false);
    });
  });
});

describe("bareAnswerAllowed", () => {
  const message = { createdAtMs: 100_000, pollStartedAtMs: 100_500 };

  it("answers when the card was delivered well before and no list came after", () => {
    expect(
      bareAnswerAllowed({ deliveredAtMs: 95_000 }, undefined, message),
    ).toBe("answer");
    expect(bareAnswerAllowed({ deliveredAtMs: 95_000 }, 90_000, message)).toBe(
      "answer",
    );
  });

  it("is ambiguous when the card fails a guard and a list is valid", () => {
    // Inside the gap.
    expect(bareAnswerAllowed({ deliveredAtMs: 96_000 }, 90_000, message)).toBe(
      "ambiguous",
    );
    // A list delivered after the card.
    expect(bareAnswerAllowed({ deliveredAtMs: 90_000 }, 91_000, message)).toBe(
      "ambiguous",
    );
    // Delivered after the poll started.
    expect(
      bareAnswerAllowed({ deliveredAtMs: 90_000 }, 80_000, {
        createdAtMs: 200_000,
        pollStartedAtMs: 90_000,
      }),
    ).toBe("ambiguous");
  });

  it("is no when the card fails a guard and no list is valid", () => {
    expect(bareAnswerAllowed({}, undefined, message)).toBe("no");
    expect(
      bareAnswerAllowed({ deliveredAtMs: 99_000 }, undefined, message),
    ).toBe("no");
  });
});

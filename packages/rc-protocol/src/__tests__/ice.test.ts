import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATHER_GRACE_MS,
  GatherWatch,
  candidateType,
  wantedCandidate,
} from "../ice";

const relay =
  "candidate:1 1 udp 41885439 104.30.1.1 61000 typ relay raddr 0.0.0.0 rport 0";
const srflx =
  "candidate:2 1 udp 1677729535 203.0.113.9 52000 typ srflx raddr 0.0.0.0 rport 0";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function settled(watch: GatherWatch) {
  let done = false;
  void watch.ready.then(() => {
    done = true;
  });
  await Promise.resolve();
  return () => done;
}

describe("gathering", () => {
  it("waits for a relay when there is TURN, and for STUN's address otherwise", () => {
    expect(
      wantedCandidate([
        {
          urls: [
            "stun:stun.cloudflare.com:3478",
            "turn:turn.cloudflare.com:3478",
          ],
        },
      ]),
    ).toBe("relay");
    expect(wantedCandidate([{ urls: ["stun:stun.cloudflare.com:3478"] }])).toBe(
      "srflx",
    );
    expect(wantedCandidate([])).toBeUndefined();
    expect(candidateType(relay)).toBe("relay");
    expect(candidateType("a=end-of-candidates")).toBeUndefined();
  });

  it("stops shortly after the wanted candidate instead of the slow completion", async () => {
    const watch = new GatherWatch("relay");
    const done = await settled(watch);
    watch.candidate(srflx);
    await vi.advanceTimersByTimeAsync(GATHER_GRACE_MS * 4);
    expect(done()).toBe(false);
    watch.candidate(relay);
    await vi.advanceTimersByTimeAsync(GATHER_GRACE_MS);
    expect(done()).toBe(true);
  });

  it("stops at completion or the deadline, whichever comes first", async () => {
    const complete = new GatherWatch("relay");
    const completed = await settled(complete);
    complete.complete();
    await Promise.resolve();
    expect(completed()).toBe(true);

    const late = new GatherWatch("relay", 1000);
    const timedOut = await settled(late);
    await vi.advanceTimersByTimeAsync(999);
    expect(timedOut()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(timedOut()).toBe(true);
  });
});

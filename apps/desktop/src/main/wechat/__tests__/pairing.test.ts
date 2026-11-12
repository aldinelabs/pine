// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PAIR_ATTEMPTS_MAX,
  PAIR_CODE_TTL_MS,
  PAIR_SENDS_MAX,
} from "../constants";
import { PairingMachine } from "../pairing";

describe("PairingMachine", () => {
  it("sends the code at most PAIR_SENDS_MAX times", () => {
    const machine = new PairingMachine();
    machine.start("123456", 1000);
    const sends = Array.from(
      { length: PAIR_SENDS_MAX + 2 },
      () => machine.onMessage(1000).send,
    );
    expect(sends.filter(Boolean)).toHaveLength(PAIR_SENDS_MAX);
    expect(machine.onMessage(1000)).toEqual({ send: false });
    expect(machine.view()?.codeSent).toBe(true);
  });

  it("returns the code only with a send decision and never in its view", () => {
    const machine = new PairingMachine();
    machine.start("654321", 0);
    expect(machine.view()).toEqual({
      codeSent: false,
      attemptsLeft: PAIR_ATTEMPTS_MAX,
      expiresAt: PAIR_CODE_TTL_MS,
    });
    expect(JSON.stringify(machine.view())).not.toContain("654321");
    expect(machine.onMessage(0)).toEqual({ send: true, code: "654321" });
  });

  it("fails after three wrong codes", () => {
    const machine = new PairingMachine();
    machine.start("123456", 0);
    expect(machine.submit("000000", 1)).toBe("wrong");
    expect(machine.view()?.attemptsLeft).toBe(PAIR_ATTEMPTS_MAX - 1);
    expect(machine.submit("111111", 2)).toBe("wrong");
    expect(machine.submit("222222", 3)).toBe("failed");
    expect(machine.isActive()).toBe(false);
    expect(machine.submit("123456", 4)).toBe("failed");
  });

  it("fails once the code expired, and sends nothing then", () => {
    const machine = new PairingMachine();
    machine.start("123456", 0);
    expect(machine.expired(PAIR_CODE_TTL_MS - 1)).toBe(false);
    expect(machine.expired(PAIR_CODE_TTL_MS)).toBe(true);
    expect(machine.onMessage(PAIR_CODE_TTL_MS).send).toBe(false);
    expect(machine.submit("123456", PAIR_CODE_TTL_MS)).toBe("failed");
    expect(machine.isActive()).toBe(false);
  });

  it("accepts the right code after trimming and NFKC", () => {
    const machine = new PairingMachine();
    machine.start("123456", 0);
    expect(machine.submit(" １２３４５６ \n", 10)).toBe("ok");
    expect(machine.isActive()).toBe(false);
    expect(machine.view()).toBeUndefined();
  });

  it("fails when no pairing is active", () => {
    expect(new PairingMachine().submit("123456", 0)).toBe("failed");
    expect(new PairingMachine().onMessage(0)).toEqual({ send: false });
  });
});

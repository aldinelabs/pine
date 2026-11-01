import { describe, expect, it } from "vitest";
import { deriveRoomId } from "../room";

describe("room", () => {
  it("is stable for a secret and differs by secret and purpose", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const other = crypto.getRandomValues(new Uint8Array(32));
    const room = await deriveRoomId(secret, "device");
    expect(room).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deriveRoomId(secret, "device")).toBe(room);
    expect(await deriveRoomId(secret, "pairing")).not.toBe(room);
    expect(await deriveRoomId(other, "device")).not.toBe(room);
  });
});

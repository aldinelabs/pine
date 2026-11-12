import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockIlink, startMockIlink } from "../testing";

let mock: MockIlink;

beforeEach(async () => {
  mock = await startMockIlink();
});

afterEach(async () => {
  await mock.close();
});

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${mock.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("startMockIlink", () => {
  it("listens on 127.0.0.1 with the CDN below /c2c", () => {
    expect(mock.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(mock.cdnBaseUrl).toBe(`${mock.baseUrl}/c2c`);
  });

  it("sends message ids as raw integers above 2^53", async () => {
    const pushed = mock.pushUserText("hi");
    const text = await (await post("/ilink/bot/getupdates", {})).text();
    expect(text).toContain(`"message_id":${pushed.message_id}`);
    expect(text).not.toContain(`"message_id":"`);
    expect(BigInt(pushed.message_id ?? "0") > 2n ** 53n).toBe(true);
  });

  it("leaves fields set to null out of the wire message", async () => {
    const stored = mock.pushUserMessage({
      message_id: null,
      create_time_ms: null,
      group_id: "g",
    });
    expect(stored).not.toHaveProperty("message_id");
    expect(stored).not.toHaveProperty("create_time_ms");
    const answer = (await (await post("/ilink/bot/getupdates", {})).json()) as {
      msgs: Record<string, unknown>[];
    };
    expect(answer.msgs[0]).not.toHaveProperty("message_id");
    expect(answer.msgs[0]).not.toHaveProperty("create_time_ms");
    expect(answer.msgs[0]?.group_id).toBe("g");
    expect(answer.msgs[0]?.context_token).toBe(stored.context_token);
  });

  it("holds an empty long poll briefly and answers at once when a message arrives", async () => {
    let started = Date.now();
    await post("/ilink/bot/getupdates", { get_updates_buf: "c" });
    expect(Date.now() - started).toBeLessThan(1_000);

    started = Date.now();
    const pending = post("/ilink/bot/getupdates", {});
    setTimeout(() => mock.pushUserText("now"), 10);
    const answer = (await (await pending).json()) as { msgs: unknown[] };
    expect(answer.msgs).toHaveLength(1);
  });

  it("records requests and applies failNext, redirectNext and delayNext once", async () => {
    mock.failNext("/sendmessage", { status: 503, body: { ret: 1 } });
    expect((await post("/ilink/bot/sendmessage", { msg: {} })).status).toBe(
      503,
    );
    expect((await post("/ilink/bot/sendmessage", { msg: {} })).status).toBe(
      200,
    );

    mock.redirectNext("/getconfig", "http://127.0.0.1:1/elsewhere");
    const redirected = await fetch(`${mock.baseUrl}/ilink/bot/getconfig`, {
      method: "POST",
      redirect: "manual",
    });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe(
      "http://127.0.0.1:1/elsewhere",
    );

    mock.delayNext("/notifystart", 120);
    const started = Date.now();
    await post("/ilink/bot/msg/notifystart", {});
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);

    expect(mock.requests.map((request) => request.path)).toEqual([
      "/ilink/bot/sendmessage",
      "/ilink/bot/sendmessage",
      "/ilink/bot/getconfig",
      "/ilink/bot/msg/notifystart",
    ]);
    expect(mock.requests[0]?.body).toEqual({ msg: {} });
  });

  it("limits replies per context token and answers -14 while stale", async () => {
    mock.setReplyBudget(1);
    const send = () =>
      post("/ilink/bot/sendmessage", {
        msg: {
          context_token: "t",
          item_list: [{ type: 1, text_item: { text: "x" } }],
        },
      }).then((response) => response.json() as Promise<{ ret: number }>);
    expect((await send()).ret).toBe(0);
    expect((await send()).ret).toBe(-2);
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]?.text).toBe("x");
    mock.setReplyBudget(undefined);
    expect((await send()).ret).toBe(0);

    mock.setStaleToken(true);
    const stale = (await (await post("/ilink/bot/getconfig", {})).json()) as {
      errcode: number;
    };
    expect(stale.errcode).toBe(-14);
  });
});

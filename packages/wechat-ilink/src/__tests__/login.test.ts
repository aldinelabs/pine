import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IlinkTransportOptions } from "../http";
import { type QrLoginEvent, startQrLogin } from "../login";
import { type MockIlink, startMockIlink } from "../testing";

const IDENTITY = { hostName: "pine", hostVersion: "1.4.2" };

let mock: MockIlink;

beforeEach(async () => {
  mock = await startMockIlink();
});

afterEach(async () => {
  await mock.close();
});

function transport(
  overrides: Partial<IlinkTransportOptions> = {},
): IlinkTransportOptions {
  return {
    fetch: (url, init) => fetch(url, init),
    identity: IDENTITY,
    allowUrl: () => true,
    apiBaseUrl: mock.baseUrl,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

/** Starts a login whose events go to `react` and are recorded. */
function login(
  react: (event: QrLoginEvent, events: QrLoginEvent[]) => void,
  options: Partial<IlinkTransportOptions> & {
    localTokens?: string[];
    deadlineMs?: number;
  } = {},
) {
  const events: QrLoginEvent[] = [];
  const handle = startQrLogin({
    ...transport(options),
    localTokens: options.localTokens,
    deadlineMs: options.deadlineMs,
    onEvent(event) {
      events.push(event);
      react(event, events);
    },
  });
  return { handle, events };
}

const types = (events: QrLoginEvent[]) => events.map((event) => event.type);

describe("startQrLogin", () => {
  it("shows a code, waits, sees the scan and hands out the account", async () => {
    const { handle, events } = login(
      (event) => {
        if (event.type === "qr") setTimeout(() => mock.qr.scan(), 20);
        if (event.type === "scanned") mock.qr.confirm();
      },
      { localTokens: ["old-token", " ", "older"] },
    );
    const end = await handle.done;
    expect(end).toEqual({
      type: "confirmed",
      credentials: {
        botToken: "mock-bot-token",
        botId: "0123456789abcdef@im.bot",
        userId: "mock-user@im.wechat",
        baseUrl: mock.baseUrl,
      },
    });
    expect(types(events)).toEqual(["qr", "scanned", "confirmed"]);
    const qr = events[0] as Extract<QrLoginEvent, { type: "qr" }>;
    expect(qr.content).toBe("https://liteapp.weixin.qq.com/q/mock-1");
    expect(qr.refresh).toBe(0);

    const fetchQr = mock.requests.find((r) =>
      r.path.endsWith("get_bot_qrcode"),
    );
    expect(fetchQr?.query).toEqual({ bot_type: "3" });
    expect(fetchQr?.headers.authorization).toBeUndefined();
    expect(fetchQr?.body).toEqual({ local_token_list: ["old-token", "older"] });

    const polls = mock.requests.filter((r) =>
      r.path.endsWith("get_qrcode_status"),
    );
    expect(polls.length).toBeGreaterThan(0);
    for (const poll of polls) {
      expect(poll.method).toBe("GET");
      expect(poll.query.qrcode).toBe("mock-qr-1");
      expect(poll.headers.authorization).toBeUndefined();
      expect(poll.headers["x-wechat-uin"]).toBeUndefined();
      expect(poll.headers["ilink-app-id"]).toBe("bot");
    }
  });

  it("refreshes an expired code twice, then gives up", async () => {
    const { handle, events } = login((event) => {
      if (event.type === "qr") mock.qr.expire();
    });
    const end = await handle.done;
    expect(end).toMatchObject({ type: "failed", reason: "expired" });
    const shown = events.filter((event) => event.type === "qr");
    expect(shown.map((event) => event.refresh)).toEqual([0, 1, 2]);
  });

  it("asks again after a wrong verification code and goes on after the right one", async () => {
    mock.qr.requireVerifyCode("246810");
    const { handle, events } = login((event) => {
      if (event.type === "qr") mock.qr.scan();
      if (event.type === "need-verify-code") {
        setTimeout(
          () => handle.submitVerifyCode(event.retry ? " 246810 " : "000000"),
          5,
        );
      }
      if (event.type === "scanned") mock.qr.confirm();
    });
    const end = await handle.done;
    expect(end.type).toBe("confirmed");
    expect(events.filter((event) => event.type === "need-verify-code")).toEqual(
      [
        { type: "need-verify-code", retry: false },
        { type: "need-verify-code", retry: true },
      ],
    );
    const codes = mock.requests
      .map((request) => request.query.verify_code)
      .filter((code) => code !== undefined);
    expect(codes).toEqual(["000000", "246810"]);
  });

  it("fails as blocked when the code is blocked on the last QR code", async () => {
    const { handle, events } = login((event) => {
      if (event.type === "qr") {
        mock.qr.requireVerifyCode("1");
        mock.qr.scan();
      }
      if (event.type === "need-verify-code") {
        mock.qr.blockVerifyCode();
        handle.submitVerifyCode("9");
      }
    });
    const end = await handle.done;
    expect(end).toMatchObject({ type: "failed", reason: "blocked" });
    expect(events.filter((event) => event.type === "qr")).toHaveLength(3);
  });

  it("follows an IDC redirect for the status polls", async () => {
    const port = new URL(mock.baseUrl).port;
    const { handle } = login((event) => {
      if (event.type === "qr") mock.qr.redirect(`http://localhost:${port}`);
      if (event.type === "scanned") mock.qr.confirm();
    });
    expect((await handle.done).type).toBe("confirmed");
    const hosts = mock.requests
      .filter((request) => request.path.endsWith("get_qrcode_status"))
      .map((request) => request.headers.host);
    expect(hosts[0]).toBe(`127.0.0.1:${port}`);
    expect(hosts[hosts.length - 1]).toBe(`localhost:${port}`);
  });

  it("refuses a redirect host the gate does not allow", async () => {
    const { handle } = login(
      (event) => {
        if (event.type === "qr") mock.qr.redirect("evil.example.com");
      },
      { allowUrl: (url) => url.hostname === "127.0.0.1" },
    );
    expect(await handle.done).toMatchObject({
      type: "failed",
      reason: "protocol",
    });
  });

  it("reports an already bound bot", async () => {
    const { handle } = login((event) => {
      if (event.type === "qr") mock.qr.alreadyBound();
    });
    expect(await handle.done).toEqual({ type: "already-bound" });
  });

  it("fails when the confirmation has no ilink_bot_id", async () => {
    const { handle } = login((event) => {
      if (event.type === "qr") mock.qr.confirm({ botId: "" });
    });
    expect(await handle.done).toMatchObject({
      type: "failed",
      reason: "protocol",
      message: expect.stringContaining("ilink_bot_id") as unknown,
    });
  });

  it("fails when the account's host is not allowed", async () => {
    const { handle } = login(
      (event) => {
        if (event.type === "qr") {
          mock.qr.confirm({ baseUrl: "https://elsewhere.example.com" });
        }
      },
      { allowUrl: (url) => url.hostname === "127.0.0.1" },
    );
    expect(await handle.done).toMatchObject({
      type: "failed",
      reason: "protocol",
    });
  });

  it("treats a failing status poll as wait", async () => {
    const { handle } = login((event) => {
      if (event.type === "qr") {
        mock.failNext("get_qrcode_status", { status: 524 });
        setTimeout(() => mock.qr.confirm(), 20);
      }
    });
    expect((await handle.done).type).toBe("confirmed");
    expect(
      mock.requests.filter((r) => r.path.endsWith("get_qrcode_status")).length,
    ).toBeGreaterThan(1);
  });

  it("times out at the deadline", async () => {
    let clock = 0;
    const slept: number[] = [];
    const { handle } = login(() => undefined, {
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      deadlineMs: 3_000,
    });
    expect(await handle.done).toMatchObject({
      type: "failed",
      reason: "timeout",
    });
    expect(slept).toEqual([1_000, 1_000, 1_000]);
  });

  it("can be cancelled", async () => {
    const { handle, events } = login((event) => {
      if (event.type === "qr") setTimeout(() => handle.cancel(), 10);
    });
    expect(await handle.done).toMatchObject({
      type: "failed",
      reason: "cancelled",
    });
    expect(events[events.length - 1]).toMatchObject({ reason: "cancelled" });
  });

  it("fails when no QR code can be fetched", async () => {
    mock.failNext("get_bot_qrcode", { status: 500 });
    const { handle } = login(() => undefined);
    expect(await handle.done).toMatchObject({
      type: "failed",
      reason: "protocol",
    });
  });
});

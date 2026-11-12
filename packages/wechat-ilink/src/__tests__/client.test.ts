import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IlinkClient } from "../client";
import { IlinkApiError, IlinkHttpError, IlinkUrlError } from "../errors";
import type { IlinkTransportOptions } from "../http";
import { type MockIlink, startMockIlink } from "../testing";

const IDENTITY = { hostName: "pine", hostVersion: "1.4.2" };

function transportFor(
  mock: MockIlink,
  overrides: Partial<IlinkTransportOptions> = {},
): IlinkTransportOptions {
  return {
    fetch: (url, init) => fetch(url, init),
    identity: IDENTITY,
    allowUrl: () => true,
    apiBaseUrl: mock.baseUrl,
    cdnBaseUrl: mock.cdnBaseUrl,
    now: () => 1_700_000_000_000,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

function clientFor(
  mock: MockIlink,
  overrides: Partial<IlinkTransportOptions> = {},
): IlinkClient {
  return new IlinkClient({
    ...transportFor(mock, overrides),
    botToken: "token-1",
    baseUrl: mock.baseUrl,
  });
}

function lastRequest(mock: MockIlink, suffix: string) {
  const found = mock.requests.filter((request) =>
    request.path.endsWith(suffix),
  );
  const request = found[found.length - 1];
  if (!request) throw new Error(`no request to ${suffix}`);
  return request;
}

function bodyOf(mock: MockIlink, suffix: string): Record<string, unknown> {
  return lastRequest(mock, suffix).body as Record<string, unknown>;
}

let mock: MockIlink;
let other: MockIlink | undefined;

beforeEach(async () => {
  mock = await startMockIlink();
});

afterEach(async () => {
  await mock.close();
  await other?.close();
  other = undefined;
});

describe("IlinkClient", () => {
  it("sends the headers and base_info of an authenticated call", async () => {
    await clientFor(mock).getUpdates("");
    const request = lastRequest(mock, "/ilink/bot/getupdates");
    expect(request.method).toBe("POST");
    expect(request.headers.authorization).toBe("Bearer token-1");
    expect(request.headers.authorizationtype).toBe("ilink_bot_token");
    expect(request.headers["ilink-app-id"]).toBe("bot");
    expect(request.headers["ilink-app-clientversion"]).toBe("132106");
    expect(request.headers["x-wechat-uin"]).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(request.body).toEqual({
      get_updates_buf: "",
      base_info: {
        channel_version: "2.4.10/pine-1.4.2",
        bot_agent: "Pine/1.4.2",
      },
    });
  });

  it("keeps message ids above 2^53 exact, in and out", async () => {
    const pushed = mock.pushUserText("hello");
    expect(BigInt(pushed.message_id ?? "0")).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    const client = clientFor(mock);
    const result = await client.getUpdates("");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message_id).toBe(pushed.message_id);
    expect(result.cursor).toBe("cursor-1");
    expect(result.nextTimeoutMs).toBe(35_000);

    const sent = await client.sendText({ toUserId: "u", text: "hi" });
    expect(sent.messageId).toMatch(/^\d{16,}$/);
    expect(BigInt(sent.messageId ?? "0")).toBe(
      BigInt(pushed.message_id ?? "0") + 1n,
    );
  });

  it("reports a cursor only when the server sent a non-empty one", async () => {
    mock.failNext("/getupdates", {
      body: { ret: 0, msgs: [], get_updates_buf: "" },
    });
    expect((await clientFor(mock).getUpdates("old")).cursor).toBeUndefined();
  });

  it("turns its own timeout and an abort into an empty answer", async () => {
    mock.delayNext("/getupdates", 300);
    await expect(
      clientFor(mock).getUpdates("c", { timeoutMs: 30 }),
    ).resolves.toEqual({ messages: [] });

    const controller = new AbortController();
    const pending = clientFor(mock).getUpdates("c", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).resolves.toEqual({ messages: [] });
  });

  it("throws IlinkApiError for ret or errcode, with staleToken for -14", async () => {
    mock.failNext("/getupdates", { body: { ret: 3, errmsg: "x" } });
    const error = await clientFor(mock)
      .getUpdates("")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IlinkApiError);
    expect((error as IlinkApiError).ret).toBe(3);
    expect((error as IlinkApiError).staleToken).toBe(false);

    mock.setStaleToken(true);
    const stale = await clientFor(mock)
      .getUpdates("")
      .catch((caught: unknown) => caught);
    expect((stale as IlinkApiError).staleToken).toBe(true);
    const staleSend = await clientFor(mock)
      .sendText({ toUserId: "u", text: "x" })
      .catch((caught: unknown) => caught);
    expect((staleSend as IlinkApiError).staleToken).toBe(true);
  });

  it("throws IlinkHttpError for a non-2xx answer", async () => {
    mock.failNext("/getupdates", { status: 502 });
    await expect(clientFor(mock).getUpdates("")).rejects.toBeInstanceOf(
      IlinkHttpError,
    );
  });

  it("sends one bot message per request", async () => {
    await clientFor(mock).sendText({
      toUserId: "user@im.wechat",
      contextToken: "ctx",
      text: "hello",
      runId: "run-1",
    });
    const body = bodyOf(mock, "/sendmessage");
    const msg = body.msg as Record<string, unknown>;
    expect(msg).toEqual({
      from_user_id: "",
      to_user_id: "user@im.wechat",
      client_id: expect.stringMatching(
        /^pine:1700000000000-[0-9a-f]{8}$/,
      ) as unknown,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: "hello" } }],
      context_token: "ctx",
      run_id: "run-1",
    });
    expect(body.base_info).toBeDefined();
    expect(mock.sent[0]?.text).toBe("hello");
    expect(mock.sent[0]?.contextToken).toBe("ctx");
  });

  it("leaves out context_token and run_id when not given, and refuses empty text", async () => {
    const client = clientFor(mock);
    await client.sendItem({
      toUserId: "u",
      item: { type: 4, file_item: { file_name: "a.txt" } },
    });
    const msg = bodyOf(mock, "/sendmessage").msg as Record<string, unknown>;
    expect(msg).not.toHaveProperty("context_token");
    expect(msg).not.toHaveProperty("run_id");
    expect(msg.item_list).toEqual([
      { type: 4, file_item: { file_name: "a.txt" } },
    ]);
    await expect(
      client.sendText({ toUserId: "u", text: "" }),
    ).rejects.toThrow();
  });

  it("surfaces ret -2 of an exhausted reply budget", async () => {
    mock.setReplyBudget(1);
    const client = clientFor(mock);
    await client.sendText({ toUserId: "u", contextToken: "c", text: "1" });
    const error = await client
      .sendText({ toUserId: "u", contextToken: "c", text: "2" })
      .catch((caught: unknown) => caught);
    expect((error as IlinkApiError).ret).toBe(-2);
  });

  it("speaks getconfig, sendtyping, notifystart, notifystop and getuploadurl", async () => {
    const client = clientFor(mock);
    await expect(
      client.getConfig({ userId: "u", contextToken: "c" }),
    ).resolves.toEqual({ typingTicket: "bW9jay10eXBpbmc=" });
    expect(bodyOf(mock, "/getconfig")).toMatchObject({
      ilink_user_id: "u",
      context_token: "c",
    });

    await client.sendTyping({
      userId: "u",
      typingTicket: "t",
      status: "typing",
    });
    await client.sendTyping({
      userId: "u",
      typingTicket: "t",
      status: "cancel",
    });
    expect(mock.typing).toEqual([{ status: 1 }, { status: 2 }]);
    expect(bodyOf(mock, "/sendtyping")).toMatchObject({
      ilink_user_id: "u",
      typing_ticket: "t",
      status: 2,
    });

    await client.notifyStart();
    await client.notifyStop();
    expect(lastRequest(mock, "/ilink/bot/msg/notifystart").body).toHaveProperty(
      "base_info",
    );
    expect(lastRequest(mock, "/ilink/bot/msg/notifystop").method).toBe("POST");

    const upload = await client.getUploadUrl({
      fileKey: "f".repeat(32),
      mediaType: 3,
      toUserId: "u",
      rawSize: 10,
      rawMd5: "m",
      fileSize: 16,
      aesKeyHex: "a".repeat(32),
    });
    expect(upload.uploadParam).toBe("upload-1");
    expect(upload.uploadFullUrl).toContain("/c2c/upload?");
    expect(bodyOf(mock, "/getuploadurl")).toMatchObject({
      filekey: "f".repeat(32),
      media_type: 3,
      to_user_id: "u",
      rawsize: 10,
      rawfilemd5: "m",
      filesize: 16,
      no_need_thumb: true,
      aeskey: "a".repeat(32),
    });
  });

  it("refuses an account host the gate does not allow", () => {
    expect(
      () =>
        new IlinkClient({
          ...transportFor(mock, { allowUrl: undefined }),
          botToken: "t",
          baseUrl: mock.baseUrl,
        }),
    ).toThrow(IlinkUrlError);
    expect(
      () =>
        new IlinkClient({
          ...transportFor(mock, {
            allowUrl: (_url, purpose) => purpose === "cdn",
          }),
          botToken: "t",
        }),
    ).toThrow(IlinkUrlError);
  });

  it("never follows a redirect of getupdates", async () => {
    other = await startMockIlink();
    mock.redirectNext("/getupdates", `${other.baseUrl}/ilink/bot/getupdates`);
    await expect(clientFor(mock).getUpdates("")).rejects.toBeInstanceOf(
      IlinkUrlError,
    );
    expect(other.requests).toHaveLength(0);
  });
});

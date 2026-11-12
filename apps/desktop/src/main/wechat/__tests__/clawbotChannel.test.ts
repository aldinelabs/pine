// @vitest-environment node
import {
  IlinkApiError,
  IlinkMediaTooLargeError,
  IlinkUrlError,
  MessageItemType,
} from "@pine/wechat-ilink";
import { type MockIlink, startMockIlink } from "@pine/wechat-ilink/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ChannelBindingEvent,
  ChannelInboundMessage,
  ChannelState,
  MessageChannel,
} from "../channel";
import { createClawBotChannels, sendFailure } from "../clawbotChannel";

const BOT_ID = "0123456789abcdef@im.bot";
const USER_ID = "mock-user@im.wechat";

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let mock: MockIlink;
let channel: MessageChannel | undefined;
let received: ChannelInboundMessage[];
let cursors: (string | undefined)[];
let states: ChannelState[];

function factory(options: { typingKeepaliveMs?: number } = {}) {
  return createClawBotChannels({
    fetch: globalThis.fetch,
    version: "1.4.2",
    apiBaseUrl: mock.baseUrl,
    cdnBaseUrl: mock.cdnBaseUrl,
    allowUrl: () => true,
    ...options,
  });
}

function openChannel(options: { typingKeepaliveMs?: number } = {}) {
  const opened = factory(options).open({
    token: "mock-bot-token",
    botId: BOT_ID,
    userId: USER_ID,
    baseUrl: mock.baseUrl,
  });
  channel = opened;
  opened.start(
    {
      onMessages(batch, cursor) {
        received.push(...batch);
        cursors.push(cursor);
        return Promise.resolve();
      },
      onState(state) {
        states.push(state);
      },
    },
    "",
  );
  return opened;
}

beforeEach(async () => {
  mock = await startMockIlink();
  received = [];
  cursors = [];
  states = [];
  channel = undefined;
});

afterEach(async () => {
  await channel?.stop();
  await mock.close();
});

describe("inbound messages", () => {
  it("delivers text, transcripts and quotes as separate fields", async () => {
    openChannel();
    const text = mock.pushUserText(".status");
    mock.pushUserMessage({
      item_list: [
        {
          type: MessageItemType.VOICE,
          voice_item: { text: "run the tests" },
        },
      ],
    });
    mock.pushUserMessage({
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: "look at this" },
          ref_msg: {
            title: "Summary",
            message_item: {
              type: MessageItemType.TEXT,
              text_item: { text: ".delete 3" },
            },
          },
        },
      ],
    });
    await until(() => received.length === 3);

    expect(received[0]).toMatchObject({
      id: text.message_id,
      fromUserId: USER_ID,
      toUserId: BOT_ID,
      isUserMessage: true,
      contextToken: text.context_token,
      text: ".status",
      media: [],
    });
    expect(received[0]?.createdAtMs).toBe(text.create_time_ms);
    expect(received[0]?.pollStartedAtMs).toBeGreaterThan(0);
    expect(received[1]?.text).toBeUndefined();
    expect(received[1]?.voiceTranscript).toBe("run the tests");
    expect(received[1]?.media).toEqual([]);
    expect(received[2]?.text).toBe("look at this");
    expect(received[2]?.quotedText).toBe("Summary | .delete 3");
    expect(cursors.at(-1)).toMatch(/^cursor-/);
    expect(states).toContain("online");
  });

  it("keeps ids lossless", async () => {
    openChannel();
    const message = mock.pushUserText("hi");
    await until(() => received.length === 1);
    expect(BigInt(received[0]?.id ?? "0")).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect(received[0]?.id).toBe(message.message_id);
  });

  it("drops a message without an id and passes the routing fields through", async () => {
    openChannel();
    mock.pushUserText("no id", { message_id: null });
    mock.pushUserMessage({
      message_id: null,
      item_list: [
        {
          type: MessageItemType.TEXT,
          msg_id: "9007199254740999",
          text_item: { text: "item id" },
        },
      ],
    });
    mock.pushUserText("no time", {
      create_time_ms: null,
      to_user_id: "someone-else@im.bot",
      group_id: "group-1",
    });
    mock.pushUserText("zero time", { create_time_ms: 0, message_type: 2 });
    await until(() => received.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received.map((message) => message.text)).toEqual([
      "item id",
      "no time",
      "zero time",
    ]);
    expect(received[0]?.id).toBe("9007199254740999");
    expect(received[1]).toMatchObject({
      createdAtMs: 0,
      toUserId: "someone-else@im.bot",
      groupId: "group-1",
    });
    expect(received[2]).toMatchObject({ createdAtMs: 0, isUserMessage: false });
  });

  it("reports a voice message without a transcript", async () => {
    openChannel();
    mock.pushUserMessage({
      item_list: [
        {
          type: MessageItemType.VOICE,
          voice_item: {
            media: { encrypt_query_param: "voice-1", aes_key: "AAAA" },
          },
        },
      ],
    });
    await until(() => received.length === 1);
    expect(received[0]?.voiceTranscript).toBeUndefined();
    expect(received[0]?.media.map((media) => media.kind)).toEqual(["voice"]);
  });
});

describe("media", () => {
  it("hands over media references without fetching them", async () => {
    const opened = openChannel();
    const plain = Buffer.from("report contents");
    const file = mock.hostMedia("file", plain, "report.pdf");
    const image = mock.hostMedia("image", Buffer.from("png bytes"));
    mock.pushUserMessage({ item_list: [file, image] });
    await until(() => received.length === 1);

    expect(
      mock.requests.some((request) => request.path.startsWith("/c2c")),
    ).toBe(false);
    const [fileMedia, imageMedia] = received[0]?.media ?? [];
    expect(fileMedia).toMatchObject({
      kind: "file",
      fileName: "report.pdf",
      sizeBytes: plain.byteLength,
    });
    expect(imageMedia?.kind).toBe("image");

    const data = await opened.downloadMedia(fileMedia?.ref ?? "", 1024);
    expect(data.toString()).toBe("report contents");
    expect(
      mock.requests.filter((request) => request.path === "/c2c/download"),
    ).toHaveLength(1);
    const picture = await opened.downloadMedia(imageMedia?.ref ?? "", 1024);
    expect(picture.toString()).toBe("png bytes");
  });

  it("rejects a redirected download, an oversized file and a bad reference", async () => {
    const opened = openChannel();
    const item = mock.hostMedia("file", Buffer.alloc(64, 1), "a.bin");
    mock.pushUserMessage({ item_list: [item] });
    await until(() => received.length === 1);
    const ref = received[0]?.media[0]?.ref ?? "";

    mock.redirectNext("/c2c/download", `${mock.baseUrl}/c2c/elsewhere`);
    await expect(opened.downloadMedia(ref, 1024)).rejects.toBeInstanceOf(
      IlinkUrlError,
    );
    expect(
      mock.requests.some((request) => request.path === "/c2c/elsewhere"),
    ).toBe(false);
    await expect(opened.downloadMedia(ref, 10)).rejects.toBeInstanceOf(
      IlinkMediaTooLargeError,
    );
    await expect(opened.downloadMedia("not json", 1024)).rejects.toThrow(
      "not valid",
    );
    await expect(
      opened.downloadMedia(JSON.stringify({ type: 1 }), 1024),
    ).rejects.toThrow("no file");
  });

  it("aborts a download through the signal", async () => {
    const opened = openChannel();
    const item = mock.hostMedia("file", Buffer.alloc(64, 1), "a.bin");
    mock.pushUserMessage({ item_list: [item] });
    await until(() => received.length === 1);
    mock.delayNext("/c2c/download", 500);
    const controller = new AbortController();
    const pending = opened.downloadMedia(
      received[0]?.media[0]?.ref ?? "",
      1024,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});

describe("sending", () => {
  it("sends text and files with the context token", async () => {
    const opened = openChannel();
    const text = await opened.sendText(USER_ID, "ctx-1", "hello");
    expect(text).toMatchObject({ ok: true });
    expect(mock.sent[0]).toMatchObject({
      text: "hello",
      contextToken: "ctx-1",
    });
    expect(mock.sent[0]?.body).toMatchObject({
      msg: { to_user_id: USER_ID, message_type: 2, message_state: 2 },
    });

    const file = await opened.sendFile(USER_ID, "ctx-1", {
      name: "notes.txt",
      data: Buffer.from("notes"),
    });
    expect(file).toMatchObject({ ok: true });
    expect(mock.uploads.size).toBe(1);
    expect(mock.sent[1]?.item?.file_item?.file_name).toBe("notes.txt");
    expect(mock.sent[1]?.contextToken).toBe("ctx-1");
  });

  it("maps a -14 to reauth-required, for polling and sending", async () => {
    mock.setStaleToken(true);
    const opened = openChannel();
    await until(() => states.includes("reauth-required"));
    expect(await opened.sendText(USER_ID, undefined, "x")).toEqual({
      ok: false,
      reason: "reauth-required",
      code: -14,
    });
    await opened.stop();
    expect(states.at(-1)).toBe("stopped");
  });

  it("maps other failures", async () => {
    const opened = openChannel();
    mock.failNext("/sendmessage", { body: { ret: -2, errmsg: "limit" } });
    expect(await opened.sendText(USER_ID, "ctx", "x")).toEqual({
      ok: false,
      reason: "rejected",
      code: -2,
    });
    mock.failNext("/sendmessage", { status: 502 });
    expect(await opened.sendText(USER_ID, "ctx", "x")).toEqual({
      ok: false,
      reason: "network",
    });
    expect(sendFailure(new IlinkUrlError("no"))).toEqual({
      ok: false,
      reason: "network",
    });
    expect(sendFailure(new IlinkApiError("x", { errcode: -14 }))).toMatchObject(
      { reason: "reauth-required" },
    );
  });

  it("an account host the gate refuses needs a new scan", async () => {
    const opened = createClawBotChannels({
      fetch: globalThis.fetch,
      version: "1.4.2",
    }).open({
      token: "t",
      botId: BOT_ID,
      userId: USER_ID,
      baseUrl: mock.baseUrl,
    });
    channel = opened;
    opened.start(
      {
        onMessages: () => Promise.resolve(),
        onState: (state) => states.push(state),
      },
      "",
    );
    expect(states).toEqual(["connecting", "reauth-required"]);
    expect(await opened.sendText(USER_ID, undefined, "x")).toMatchObject({
      ok: false,
    });
    expect(mock.requests).toHaveLength(0);
  });
});

describe("typing", () => {
  it("sends typing, keeps it alive and cancels it", async () => {
    const opened = openChannel({ typingKeepaliveMs: 30 });
    await opened.setTyping(USER_ID, "ctx", true);
    expect(mock.typing[0]?.status).toBe(1);
    await until(() => mock.typing.length >= 3);
    await opened.setTyping(USER_ID, "ctx", false);
    expect(mock.typing.at(-1)?.status).toBe(2);
    const count = mock.typing.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(mock.typing).toHaveLength(count);
    expect(
      mock.requests.filter((request) => request.path.endsWith("/getconfig")),
    ).toHaveLength(1);
  });

  it("swallows typing errors", async () => {
    const opened = openChannel();
    mock.failNext("/getconfig", { status: 500 });
    await expect(
      opened.setTyping(USER_ID, "ctx", true),
    ).resolves.toBeUndefined();
    expect(mock.typing).toHaveLength(0);
  });
});

describe("binding", () => {
  it("reports the QR flow and the credentials", async () => {
    const events: ChannelBindingEvent[] = [];
    const binding = factory().bind((event) => events.push(event), "old-token");
    await until(() => events.some((event) => event.type === "qr"));
    const qrRequest = mock.requests.find((request) =>
      request.path.endsWith("/get_bot_qrcode"),
    );
    expect(qrRequest?.body).toMatchObject({ local_token_list: ["old-token"] });
    mock.qr.scan();
    await until(() => events.some((event) => event.type === "scanned"));
    mock.qr.confirm();
    await until(() => events.some((event) => event.type === "confirmed"));
    expect(events.find((event) => event.type === "confirmed")).toEqual({
      type: "confirmed",
      credentials: {
        token: "mock-bot-token",
        botId: BOT_ID,
        userId: USER_ID,
        baseUrl: mock.baseUrl,
      },
    });
    const qr = events.find((event) => event.type === "qr");
    expect(qr && "refresh" in qr).toBe(false);
    binding.cancel();
  });

  it("passes the verify-code step and cancellation", async () => {
    const events: ChannelBindingEvent[] = [];
    mock.qr.requireVerifyCode("4321");
    const binding = factory().bind((event) => events.push(event));
    await until(() => events.some((event) => event.type === "qr"));
    mock.qr.scan();
    await until(() =>
      events.some((event) => event.type === "need-verify-code"),
    );
    binding.cancel();
    await until(() => events.some((event) => event.type === "failed"));
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      reason: "cancelled",
    });
  });
});

describe("allowsBaseUrl", () => {
  it("uses the default gate", () => {
    const channels = createClawBotChannels({
      fetch: globalThis.fetch,
      version: "1.4.2",
    });
    expect(channels.allowsBaseUrl("https://ilinkai.weixin.qq.com")).toBe(true);
    expect(channels.allowsBaseUrl("http://ilinkai.weixin.qq.com")).toBe(false);
    expect(channels.allowsBaseUrl("https://127.0.0.1")).toBe(false);
    expect(channels.allowsBaseUrl("https://evil.example.com")).toBe(false);
    expect(channels.allowsBaseUrl("not a url")).toBe(false);
  });

  it("uses an injected gate", () => {
    const channels = createClawBotChannels({
      fetch: globalThis.fetch,
      version: "1.4.2",
      allowUrl: (url, purpose) => purpose === "api" && url.port === "8080",
    });
    expect(channels.allowsBaseUrl("http://localhost:8080")).toBe(true);
    expect(channels.allowsBaseUrl("http://localhost:8081")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  IlinkHttpError,
  IlinkResponseError,
  IlinkTimeoutError,
  IlinkUrlError,
} from "../errors";
import {
  type Fetch,
  type IlinkTransportOptions,
  botAgent,
  channelVersion,
  clientVersionHeader,
  defaultAllowUrl,
  getJson,
  guardedFetch,
  postJson,
} from "../http";

const IDENTITY = { hostName: "pine", hostVersion: "1.4.2" };

interface Call {
  url: string;
  init: RequestInit;
}

/** A transport whose fetch records every call and answers through `respond`. */
function fakeTransport(
  respond: (call: Call) => Response | Promise<Response> = () =>
    new Response("{}"),
  overrides: Partial<IlinkTransportOptions> = {},
): { transport: IlinkTransportOptions; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = (url, init = {}) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { transport: { fetch, identity: IDENTITY, ...overrides }, calls };
}

/** A fetch that answers only when its signal aborts, as a hung server would. */
function hangingFetch(): Fetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

function withProperty(
  response: Response,
  name: "redirected" | "status" | "type",
  value: unknown,
): Response {
  Object.defineProperty(response, name, { value });
  return response;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("The promise did not reject.");
}

describe("identity", () => {
  it("builds a bot_agent the server's grammar accepts", () => {
    const grammar = /^[A-Za-z0-9_.-]{1,32}\/[A-Za-z0-9_.+-]{1,32}$/;
    expect(botAgent(IDENTITY)).toBe("Pine/1.4.2");
    for (const identity of [
      IDENTITY,
      { hostName: "pine", hostVersion: "0.16.0-beta.1+build 7" },
      { hostName: "pine server (headless)", hostVersion: "1.0.0" },
      { hostName: "松", hostVersion: "" },
      { hostName: "p".repeat(80), hostVersion: "1".repeat(80) },
    ]) {
      expect(botAgent(identity)).toMatch(grammar);
      expect(channelVersion(identity).startsWith("2.4.10/")).toBe(true);
      expect(channelVersion(identity)).not.toMatch(/\s/);
    }
    expect(
      botAgent({ hostName: "pine", hostVersion: "0.16.0-beta.1+build 7" }),
    ).toBe("Pine/0.16.0-beta.1+build7");
  });

  it("packs a version into the client-version header", () => {
    expect(clientVersionHeader()).toBe("132106");
    expect(clientVersionHeader("2.4.10")).toBe("132106");
    expect(clientVersionHeader("1.0.11")).toBe("65547");
    expect(clientVersionHeader("3.0.0-beta-0")).toBe("196608");
    expect(clientVersionHeader("nonsense")).toBe("0");
  });
});

describe("defaultAllowUrl", () => {
  const allows = (url: string, purpose: "api" | "cdn") =>
    defaultAllowUrl(new URL(url), purpose);

  it("allows the two default hosts", () => {
    expect(allows("https://ilinkai.weixin.qq.com/ilink/bot/x", "api")).toBe(
      true,
    );
    expect(allows("https://ilinkai.weixin.qq.com:443/x", "api")).toBe(true);
    expect(
      allows("https://novac2c.cdn.weixin.qq.com/c2c/download", "cdn"),
    ).toBe(true);
  });

  it("separates API hosts from CDN hosts", () => {
    expect(allows("https://x.qq.com/a", "api")).toBe(false);
    expect(allows("https://x.qq.com/a", "cdn")).toBe(true);
    expect(allows("https://idc2.weixin.qq.com/a", "api")).toBe(true);
    expect(allows("https://idc2.weixin.qq.com/a", "cdn")).toBe(true);
  });

  it("refuses everything but https on the default port", () => {
    expect(allows("http://ilinkai.weixin.qq.com/x", "api")).toBe(false);
    expect(allows("ws://ilinkai.weixin.qq.com/x", "api")).toBe(false);
    expect(allows("file:///etc/passwd", "cdn")).toBe(false);
    expect(allows("https://ilinkai.weixin.qq.com:8443/x", "api")).toBe(false);
    expect(allows("https://x.qq.com:8443/x", "cdn")).toBe(false);
  });

  it("refuses credentials in the URL", () => {
    expect(allows("https://user@ilinkai.weixin.qq.com/x", "api")).toBe(false);
    expect(allows("https://user:pw@ilinkai.weixin.qq.com/x", "api")).toBe(
      false,
    );
    expect(allows("https://:pw@x.qq.com/x", "cdn")).toBe(false);
  });

  it("refuses IP addresses, however they are written", () => {
    for (const purpose of ["api", "cdn"] as const) {
      expect(allows("https://127.0.0.1/x", purpose)).toBe(false);
      expect(allows("https://[::1]/x", purpose)).toBe(false);
      expect(allows("https://2130706433/x", purpose)).toBe(false);
      expect(allows("https://0x7f.1/x", purpose)).toBe(false);
      expect(allows("https://[::ffff:10.0.0.1]/x", purpose)).toBe(false);
    }
  });

  it("refuses hosts that only contain the allowed name", () => {
    for (const purpose of ["api", "cdn"] as const) {
      expect(allows("https://evil-weixin.qq.com.example.org/x", purpose)).toBe(
        false,
      );
      expect(allows("https://weixin.qq.com.example.org/x", purpose)).toBe(
        false,
      );
      expect(allows("https://example.org/weixin.qq.com", purpose)).toBe(false);
      expect(allows("https://example.org/?h=.weixin.qq.com", purpose)).toBe(
        false,
      );
      expect(allows("https://example.org#.qq.com", purpose)).toBe(false);
      expect(allows("https://localhost/x", purpose)).toBe(false);
    }
    expect(allows("https://evilweixin.qq.com/x", "api")).toBe(false);
    expect(allows("https://weixin.qq.com/x", "api")).toBe(false);
    expect(allows("https://xqq.com/x", "cdn")).toBe(false);
    expect(allows("https://qq.com/x", "cdn")).toBe(false);
    expect(allows("https://ILINKAI.WEIXIN.QQ.COM/x", "api")).toBe(true);
  });
});

describe("guardedFetch", () => {
  it("never fetches a URL the gate refuses", async () => {
    const { transport, calls } = fakeTransport();
    for (const [url, purpose] of [
      ["http://ilinkai.weixin.qq.com/x", "api"],
      ["https://127.0.0.1/x", "api"],
      ["https://x.qq.com/x", "api"],
      ["https://example.org/c2c/download?encrypted_query_param=SECRET", "cdn"],
      ["not a url", "cdn"],
    ] as const) {
      const error = await rejection(
        guardedFetch(transport, url, purpose, { timeoutMs: 1_000 }),
      );
      expect(error).toBeInstanceOf(IlinkUrlError);
      expect((error as Error).message).not.toContain("SECRET");
    }
    expect(calls).toEqual([]);
  });

  it("asks the transport's own gate, with the purpose", async () => {
    const seen: [string, string][] = [];
    const { transport, calls } = fakeTransport(undefined, {
      allowUrl: (url, purpose) => {
        seen.push([url.href, purpose]);
        return url.hostname === "127.0.0.1";
      },
    });
    await guardedFetch(transport, "http://127.0.0.1:4000/c2c/x", "cdn", {
      timeoutMs: 1_000,
    });
    await expect(
      guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
    expect(seen).toEqual([
      ["http://127.0.0.1:4000/c2c/x", "cdn"],
      ["https://ilinkai.weixin.qq.com/x", "api"],
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4000/c2c/x",
    ]);
  });

  it("tells fetch not to follow redirects, whatever the caller passes", async () => {
    const { transport, calls } = fakeTransport();
    const response = await guardedFetch(
      transport,
      "https://ilinkai.weixin.qq.com/x",
      "api",
      { method: "POST", body: "{}", redirect: "follow", timeoutMs: 1_000 },
    );
    expect(response.status).toBe(200);
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init).not.toHaveProperty("timeoutMs");
  });

  it("refuses a response that was redirected", async () => {
    const { transport } = fakeTransport(() =>
      withProperty(new Response("{}"), "redirected", true),
    );
    await expect(
      guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
  });

  it("refuses a 3xx status and an opaque redirect", async () => {
    for (const response of [
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:9/steal" },
        }),
      () => new Response(null, { status: 307 }),
      () => withProperty(new Response(null), "type", "opaqueredirect"),
    ]) {
      const { transport } = fakeTransport(response);
      const error = await rejection(
        guardedFetch(transport, "https://x.qq.com/c2c/download", "cdn", {
          timeoutMs: 1_000,
        }),
      );
      expect(error).toBeInstanceOf(IlinkUrlError);
      expect((error as Error).message).not.toContain("127.0.0.1");
    }
  });

  it("turns a fetch that failed on a redirect into IlinkUrlError", async () => {
    for (const failure of [
      // Node's fetch.
      new TypeError("fetch failed", {
        cause: new Error("unexpected redirect"),
      }),
      // Electron's net.fetch.
      new Error("Attempted to redirect, but redirect policy was 'error'"),
    ]) {
      const { transport } = fakeTransport(() => Promise.reject(failure));
      await expect(
        guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
          timeoutMs: 1_000,
        }),
      ).rejects.toBeInstanceOf(IlinkUrlError);
    }
  });

  it("passes other fetch failures on unchanged", async () => {
    const failure = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND ilinkai.weixin.qq.com"),
    });
    const { transport } = fakeTransport(() => Promise.reject(failure));
    await expect(
      guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
        timeoutMs: 1_000,
      }),
    ).rejects.toBe(failure);
  });

  it("gives up with IlinkTimeoutError and aborts the request", async () => {
    let signal: AbortSignal | undefined;
    const hang = hangingFetch();
    const transport: IlinkTransportOptions = {
      identity: IDENTITY,
      fetch: (url, init) => {
        signal = init?.signal ?? undefined;
        return hang(url, init);
      },
    };
    const error = await rejection(
      guardedFetch(
        transport,
        "https://ilinkai.weixin.qq.com/x?qrcode=SECRET",
        "api",
        {
          timeoutMs: 20,
        },
      ),
    );
    expect(error).toBeInstanceOf(IlinkTimeoutError);
    expect((error as Error).message).not.toContain("SECRET");
    expect(signal?.aborted).toBe(true);
  });

  it("times out even when fetch ignores its signal", async () => {
    const transport: IlinkTransportOptions = {
      identity: IDENTITY,
      fetch: () => new Promise<Response>(() => undefined),
    };
    await expect(
      guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(IlinkTimeoutError);
  });

  it("stops on the caller's signal, which is not a timeout", async () => {
    const transport: IlinkTransportOptions = {
      identity: IDENTITY,
      fetch: hangingFetch(),
    };
    const controller = new AbortController();
    const pending = rejection(
      guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
        timeoutMs: 5_000,
        signal: controller.signal,
      }),
    );
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(IlinkTimeoutError);
    expect((error as Error).name).toBe("AbortError");
  });

  it("sends nothing when the caller's signal is already aborted", async () => {
    const { transport, calls } = fakeTransport();
    const error = await rejection(
      guardedFetch(transport, "https://ilinkai.weixin.qq.com/x", "api", {
        timeoutMs: 1_000,
        signal: AbortSignal.abort(),
      }),
    );
    expect((error as Error).name).toBe("AbortError");
    expect(calls).toEqual([]);
  });

  it("keeps the caller's signal connected after the response arrived", async () => {
    const { transport, calls } = fakeTransport();
    const controller = new AbortController();
    await guardedFetch(transport, "https://x.qq.com/c2c/download", "cdn", {
      timeoutMs: 20,
      signal: controller.signal,
    });
    // The timeout no longer applies once the response is there …
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    // … but the caller can still end a body download.
    controller.abort();
    expect(calls[0]?.init.signal?.aborted).toBe(true);
  });
});

describe("postJson", () => {
  it("sends the POST headers and base_info of an authenticated call", async () => {
    const { transport, calls } = fakeTransport(
      () =>
        new Response('{"ret":0,"msgs":[{"message_id":18446744073709551615}]}'),
      { randomBytes: () => Uint8Array.of(0x12, 0x34, 0x56, 0x78) },
    );
    const answer = await postJson(transport, {
      endpoint: "ilink/bot/getupdates",
      label: "getUpdates",
      timeoutMs: 1_000,
      token: "  bot-token \n",
      body: { get_updates_buf: "" },
    });

    expect(answer).toEqual({
      ret: 0,
      msgs: [{ message_id: "18446744073709551615" }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/getupdates",
    );
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.redirect).toBe("error");
    expect(headersOf(calls[0])).toEqual({
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": Buffer.from(String(0x12345678)).toString("base64"),
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": "132106",
      Authorization: "Bearer bot-token",
    });
    expect(bodyOf(calls[0])).toEqual({
      get_updates_buf: "",
      base_info: {
        channel_version: "2.4.10/pine-1.4.2",
        bot_agent: "Pine/1.4.2",
      },
    });
  });

  it("sends a new X-WECHAT-UIN with every request", async () => {
    const { transport, calls } = fakeTransport();
    const request = {
      endpoint: "ilink/bot/sendmessage",
      label: "sendMessage",
      timeoutMs: 1_000,
      token: "t",
      body: {},
    };
    for (let count = 0; count < 8; count++) await postJson(transport, request);
    const values = calls.map((call) => headersOf(call)["X-WECHAT-UIN"] ?? "");
    for (const value of values) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      expect(decoded).toMatch(/^\d{1,10}$/);
      expect(Number(decoded)).toBeLessThanOrEqual(0xffffffff);
      expect(Buffer.from(decoded).toString("base64")).toBe(value);
    }
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("sends no Authorization and no base_info without a token", async () => {
    const { transport, calls } = fakeTransport(
      () => new Response('{"qrcode":"q","qrcode_img_content":"c"}'),
    );
    for (const token of [undefined, "", "   "]) {
      await postJson(transport, {
        endpoint: "ilink/bot/get_bot_qrcode?bot_type=3",
        label: "getQrCode",
        timeoutMs: 1_000,
        token,
        body: { local_token_list: [] },
      });
    }
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.url).toBe(
        "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
      );
      expect(Object.keys(headersOf(call)).sort()).toEqual([
        "AuthorizationType",
        "Content-Type",
        "X-WECHAT-UIN",
        "iLink-App-ClientVersion",
        "iLink-App-Id",
      ]);
      expect(bodyOf(call)).toEqual({ local_token_list: [] });
    }
  });

  it("never sets Content-Length", async () => {
    const { transport, calls } = fakeTransport();
    await postJson(transport, {
      endpoint: "ilink/bot/sendmessage",
      label: "sendMessage",
      timeoutMs: 1_000,
      token: "t",
      body: { msg: { item_list: [{ type: 1, text_item: { text: "你好" } }] } },
    });
    const names = Object.keys(headersOf(calls[0])).map((name) =>
      name.toLowerCase(),
    );
    expect(names).not.toContain("content-length");
  });

  it("uses the account's base URL, then the transport's, then the default", async () => {
    const { transport, calls } = fakeTransport(undefined, {
      apiBaseUrl: "http://127.0.0.1:4010",
      allowUrl: () => true,
    });
    const request = {
      endpoint: "ilink/bot/msg/notifystart",
      label: "notifyStart",
      timeoutMs: 1_000,
      token: "t",
      body: {},
    };
    await postJson(transport, request);
    await postJson(transport, {
      ...request,
      baseUrl: " https://idc2.weixin.qq.com/ ",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4010/ilink/bot/msg/notifystart",
      "https://idc2.weixin.qq.com/ilink/bot/msg/notifystart",
    ]);
  });

  it("checks the account's base URL as an API URL before sending", async () => {
    const { transport, calls } = fakeTransport();
    for (const baseUrl of [
      "https://x.qq.com",
      "http://ilinkai.weixin.qq.com",
      "https://evil-weixin.qq.com.example.org",
      "nonsense",
    ]) {
      await expect(
        postJson(transport, {
          endpoint: "ilink/bot/getupdates",
          label: "getUpdates",
          timeoutMs: 1_000,
          token: "bot-token",
          body: {},
          baseUrl,
        }),
      ).rejects.toBeInstanceOf(IlinkUrlError);
    }
    expect(calls).toEqual([]);
  });

  it("turns a status outside 2xx into IlinkHttpError without the body", async () => {
    const { transport } = fakeTransport(
      () => new Response("upstream said: bot-token", { status: 502 }),
    );
    const error = await rejection(
      postJson(transport, {
        endpoint: "ilink/bot/sendmessage",
        label: "sendMessage",
        timeoutMs: 1_000,
        token: "bot-token",
        body: {},
      }),
    );
    expect(error).toBeInstanceOf(IlinkHttpError);
    expect((error as IlinkHttpError).status).toBe(502);
    expect((error as Error).message).toContain("sendMessage");
    expect((error as Error).message).not.toContain("bot-token");
  });

  it("refuses a redirect before looking at the status", async () => {
    const { transport } = fakeTransport(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:9/" },
        }),
    );
    await expect(
      postJson(transport, {
        endpoint: "ilink/bot/getupdates",
        label: "getUpdates",
        timeoutMs: 1_000,
        token: "t",
        body: {},
      }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
  });

  it("refuses a body that is not JSON without quoting it", async () => {
    const { transport } = fakeTransport(
      () => new Response('{"bot_token":"secret-value'),
    );
    const error = await rejection(
      postJson(transport, {
        endpoint: "ilink/bot/getupdates",
        label: "getUpdates",
        timeoutMs: 1_000,
        token: "t",
        body: {},
      }),
    );
    expect(error).toBeInstanceOf(IlinkResponseError);
    expect((error as Error).message).toContain("getUpdates");
    expect((error as Error).message).not.toContain("secret");
  });

  it("can leave the body of an answer unparsed", async () => {
    const { transport } = fakeTransport(() => new Response(""));
    const request = {
      endpoint: "ilink/bot/sendtyping",
      label: "sendTyping",
      timeoutMs: 1_000,
      token: "t",
      body: {},
    };
    await expect(
      postJson(transport, { ...request, ignoreBody: true }),
    ).resolves.toBeUndefined();
    await expect(postJson(transport, request)).rejects.toBeInstanceOf(
      IlinkResponseError,
    );
  });

  it("lets the timeout cover the reading of the body", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ret":'));
      },
    });
    const { transport } = fakeTransport(() => new Response(stalled));
    await expect(
      postJson(transport, {
        endpoint: "ilink/bot/getupdates",
        label: "getUpdates",
        timeoutMs: 20,
        token: "t",
        body: {},
      }),
    ).rejects.toBeInstanceOf(IlinkTimeoutError);
  });

  it("passes the caller's signal on", async () => {
    const transport: IlinkTransportOptions = {
      identity: IDENTITY,
      fetch: hangingFetch(),
    };
    const controller = new AbortController();
    const pending = rejection(
      postJson(transport, {
        endpoint: "ilink/bot/getupdates",
        label: "getUpdates",
        timeoutMs: 5_000,
        token: "t",
        body: {},
        signal: controller.signal,
      }),
    );
    controller.abort();
    expect(((await pending) as Error).name).toBe("AbortError");
  });
});

describe("getJson", () => {
  it("sends only the common headers, and no body", async () => {
    const { transport, calls } = fakeTransport(
      () => new Response('{"status":"wait"}'),
    );
    const answer = await getJson(transport, {
      endpoint: "ilink/bot/get_qrcode_status?qrcode=abc%2F1",
      label: "getQrStatus",
      timeoutMs: 1_000,
    });
    expect(answer).toEqual({ status: "wait" });
    expect(calls[0]?.url).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=abc%2F1",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": "132106",
    });
  });

  it("polls another host after an IDC redirect, if it is an API host", async () => {
    const { transport, calls } = fakeTransport(
      () => new Response('{"status":"scaned"}'),
    );
    const request = {
      endpoint: "ilink/bot/get_qrcode_status?qrcode=q",
      label: "getQrStatus",
      timeoutMs: 1_000,
    };
    await getJson(transport, {
      ...request,
      baseUrl: "https://idc2.weixin.qq.com",
    });
    await expect(
      getJson(transport, { ...request, baseUrl: "https://attacker.example" }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
    expect(calls.map((call) => call.url)).toEqual([
      "https://idc2.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=q",
    ]);
  });

  it("reports HTTP errors and timeouts like a POST", async () => {
    const failing = fakeTransport(() => new Response("no", { status: 524 }));
    const error = await rejection(
      getJson(failing.transport, {
        endpoint: "ilink/bot/get_qrcode_status?qrcode=SECRET",
        label: "getQrStatus",
        timeoutMs: 1_000,
      }),
    );
    expect(error).toBeInstanceOf(IlinkHttpError);
    expect((error as IlinkHttpError).status).toBe(524);
    expect((error as Error).message).not.toContain("SECRET");

    await expect(
      getJson(
        { identity: IDENTITY, fetch: hangingFetch() },
        {
          endpoint: "ilink/bot/get_qrcode_status?qrcode=q",
          label: "getQrStatus",
          timeoutMs: 20,
        },
      ),
    ).rejects.toBeInstanceOf(IlinkTimeoutError);
  });
});

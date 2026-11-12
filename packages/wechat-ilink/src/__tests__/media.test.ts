import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IlinkClient } from "../client";
import { paddedSize } from "../crypto";
import { IlinkHttpError, IlinkUrlError } from "../errors";
import type { IlinkTransportOptions } from "../http";
import {
  IlinkMediaTooLargeError,
  downloadMedia,
  mediaKindForFileName,
  uploadMedia,
} from "../media";
import { type MockIlink, startMockIlink } from "../testing";
import type { MessageItem } from "../types";

const IDENTITY = { hostName: "pine", hostVersion: "1.4.2" };

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

function transport(
  overrides: Partial<IlinkTransportOptions> = {},
): IlinkTransportOptions {
  return {
    fetch: (url, init) => fetch(url, init),
    identity: IDENTITY,
    allowUrl: () => true,
    apiBaseUrl: mock.baseUrl,
    cdnBaseUrl: mock.cdnBaseUrl,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

function client(overrides: Partial<IlinkTransportOptions> = {}): IlinkClient {
  return new IlinkClient({
    ...transport(overrides),
    botToken: "token",
    baseUrl: mock.baseUrl,
  });
}

const cdnRequests = (server: MockIlink, suffix: string) =>
  server.requests.filter((request) => request.path === `/c2c/${suffix}`);

describe("mediaKindForFileName", () => {
  it("routes by extension", () => {
    expect(mediaKindForFileName("a.PNG")).toBe("image");
    expect(mediaKindForFileName("dir/b.jpeg")).toBe("image");
    expect(mediaKindForFileName("c.mov")).toBe("video");
    expect(mediaKindForFileName("d.pdf")).toBe("file");
    expect(mediaKindForFileName(".png")).toBe("file");
    expect(mediaKindForFileName("noext")).toBe("file");
  });
});

describe("uploadMedia and downloadMedia", () => {
  it("round-trips a file through the CDN", async () => {
    const data = randomBytes(1_000);
    const item = await uploadMedia({
      client: client(),
      transport: transport(),
      toUserId: "u",
      fileName: "/tmp/report.pdf",
      data,
    });
    const body = mock.requests.find((r) => r.path.endsWith("getuploadurl"))
      ?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      media_type: 3,
      to_user_id: "u",
      rawsize: 1_000,
      rawfilemd5: createHash("md5").update(data).digest("hex"),
      filesize: paddedSize(1_000),
      no_need_thumb: true,
    });
    expect(body.filekey).toMatch(/^[0-9a-f]{32}$/);
    expect(body.aeskey).toMatch(/^[0-9a-f]{32}$/);

    const upload = cdnRequests(mock, "upload")[0];
    expect(upload?.headers["content-type"]).toBe("application/octet-stream");
    expect(upload?.headers.authorization).toBeUndefined();
    expect(upload?.query.filekey).toBe(body.filekey);

    expect(item.type).toBe(4);
    expect(item.file_item?.file_name).toBe("report.pdf");
    expect(item.file_item?.len).toBe("1000");
    const media = item.file_item?.media;
    expect(media?.encrypt_type).toBe(1);
    expect(mock.uploads.get(media?.encrypt_query_param ?? "")?.byteLength).toBe(
      paddedSize(1_000),
    );
    // The outbound key is base64 of the hex characters.
    expect(Buffer.from(media?.aes_key ?? "", "base64").toString("ascii")).toBe(
      body.aeskey,
    );

    const back = await downloadMedia({ transport: transport(), item });
    expect(back?.kind).toBe("file");
    expect(back?.fileName).toBe("report.pdf");
    expect(back?.data.equals(data)).toBe(true);
  });

  it("builds image and video items with their ciphertext size", async () => {
    const image = await uploadMedia({
      client: client(),
      transport: transport(),
      toUserId: "u",
      fileName: "a.png",
      data: randomBytes(20),
    });
    expect(image.type).toBe(2);
    expect(image.image_item?.mid_size).toBe(32);
    const video = await uploadMedia({
      client: client(),
      transport: transport(),
      toUserId: "u",
      fileName: "a.bin",
      kind: "video",
      data: randomBytes(16),
    });
    expect(video.type).toBe(5);
    expect(video.video_item?.video_size).toBe(32);
    const types = mock.requests
      .filter((r) => r.path.endsWith("getuploadurl"))
      .map((r) => (r.body as { media_type: number }).media_type);
    expect(types).toEqual([1, 2]);
  });

  it("decrypts inbound media with either key encoding", async () => {
    const plain = randomBytes(300);
    for (const kind of ["image", "file", "video"] as const) {
      const item = mock.hostMedia(kind, plain, "x.dat");
      const result = await downloadMedia({ transport: transport(), item });
      expect(result?.kind).toBe(kind);
      expect(result?.data.equals(plain)).toBe(true);
    }
  });

  it("prefers the hex aeskey of an image and the full_url of any item", async () => {
    const plain = randomBytes(40);
    const item = mock.hostMedia("image", plain);
    const media = item.image_item?.media ?? {};
    const key = Buffer.from(media.aes_key ?? "", "base64").toString("hex");
    const changed: MessageItem = {
      type: 2,
      image_item: {
        aeskey: key,
        media: {
          aes_key: randomBytes(16).toString("base64"),
          encrypt_query_param: "wrong",
          full_url: `${mock.cdnBaseUrl}/download?encrypted_query_param=${media.encrypt_query_param ?? ""}`,
        },
      },
    };
    const result = await downloadMedia({
      transport: transport(),
      item: changed,
    });
    expect(result?.data.equals(plain)).toBe(true);
  });

  it("has nothing to fetch for text or a key-less file", async () => {
    await expect(
      downloadMedia({
        transport: transport(),
        item: { type: 1, text_item: { text: "hi" } },
      }),
    ).resolves.toBeUndefined();
    await expect(
      downloadMedia({
        transport: transport(),
        item: { type: 4, file_item: { media: { encrypt_query_param: "x" } } },
      }),
    ).resolves.toBeUndefined();
    expect(cdnRequests(mock, "download")).toHaveLength(0);
  });

  it("enforces the size cap while reading", async () => {
    const item = mock.hostMedia("file", randomBytes(5_000), "big.bin");
    await expect(
      downloadMedia({ transport: transport(), item, maxBytes: 1_000 }),
    ).rejects.toBeInstanceOf(IlinkMediaTooLargeError);
    const exact = mock.hostMedia("file", randomBytes(1_000), "ok.bin");
    await expect(
      downloadMedia({ transport: transport(), item: exact, maxBytes: 1_000 }),
    ).resolves.toBeDefined();
  });

  it("aborts a slow download through the signal", async () => {
    const item = mock.hostMedia("file", randomBytes(10), "slow.bin");
    mock.delayNext("/c2c/download", 500);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop")), 20);
    await expect(
      downloadMedia({
        transport: transport(),
        item,
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop");
  });

  it("aborts an upload on 4xx and retries on 5xx", async () => {
    mock.failNext("/c2c/upload", { status: 413 });
    await expect(
      uploadMedia({
        client: client(),
        transport: transport(),
        toUserId: "u",
        fileName: "a.txt",
        data: randomBytes(10),
      }),
    ).rejects.toBeInstanceOf(IlinkHttpError);
    expect(cdnRequests(mock, "upload")).toHaveLength(1);

    mock.failNext("/c2c/upload", { status: 500 });
    mock.failNext("/c2c/upload", { status: 503 });
    await expect(
      uploadMedia({
        client: client(),
        transport: transport(),
        toUserId: "u",
        fileName: "a.txt",
        data: randomBytes(10),
      }),
    ).resolves.toMatchObject({ type: 4 });
    expect(cdnRequests(mock, "upload")).toHaveLength(4);

    for (let index = 0; index < 3; index++) {
      mock.failNext("/c2c/upload", { status: 500 });
    }
    await expect(
      uploadMedia({
        client: client(),
        transport: transport(),
        toUserId: "u",
        fileName: "a.txt",
        data: randomBytes(10),
      }),
    ).rejects.toBeInstanceOf(IlinkHttpError);
    expect(cdnRequests(mock, "upload")).toHaveLength(7);
  });

  it("asks the gate with purpose cdn for every CDN URL", async () => {
    const onlyApi = transport({
      allowUrl: (_url, purpose) => purpose === "api",
    });
    await expect(
      uploadMedia({
        client: client(),
        transport: onlyApi,
        toUserId: "u",
        fileName: "a.txt",
        data: randomBytes(10),
      }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
    expect(cdnRequests(mock, "upload")).toHaveLength(0);

    const item = mock.hostMedia("file", randomBytes(10), "a.txt");
    await expect(
      downloadMedia({ transport: onlyApi, item }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
    expect(cdnRequests(mock, "download")).toHaveLength(0);
  });

  it("never follows a redirect of a CDN download or upload", async () => {
    other = await startMockIlink();
    const item = mock.hostMedia("file", randomBytes(10), "a.txt");
    mock.redirectNext("/c2c/download", `${other.cdnBaseUrl}/download?x=1`);
    await expect(
      downloadMedia({ transport: transport(), item }),
    ).rejects.toBeInstanceOf(IlinkUrlError);

    mock.redirectNext("/c2c/upload", `${other.cdnBaseUrl}/upload?x=1`);
    await expect(
      uploadMedia({
        client: client(),
        transport: transport(),
        toUserId: "u",
        fileName: "a.txt",
        data: randomBytes(10),
      }),
    ).rejects.toBeInstanceOf(IlinkUrlError);
    expect(cdnRequests(mock, "upload")).toHaveLength(1);
    expect(other.requests).toHaveLength(0);
  });

  it("refuses to upload more than the cap", async () => {
    await expect(
      uploadMedia({
        client: client(),
        transport: transport(),
        toUserId: "u",
        fileName: "a.txt",
        data: new Uint8Array(100 * 1024 * 1024 + 1),
      }),
    ).rejects.toBeInstanceOf(IlinkMediaTooLargeError);
    expect(mock.requests).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("libarchive.js", () => ({
  Archive: {
    init: vi.fn(),
    open: vi.fn(() => Promise.reject(new Error("Unrecognized archive format"))),
  },
}));

const { hasLegacyZipNames, openArchive } = await import("../archive");

function zipEntry(name: number[], flags = 0): Uint8Array {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(6, flags, true);
  view.setUint16(26, name.length, true);
  header.set(name, 30);
  return header;
}

afterEach(() => vi.clearAllMocks());

describe("hasLegacyZipNames", () => {
  it("spots GBK names written without the UTF-8 flag", () => {
    // "中" in GBK is not valid UTF-8.
    expect(hasLegacyZipNames(zipEntry([0xd6, 0xd0]))).toBe(true);
    expect(
      hasLegacyZipNames(zipEntry([...new TextEncoder().encode("中")])),
    ).toBe(false);
    expect(hasLegacyZipNames(zipEntry([0xd6, 0xd0], 0x0800))).toBe(false);
    expect(hasLegacyZipNames(new Uint8Array(4))).toBe(false);
  });
});

describe("openArchive", () => {
  it("opens a single gzip file when libarchive cannot", async () => {
    const stream = new Blob([new TextEncoder().encode("hello")])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const gzip = await new Response(stream).arrayBuffer();
    const archive = await openArchive(gzip, "notes.txt.gz");
    expect(archive.entries).toEqual([{ path: "notes.txt", size: 5 }]);
    expect(new TextDecoder().decode(await archive.extract("notes.txt"))).toBe(
      "hello",
    );
  });

  it("reports archives it cannot read", async () => {
    await expect(openArchive(new ArrayBuffer(8), "broken.zip")).rejects.toThrow(
      "Unrecognized",
    );
  });
});

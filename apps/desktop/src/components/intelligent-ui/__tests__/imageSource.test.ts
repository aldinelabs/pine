import { afterEach, describe, expect, it, vi } from "vitest";
import { imageFailure, resolveImageSource } from "../imageSource";

const attachment = (path: string) =>
  `pine-attachment://local/?p=${encodeURIComponent(path)}`;

describe("resolveImageSource", () => {
  it("serves local paths with spaces and CJK through the attachment protocol", () => {
    const path = "/Users/ada/课程 资料/Lab 4/idle 1.png";
    expect(resolveImageSource(path)).toBe(attachment(path));
    expect(
      resolveImageSource(
        "file:///Users/ada/%E8%AF%BE%E7%A8%8B%20%E8%B5%84%E6%96%99/a.png",
      ),
    ).toBe(attachment("/Users/ada/课程 资料/a.png"));
    expect(resolveImageSource("C:\\Users\\ada\\a.png")).toBe(
      attachment("C:\\Users\\ada\\a.png"),
    );
  });

  it("passes home paths on for the main process to expand", () => {
    expect(resolveImageSource("~/Pictures/a b.png")).toBe(
      attachment("~/Pictures/a b.png"),
    );
  });

  it("reads relative paths from the project's default folder", () => {
    const base = "/Users/ada/课程 资料/";
    expect(resolveImageSource("Lab 4/walk 1.png", base)).toBe(
      attachment("/Users/ada/课程 资料/Lab 4/walk 1.png"),
    );
    expect(resolveImageSource("./a.png", base)).toBe(
      attachment("/Users/ada/课程 资料/a.png"),
    );
    expect(resolveImageSource("a.png")).toBeUndefined();
  });

  it("keeps web and inline images and drops other schemes", () => {
    expect(resolveImageSource("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(resolveImageSource("data:image/png;base64,AA")).toBe(
      "data:image/png;base64,AA",
    );
    expect(resolveImageSource("javascript:alert(1)")).toBeUndefined();
    expect(resolveImageSource("  ")).toBeUndefined();
  });
});

describe("imageFailure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names a denied or missing local file", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await imageFailure(attachment("/a.png"))).toBe("denied");
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await imageFailure(attachment("/a.png"))).toBe("missing");
    fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await imageFailure(attachment("/a.png"))).toBe("failed");
  });

  it("does not probe web images", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await imageFailure("https://example.com/a.png")).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { parseCsv, parseXml } from "../parse";

describe("automation parse helpers", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b,1","c ""q"""\r\n1,2,3\n')).toEqual([
      ["a", "b,1", 'c "q"'],
      ["1", "2", "3"],
    ]);
  });

  it("parses RSS into JSON", () => {
    const feed = parseXml(
      '<rss version="2.0"><channel><item><title>A &amp; B</title><guid>1</guid></item></channel></rss>',
    ) as { rss: { "@version": string; channel: { item: { title: string } } } };
    expect(feed.rss["@version"]).toBe("2.0");
    expect(feed.rss.channel.item.title).toBe("A & B");
  });
});

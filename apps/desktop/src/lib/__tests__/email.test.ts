import { describe, expect, it } from "vitest";
import { decodeWords, mboxSummary, parseEml, splitMbox } from "../email";

const message = [
  "From: =?UTF-8?B?5byg5LiJ?= <zhang@example.com>",
  "To: Bob <bob@example.com>, team: a@example.com, b@example.com;",
  "Subject: =?UTF-8?Q?Caf=C3=A9_menu?=",
  "Date: Tue, 27 Oct 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="b"',
  "",
  "--b",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Hi <img src="cid:logo@x"></p>',
  "--b",
  "Content-Type: image/png",
  "Content-ID: <logo@x>",
  "Content-Disposition: inline",
  "Content-Transfer-Encoding: base64",
  "",
  "AQID",
  "--b",
  "Content-Type: text/plain",
  'Content-Disposition: attachment; filename="notes.txt"',
  "",
  "notes",
  "--b--",
  "",
].join("\r\n");

describe("parseEml", () => {
  it("reads addresses, the body and inline and listed attachments", async () => {
    const mail = await parseEml(new TextEncoder().encode(message));
    expect(mail.subject).toBe("Café menu");
    expect(mail.from).toEqual({ name: "张三", address: "zhang@example.com" });
    expect(mail.to.map((item) => item.address)).toEqual([
      "bob@example.com",
      "a@example.com",
      "b@example.com",
    ]);
    expect(mail.date?.toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(mail.html).toContain('src="cid:logo@x"');
    expect(
      mail.attachments.map((item) => [item.name, item.contentId, item.inline]),
    ).toEqual([
      ["attachment-1", "logo@x", true],
      ["notes.txt", undefined, false],
    ]);
    expect(Array.from(mail.attachments[0].data)).toEqual([1, 2, 3]);
    expect(mail.headers[0]).toEqual([
      "From",
      "=?UTF-8?B?5byg5LiJ?= <zhang@example.com>",
    ]);
  });
});

describe("mailboxes", () => {
  const mbox = new TextEncoder().encode(
    "From a@x Mon Jan 1 00:00:00 2026\nFrom: A <a@x>\nSubject: One\n\nbody\nFrom b@x Mon Jan 1 00:00:00 2026\nFrom: B <b@x>\nSubject: =?UTF-8?B?5LqM?=\nDate: Thu, 1 Jan 2026 00:00:00 +0000\n\nsecond\n",
  );

  it("splits messages at separator lines", () => {
    const parts = splitMbox(mbox).map(({ start, end }) =>
      new TextDecoder().decode(mbox.subarray(start, end)),
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("From: A <a@x>\nSubject: One\n\nbody\n");
    expect(parts[1].startsWith("From: B <b@x>")).toBe(true);
  });

  it("summarizes a message from its headers", () => {
    const [, second] = splitMbox(mbox);
    expect(mboxSummary(mbox.subarray(second.start, second.end))).toEqual({
      from: "B <b@x>",
      subject: "二",
      date: new Date("2026-01-01T00:00:00Z"),
    });
  });

  it("decodes encoded words", () => {
    expect(decodeWords("=?UTF-8?Q?a_b?= =?UTF-8?B?Yw==?= d")).toBe("a bc d");
    expect(decodeWords("=?bogus?B?Yw==?=")).toBe("=?bogus?B?Yw==?=");
  });
});

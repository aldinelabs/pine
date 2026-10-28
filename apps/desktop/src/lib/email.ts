/**
 * Reads email files into one shape for the preview: RFC 822 messages (.eml)
 * with postal-mime, Outlook messages (.msg) with msgreader, and mailboxes
 * (.mbox) as a list of messages parsed when opened.
 */

export interface MailAddress {
  name?: string;
  address?: string;
}

export interface MailAttachment {
  name: string;
  mimeType?: string;
  contentId?: string;
  /** Shown inside the body (a `cid:` image) rather than listed. */
  inline: boolean;
  data: Uint8Array;
}

export interface MailMessage {
  subject?: string;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  date?: Date;
  html?: string;
  text?: string;
  headers: [string, string][];
  attachments: MailAttachment[];
}

export function formatAddress(address: MailAddress): string {
  if (address.name && address.address)
    return `${address.name} <${address.address}>`;
  return address.name || address.address || "";
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

type PostalAddress = {
  name?: string;
  address?: string;
  group?: PostalAddress[];
};

function addresses(list: PostalAddress[] | undefined): MailAddress[] {
  return (list ?? []).flatMap((item) =>
    item.group
      ? addresses(item.group)
      : [{ name: item.name, address: item.address }],
  );
}

export async function parseEml(
  buffer: ArrayBuffer | Uint8Array,
): Promise<MailMessage> {
  const { default: PostalMime } = await import("postal-mime");
  const email = await PostalMime.parse(buffer, {
    attachmentEncoding: "arraybuffer",
  });
  return {
    subject: email.subject,
    from: email.from ? addresses([email.from])[0] : undefined,
    to: addresses(email.to),
    cc: addresses(email.cc),
    date: validDate(email.date),
    html: email.html,
    text: email.text,
    headers: email.headers.map((header) => [
      header.originalKey ?? header.key,
      header.value,
    ]),
    attachments: email.attachments.map((attachment, index) => {
      const content = attachment.content;
      const data =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content instanceof Uint8Array
            ? content
            : new Uint8Array(content);
      const contentId = attachment.contentId?.replace(/^<|>$/g, "");
      return {
        name: attachment.filename || `attachment-${index + 1}`,
        mimeType: attachment.mimeType,
        contentId,
        inline:
          attachment.disposition === "inline" &&
          Boolean(contentId) &&
          Boolean(attachment.mimeType?.startsWith("image/")),
        data,
      };
    }),
  };
}

export async function parseMsg(buffer: ArrayBuffer): Promise<MailMessage> {
  const [{ default: MsgReader }, { decompressRtf, rtfToContent }] =
    await Promise.all([import("@kenjiuno/msgreader"), import("./rtfBody")]);
  const reader = new MsgReader(buffer);
  const data = reader.getFileData();
  let html = data.bodyHtml;
  if (!html && data.html) html = new TextDecoder().decode(data.html);
  let text = data.body;
  if (!html && data.compressedRtf) {
    try {
      const content = rtfToContent(decompressRtf(data.compressedRtf));
      html = content.html;
      text ||= content.text;
    } catch {
      // A damaged RTF body leaves the plain text body.
    }
  }
  const recipients = data.recipients ?? [];
  const pick = (type: string) =>
    recipients
      .filter((recipient) => (recipient.recipType ?? "to") === type)
      .map((recipient) => ({
        name: recipient.name,
        address: recipient.smtpAddress ?? recipient.email,
      }));
  const headers: [string, string][] = (data.headers ?? "")
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)
    .flatMap((line) => {
      const colon = line.indexOf(":");
      return colon > 0
        ? [
            [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [
              string,
              string,
            ],
          ]
        : [];
    });
  return {
    subject: data.subject,
    from: {
      name: data.senderName,
      address: data.senderSmtpAddress ?? data.senderEmail,
    },
    to: pick("to"),
    cc: pick("cc"),
    date: validDate(data.messageDeliveryTime ?? data.clientSubmitTime),
    html,
    text,
    headers,
    attachments: (data.attachments ?? []).flatMap((attachment, index) => {
      if (attachment.innerMsgContent) return [];
      const file = reader.getAttachment(attachment);
      const contentId = attachment.pidContentId?.replace(/^<|>$/g, "");
      return [
        {
          name: file.fileName || `attachment-${index + 1}`,
          mimeType: attachment.attachMimeTag,
          contentId,
          inline: Boolean(attachment.attachmentHidden && contentId),
          data: file.content,
        },
      ];
    }),
  };
}

/**
 * Splits a mailbox at its `From ` separator lines. Messages are byte ranges,
 * parsed only when one is opened.
 */
export function splitMbox(bytes: Uint8Array): { start: number; end: number }[] {
  const starts: number[] = [];
  const isFrom = (at: number) =>
    bytes[at] === 0x46 &&
    bytes[at + 1] === 0x72 &&
    bytes[at + 2] === 0x6f &&
    bytes[at + 3] === 0x6d &&
    bytes[at + 4] === 0x20;
  if (isFrom(0)) starts.push(0);
  for (let at = 0; at < bytes.length - 5; at++)
    if (bytes[at] === 0x0a && isFrom(at + 1)) starts.push(at + 1);
  return starts.map((start, index) => {
    // The separator line itself is not part of the message.
    let body = start;
    while (body < bytes.length && bytes[body] !== 0x0a) body++;
    return { start: body + 1, end: starts[index + 1] ?? bytes.length };
  });
}

/** A mailbox message's sender, subject and date, read from its headers. */
export function mboxSummary(bytes: Uint8Array): {
  from?: string;
  subject?: string;
  date?: Date;
} {
  const end = (() => {
    for (let at = 0; at < Math.min(bytes.length, 65536) - 1; at++)
      if (
        bytes[at] === 0x0a &&
        (bytes[at + 1] === 0x0a ||
          (bytes[at + 1] === 0x0d && bytes[at + 2] === 0x0a))
      )
        return at;
    return Math.min(bytes.length, 65536);
  })();
  const head = new TextDecoder()
    .decode(bytes.subarray(0, end))
    .replace(/\r?\n[ \t]+/g, " ");
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, "im").exec(head)?.[1]?.trim();
  return {
    from: decodeWords(field("From") ?? ""),
    subject: decodeWords(field("Subject") ?? ""),
    date: validDate(field("Date")),
  };
}

/** Decodes RFC 2047 encoded words such as `=?UTF-8?B?…?=`. */
export function decodeWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g,
    (match, charset: string, encoding: string, data: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
            : Uint8Array.from(
                data
                  .replace(/_/g, " ")
                  .replace(/=([0-9a-f]{2})/gi, (_hex, code: string) =>
                    String.fromCharCode(Number.parseInt(code, 16)),
                  ),
                (char) => char.charCodeAt(0),
              );
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return match;
      }
    },
  );
}

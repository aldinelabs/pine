import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { formatBytes } from "@/lib/formatBytes";
import { PropertyList } from "./properties";

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const MAX_ENTRIES = 200_000;

/**
 * A ZIP archive's entry count, total uncompressed size, comment and whether
 * entries are encrypted, read from its central directory alone.
 */
export function readZipProperties(
  buffer: ArrayBuffer,
  locale: string,
): PreviewProperty[] {
  const view = new DataView(buffer);
  const length = buffer.byteLength;
  let end = -1;
  for (
    let index = length - 22;
    index >= Math.max(0, length - 22 - 0xffff);
    index--
  )
    if (view.getUint32(index, true) === END_OF_DIRECTORY) {
      end = index;
      break;
    }
  if (end < 0) return [];
  let count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const commentLength = view.getUint16(end + 20, true);
  const comment = new TextDecoder().decode(
    new Uint8Array(
      buffer,
      end + 22,
      Math.min(commentLength, length - end - 22),
    ),
  );
  if (
    (count === 0xffff || offset === 0xffffffff) &&
    end >= 20 &&
    view.getUint32(end - 20, true) === ZIP64_LOCATOR
  ) {
    const record = Number(view.getBigUint64(end - 12, true));
    if (record + 56 <= length && view.getUint32(record, true) === ZIP64_END) {
      count = Number(view.getBigUint64(record + 32, true));
      offset = Number(view.getBigUint64(record + 48, true));
    }
  }
  let files = 0;
  let size = 0;
  let encrypted = false;
  let position = offset;
  for (let entry = 0; entry < Math.min(count, MAX_ENTRIES); entry++) {
    if (
      position + 46 > length ||
      view.getUint32(position, true) !== DIRECTORY_ENTRY
    )
      break;
    const flags = view.getUint16(position + 8, true);
    let uncompressed = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const entryCommentLength = view.getUint16(position + 32, true);
    const nameEnd = position + 46 + nameLength;
    if (uncompressed === 0xffffffff) {
      // The ZIP64 extra field holds the real size first.
      for (let extra = nameEnd; extra + 4 <= nameEnd + extraLength;) {
        const id = view.getUint16(extra, true);
        const size = view.getUint16(extra + 2, true);
        if (id === 1 && extra + 12 <= length) {
          uncompressed = Number(view.getBigUint64(extra + 4, true));
          break;
        }
        extra += 4 + size;
      }
    }
    const directory = nameLength > 0 && view.getUint8(nameEnd - 1) === 0x2f;
    if (!directory) {
      files++;
      size += uncompressed;
      if (flags & 1) encrypted = true;
    }
    position = nameEnd + extraLength + entryCommentLength;
  }
  const list = new PropertyList().number("entries", files);
  if (files) list.text("uncompressedSize", formatBytes(size, locale));
  list.text("comment", comment);
  if (encrypted) list.boolean("encrypted", true);
  return list.items;
}

/**
 * Reads Apple binary property lists (`bplist00`), enough for Safari web
 * archives: dictionaries, arrays, strings, numbers, booleans, dates and data.
 */

export type PlistValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue };

/** Nesting deeper than this is treated as a malformed or hostile file. */
const MAX_DEPTH = 64;

export function parseBplist(buffer: ArrayBuffer): PlistValue {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    bytes.length < 40 ||
    new TextDecoder().decode(bytes.subarray(0, 8)) !== "bplist00"
  )
    throw new Error("Not a binary property list.");
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  const count = Number(view.getBigUint64(trailer + 8));
  const top = Number(view.getBigUint64(trailer + 16));
  const table = Number(view.getBigUint64(trailer + 24));
  if (table + count * offsetSize > trailer || top >= count)
    throw new Error("The property list trailer is invalid.");

  const int = (at: number, size: number): number => {
    let value = 0;
    for (let index = 0; index < size; index++)
      value = value * 256 + bytes[at + index];
    return value;
  };
  const offset = (ref: number): number => {
    if (ref >= count) throw new Error("The property list has a bad reference.");
    return int(table + ref * offsetSize, offsetSize);
  };

  function length(at: number, marker: number): [number, number] {
    const low = marker & 0x0f;
    if (low !== 0x0f) return [low, at + 1];
    const sizeMarker = bytes[at + 1];
    const size = 1 << (sizeMarker & 0x0f);
    return [int(at + 2, size), at + 2 + size];
  }

  function read(ref: number, depth: number): PlistValue {
    if (depth > MAX_DEPTH)
      throw new Error("The property list nests too deeply.");
    const at = offset(ref);
    const marker = bytes[at];
    const type = marker >> 4;
    switch (type) {
      case 0x0:
        return marker === 0x09 ? true : marker === 0x08 ? false : null;
      case 0x1: {
        const size = 1 << (marker & 0x0f);
        if (size === 8) return view.getBigInt64(at + 1);
        return int(at + 1, size);
      }
      case 0x2:
        return (marker & 0x0f) === 2
          ? view.getFloat32(at + 1)
          : view.getFloat64(at + 1);
      case 0x3:
        // Seconds since 2001-01-01.
        return new Date((978307200 + view.getFloat64(at + 1)) * 1000);
      case 0x4: {
        const [size, start] = length(at, marker);
        return bytes.slice(start, start + size);
      }
      case 0x5: {
        const [size, start] = length(at, marker);
        return new TextDecoder("latin1").decode(
          bytes.subarray(start, start + size),
        );
      }
      case 0x6: {
        const [size, start] = length(at, marker);
        return new TextDecoder("utf-16be").decode(
          bytes.subarray(start, start + size * 2),
        );
      }
      case 0xa: {
        const [size, start] = length(at, marker);
        return Array.from({ length: size }, (_, index) =>
          read(int(start + index * refSize, refSize), depth + 1),
        );
      }
      case 0xd: {
        const [size, start] = length(at, marker);
        const result: { [key: string]: PlistValue } = {};
        for (let index = 0; index < size; index++) {
          const key = read(int(start + index * refSize, refSize), depth + 1);
          if (typeof key !== "string")
            throw new Error("The property list has a non-string key.");
          result[key] = read(
            int(start + (size + index) * refSize, refSize),
            depth + 1,
          );
        }
        return result;
      }
      default:
        throw new Error(
          `The property list has an unknown object type ${type}.`,
        );
    }
  }

  return read(top, 0);
}

export interface WebResource {
  url?: string;
  mimeType?: string;
  encoding?: string;
  data: Uint8Array;
}

export interface WebArchive {
  main: WebResource;
  subresources: WebResource[];
}

function resource(value: PlistValue | undefined): WebResource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  if (value instanceof Uint8Array || value instanceof Date) return undefined;
  const data = value.WebResourceData;
  if (!(data instanceof Uint8Array)) return undefined;
  const text = (key: string) =>
    typeof value[key] === "string" ? value[key] : undefined;
  return {
    data,
    url: text("WebResourceURL"),
    mimeType: text("WebResourceMIMEType"),
    encoding: text("WebResourceTextEncodingName"),
  };
}

/** Reads a Safari `.webarchive`: the page and the resources it saved. */
export function readWebArchive(buffer: ArrayBuffer): WebArchive {
  const root = parseBplist(buffer);
  if (!root || typeof root !== "object" || Array.isArray(root))
    throw new Error("The web archive has no page.");
  const record = root as { [key: string]: PlistValue };
  const main = resource(record.WebMainResource);
  if (!main) throw new Error("The web archive has no page.");
  const subresources = Array.isArray(record.WebSubresources)
    ? record.WebSubresources.flatMap((item) => resource(item) ?? [])
    : [];
  return { main, subresources };
}

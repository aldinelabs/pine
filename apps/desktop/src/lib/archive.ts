/**
 * Reads archives with libarchive in a worker: ZIP, 7z, RAR, TAR and its
 * compressed forms, ISO, CAB, CPIO, XAR and more. Entries are extracted on
 * demand and kept in memory only; nothing an archive holds is written to
 * disk or browser storage.
 */
import type { ArchiveReader } from "libarchive.js/dist/build/compiled/archive-reader";

export interface ArchiveEntry {
  path: string;
  size: number;
  lastModified?: number;
}

export interface OpenedArchive {
  entries: ArchiveEntry[];
  extract: (path: string) => Promise<ArrayBuffer>;
  close: () => Promise<void>;
}

export class ArchivePasswordError extends Error {
  constructor(readonly wrongPassword: boolean) {
    super(
      wrongPassword ? "The password is wrong." : "The archive is encrypted.",
    );
  }
}

/** The worker and its WebAssembly are published with file-viewer's assets. */
function workerUrl(): string {
  return new URL(
    "file-viewer/vendor/libarchive/worker-bundle.js",
    document.baseURI,
  ).href;
}

/**
 * Old ZIP tools on Chinese Windows wrote file names in GBK without the
 * UTF-8 flag. Their names are not valid UTF-8, which this detects.
 */
export function hasLegacyZipNames(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  // Local file headers are enough; scan the first few hundred.
  let offset = 0;
  for (let index = 0; index < 500 && offset + 30 <= bytes.length; index++) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength);
    if (!(flags & 0x0800) && name.some((byte) => byte > 0x7f)) {
      try {
        utf8.decode(name);
      } catch {
        return true;
      }
    }
    // Sizes after the data (bit 3) are unknown here; stop scanning.
    if (flags & 0x0008) break;
    offset += 30 + nameLength + extraLength + compressed;
  }
  return false;
}

interface FileEntry {
  file: {
    name: string;
    size: number;
    lastModified?: number;
    extract: () => Promise<File>;
  };
  path: string;
}

/** Single-file gzip (not a tarball): libarchive reads only real archives. */
async function openGzip(
  buffer: ArrayBuffer,
  name: string,
): Promise<OpenedArchive> {
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const data = await new Response(stream).arrayBuffer();
  const path = name.replace(/\.(gz|gzip)$/i, "") || "data";
  return {
    entries: [{ path, size: data.byteLength }],
    extract: () => Promise.resolve(data.slice(0)),
    close: () => Promise.resolve(),
  };
}

export async function openArchive(
  buffer: ArrayBuffer,
  name: string,
  password?: string,
): Promise<OpenedArchive> {
  const { Archive } = await import("libarchive.js");
  const workers: Worker[] = [];
  Archive.init({
    getWorker: () => {
      const worker = new Worker(workerUrl(), { type: "module" });
      workers.push(worker);
      return worker;
    },
  });
  let reader: ArchiveReader | undefined;
  const terminate = () => {
    for (const worker of workers) worker.terminate();
  };
  try {
    reader = await Archive.open(new File([buffer], name));
    if (hasLegacyZipNames(new Uint8Array(buffer)))
      await reader.setLocale("zh_CN.GBK").catch(() => undefined);
    if (await reader.hasEncryptedData()) {
      if (!password) throw new ArchivePasswordError(false);
      await reader.usePassword(password);
    }
    let files: FileEntry[];
    try {
      files = (await reader.getFilesArray()) as FileEntry[];
    } catch (error) {
      if (password) throw new ArchivePasswordError(true);
      throw error;
    }
    const byPath = new Map(
      files.map((entry) => [`${entry.path}${entry.file.name ?? ""}`, entry]),
    );
    const opened = reader;
    return {
      entries: [...byPath].map(([path, entry]) => ({
        path,
        size: entry.file.size,
        lastModified: entry.file.lastModified,
      })),
      async extract(path) {
        const entry = byPath.get(path);
        if (!entry) throw new Error(`The archive has no ${path}.`);
        try {
          return await (await entry.file.extract()).arrayBuffer();
        } catch (error) {
          if (password) throw new ArchivePasswordError(true);
          throw error;
        }
      },
      async close() {
        await opened.close().catch(() => undefined);
        terminate();
      },
    };
  } catch (error) {
    await reader?.close().catch(() => undefined);
    terminate();
    if (
      !(error instanceof ArchivePasswordError) &&
      /\.(gz|gzip)$/i.test(name) &&
      !/\.tar\.\w+$/i.test(name)
    )
      return openGzip(buffer, name);
    throw error;
  }
}

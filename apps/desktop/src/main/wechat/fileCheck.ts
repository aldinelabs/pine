// The checks a file passes before it is sent to WeChat: the recorded path
// must still be itself, a regular file, and fit the size cap.

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { FILE_MAX_BYTES } from "./constants";

export type FileCheck =
  | { kind: "ok"; path: string; size: number }
  | { kind: "gone" }
  | { kind: "changed" }
  | { kind: "size"; size: number };

/**
 * The pattern of `reopenPresentedToolFile`: the recorded path must still
 * resolve to itself (no symlink swapped in), be a regular file and fit the cap.
 */
export async function checkFile(recorded: string): Promise<FileCheck> {
  const expected = path.resolve(recorded);
  const canonical = await realpath(expected).catch(() => null);
  if (canonical === null) return { kind: "gone" };
  if (canonical !== expected) return { kind: "changed" };
  const info = await stat(canonical).catch(() => null);
  if (!info?.isFile()) return { kind: "changed" };
  if (info.size > FILE_MAX_BYTES) return { kind: "size", size: info.size };
  return { kind: "ok", path: canonical, size: info.size };
}

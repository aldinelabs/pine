import { homedir } from "node:os";
import path from "node:path";

/** Expands a leading `~/` (or `~\` on Windows) to the user's home folder. */
export function expandHomePath(filePath: string, home = homedir()): string {
  return /^~(?:[\\/]|$)/u.test(filePath)
    ? path.join(home, filePath.slice(1))
    : filePath;
}

import path from "node:path";

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** Where a project's sessions for one working directory are stored. */
export function projectSessionDirectory(
  sessionsRoot: string,
  cwd: string,
): string {
  return path.join(sessionsRoot, encodeCwd(cwd));
}

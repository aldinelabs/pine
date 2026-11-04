/** The parts of a stored session entry that date the conversation. */
export interface SessionActivityEntry {
  type: string;
  timestamp: string;
  message?: { role?: string; timestamp?: unknown };
}

/**
 * When the conversation last moved: its latest user or assistant message.
 * Tool results and bookkeeping entries don't count, so opening a session or
 * finishing its tools never reorders the session list. The list index and
 * the summary a live session reports both use this.
 */
export function sessionActivityAt(
  entries: readonly SessionActivityEntry[],
  createdAt: number,
  fallbackMs: number,
): string {
  let latest = Number.isNaN(createdAt) ? fallbackMs : createdAt;
  for (const entry of entries) {
    const role = entry.message?.role;
    if (entry.type !== "message" || (role !== "user" && role !== "assistant"))
      continue;
    const stamp = entry.message?.timestamp;
    const timestamp =
      typeof stamp === "number" ? stamp : Date.parse(entry.timestamp);
    if (!Number.isNaN(timestamp)) latest = Math.max(latest, timestamp);
  }
  return new Date(latest).toISOString();
}

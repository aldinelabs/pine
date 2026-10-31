/**
 * Context that can change during a session reaches the model as conversation
 * messages instead of system prompt sections. Most providers fold a changed
 * section back into the leading system prompt, which invalidates the cached
 * prefix; a message appended after the history leaves it intact.
 */

/** Custom message type carrying changed context to the model. */
export const PINE_CONTEXT_NOTICE = "pine.context-notice";

/** Notice names, in the order a combined notice lists them. */
export const PINE_CONTEXT_NOTICE_KEYS = [
  "user_profile",
  "interface_elements",
  "skills",
  "network_region",
  "approximate_location",
] as const;

export type PineContextNoticeKey = (typeof PINE_CONTEXT_NOTICE_KEYS)[number];

/** Desired content per notice; undefined means the notice does not apply. */
export type PineContextNoticeState = Partial<
  Record<PineContextNoticeKey, string>
>;

/** What one message announces; null withdraws an earlier notice. */
export type PineContextNoticeChanges = Partial<
  Record<PineContextNoticeKey, string | null>
>;

function isNoticeKey(value: string): value is PineContextNoticeKey {
  return PINE_CONTEXT_NOTICE_KEYS.some((key) => key === value);
}

function changesOf(message: unknown): PineContextNoticeChanges | undefined {
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return undefined;
  const record = message as Record<string, unknown>;
  if (record.role !== "custom" || record.customType !== PINE_CONTEXT_NOTICE)
    return undefined;
  const details = record.details;
  if (typeof details !== "object" || details === null) return undefined;
  const notices = (details as { notices?: unknown }).notices;
  if (typeof notices !== "object" || notices === null) return undefined;
  const changes: PineContextNoticeChanges = {};
  for (const [key, value] of Object.entries(notices)) {
    if (isNoticeKey(key) && (typeof value === "string" || value === null))
      changes[key] = value;
  }
  return changes;
}

/**
 * The notices the model currently has, replayed from the messages that
 * survive in its context (a compaction past a notice drops it).
 */
export function announcedContextNotices(
  messages: readonly unknown[],
): PineContextNoticeState {
  const state: PineContextNoticeState = {};
  for (const message of messages) {
    const changes = changesOf(message);
    if (!changes) continue;
    for (const key of PINE_CONTEXT_NOTICE_KEYS) {
      if (!(key in changes)) continue;
      const value = changes[key];
      if (value === null || value === undefined) delete state[key];
      else state[key] = value;
    }
  }
  return state;
}

/** What to announce so the model's notices match `desired`, if anything. */
export function contextNoticeChanges(
  messages: readonly unknown[],
  desired: PineContextNoticeState,
): PineContextNoticeChanges | undefined {
  const announced = announcedContextNotices(messages);
  const changes: PineContextNoticeChanges = {};
  for (const key of PINE_CONTEXT_NOTICE_KEYS) {
    if (announced[key] === desired[key]) continue;
    changes[key] = desired[key] ?? null;
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

export function renderContextNotice(changes: PineContextNoticeChanges): string {
  const sections = PINE_CONTEXT_NOTICE_KEYS.flatMap((key) => {
    if (!(key in changes)) return [];
    const content =
      changes[key] ??
      "This context no longer applies; disregard earlier versions.";
    return [`<${key}>\n${content}\n</${key}>`];
  });
  return `Pine context notice. Each section below replaces the earlier section of the same name; sections not listed are unchanged.\n\n${sections.join("\n\n")}`;
}

/** The message `before_agent_start` returns, or undefined when nothing changed. */
export function contextNoticeMessage(
  messages: readonly unknown[],
  desired: PineContextNoticeState,
):
  | {
      customType: typeof PINE_CONTEXT_NOTICE;
      content: string;
      display: false;
      details: { notices: PineContextNoticeChanges };
    }
  | undefined {
  const changes = contextNoticeChanges(messages, desired);
  if (!changes) return undefined;
  return {
    customType: PINE_CONTEXT_NOTICE,
    content: renderContextNotice(changes),
    display: false,
    details: { notices: changes },
  };
}

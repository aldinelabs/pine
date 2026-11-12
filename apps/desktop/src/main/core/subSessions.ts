import type { PineProject } from "../../shared/projects";
import type {
  PineContentBlock,
  PineSessionNotice,
  PineTextMessage,
} from "../../shared/sessions";
import type { PineCore } from "./pineCore";

/**
 * Sub-sessions: sessions another session started to work for it, one level
 * deep. The project file links each to its parent; the parent hears when a
 * sub-session finishes a turn or stops on an approval.
 */

export function parentOf(
  project: Pick<PineProject, "sessionParents">,
  sessionId: string,
): string | undefined {
  return project.sessionParents?.[sessionId];
}

export function childrenOf(
  project: Pick<PineProject, "sessionParents">,
  sessionId: string,
): string[] {
  return Object.entries(project.sessionParents ?? {})
    .filter(([, parent]) => parent === sessionId)
    .map(([child]) => child);
}

/** The parent, sub-sessions and siblings a session may read and message. */
export function relativesOf(
  project: Pick<PineProject, "sessionParents">,
  sessionId: string,
): { parent?: string; children: string[]; siblings: string[] } {
  const parent = parentOf(project, sessionId);
  return {
    ...(parent ? { parent } : {}),
    children: childrenOf(project, sessionId),
    siblings: parent
      ? childrenOf(project, parent).filter((id) => id !== sessionId)
      : [],
  };
}

export function isRelative(
  project: Pick<PineProject, "sessionParents">,
  sessionId: string,
  otherId: string,
): boolean {
  const { parent, children, siblings } = relativesOf(project, sessionId);
  return (
    parent === otherId ||
    children.includes(otherId) ||
    siblings.includes(otherId)
  );
}

const MAX_REPLY_LENGTH = 4_000;

/** A message as plain text: its words, with tool calls named in brackets. */
export function messageText(blocks: readonly PineContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "toolCall":
          return `[tool ${block.toolCall.name}]`;
        case "sessionNotice":
          return `[sub-session ${block.notice.title ?? block.notice.sessionId}: ${block.notice.state}]`;
        case "backgroundTask":
          return `[background task ${block.task.name}: ${block.task.status}]`;
        case "error":
          return `[error: ${block.error.message}]`;
        case "stopped":
          return "[stopped]";
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function lastReply(messages: readonly PineTextMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = messageText(
      message.blocks.filter((block) => block.type === "text"),
    );
    if (!text) continue;
    return text.length > MAX_REPLY_LENGTH
      ? `${text.slice(0, MAX_REPLY_LENGTH)}…`
      : text;
  }
  return "";
}

/** What the parent's model reads about its sub-session. */
export function noticeContent(
  notice: PineSessionNotice,
  reply: string,
): string {
  const guidance =
    notice.state === "awaiting-approval"
      ? "It is waiting for the user to approve a tool call in its own tab and does nothing until then. Tell the user if they need to act."
      : "Use ui_session_read for more of its messages or ui_session_send to give it follow-up work. Do not poll it; Pine reports each turn it finishes.";
  return [
    "<sub-session-notification>",
    `  <session-id>${notice.sessionId}</session-id>`,
    notice.title ? `  <title>${escapeXml(notice.title)}</title>` : "",
    `  <status>${notice.state}</status>`,
    reply ? `  <last-reply>${escapeXml(reply)}</last-reply>` : "",
    `  <guidance>${guidance}</guidance>`,
    "</sub-session-notification>",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Tells a sub-session's parent what it is doing now. A parent no window has
 * open is resumed in the background, so it can carry on unattended.
 */
export async function notifyParentOf(
  core: PineCore,
  sessionId: string,
  state: PineSessionNotice["state"],
): Promise<void> {
  const { repository, runtimes } = core;
  const live = runtimes.projectOfLiveSession(sessionId);
  if (!live) return;
  const project = await repository.get(live.id);
  const parentId = parentOf(project, sessionId);
  if (!parentId) return;
  const owner =
    runtimes.ownerOfProject(project.id) ??
    runtimes.controllerOfSession(sessionId);
  if (owner === undefined) return;
  const page = await runtimes.loadMessages(
    owner,
    project.id,
    sessionId,
    undefined,
    10,
  );
  const title = runtimes.summaryOfLiveSession(sessionId)?.name;
  const notice: PineSessionNotice = {
    sessionId,
    projectId: project.id,
    state,
    ...(title ? { title } : {}),
  };
  if (!runtimes.liveSessionIdsOf(project.id).includes(parentId))
    await runtimes.resume(owner, project.id, parentId, { focus: false });
  await core.agentHost.notifySession(
    parentId,
    notice,
    noticeContent(
      notice,
      state === "awaiting-approval" ? "" : lastReply(page.messages),
    ),
  );
}

/** Deletes a session, and with it its sub-sessions; unlinks them all. */
export async function deleteSessionWithChildren(
  core: PineCore,
  owner: number,
  project: PineProject,
  sessionId: string,
): Promise<boolean> {
  const { repository, runtimes } = core;
  const children = childrenOf(project, sessionId);
  for (const child of children)
    await runtimes.deleteSession(owner, project.id, child).catch(() => false);
  const deleted = await runtimes.deleteSession(owner, project.id, sessionId);
  const gone = new Set([sessionId, ...children]);
  if (
    Object.entries(project.sessionParents ?? {}).some(
      ([child, parent]) => gone.has(child) || gone.has(parent),
    )
  ) {
    await repository.updateSessionParents(project.id, (parents) =>
      Object.fromEntries(
        Object.entries(parents).filter(
          ([child, parent]) => !gone.has(child) && !gone.has(parent),
        ),
      ),
    );
    core.notifyLibraryChanged("projects");
  }
  return deleted;
}

/** Drops a session's links when it leaves its project; its sub-sessions become top-level. */
export async function unlinkSession(
  core: PineCore,
  projectId: string,
  sessionId: string,
): Promise<void> {
  const project = await core.repository.get(projectId);
  const parents = project.sessionParents ?? {};
  if (
    !Object.entries(parents).some(
      ([child, parent]) => child === sessionId || parent === sessionId,
    )
  )
    return;
  await core.repository.updateSessionParents(projectId, (current) =>
    Object.fromEntries(
      Object.entries(current).filter(
        ([child, parent]) => child !== sessionId && parent !== sessionId,
      ),
    ),
  );
  core.notifyLibraryChanged("projects");
}

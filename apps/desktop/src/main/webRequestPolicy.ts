import { realpath } from "node:fs/promises";
import { z } from "zod";
import * as agent from "../shared/agent";
import * as sessions from "../shared/sessions";
import * as projects from "../shared/projects";
import * as files from "../shared/projectFiles";
import * as models from "../shared/models";
import * as preferences from "../shared/preferences";
import * as skills from "../shared/skills";
import * as mcp from "../shared/mcp";
import * as background from "../shared/backgroundTasks";
import * as attachments from "../shared/attachments";
import * as sideChats from "../shared/sideChats";
import { GET_EXCHANGE_RATES_CHANNEL } from "../shared/currency";
import { GET_APP_VERSION_CHANNEL } from "../shared/window";
import {
  GET_USER_PROFILE_CHANNEL,
  SET_USER_PROFILE_CHANNEL,
} from "../shared/userProfile";
import {
  GET_APPROXIMATE_LOCATION_CHANNEL,
  SET_APPROXIMATE_LOCATION_CHANNEL,
} from "../shared/approximateLocation";
import {
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  SET_TINYFISH_API_KEY_CHANNEL,
} from "../shared/tinyfish";
import { WORKBENCH_STATE_RESPONSE_CHANNEL } from "../shared/workbench";
import {
  SetWatchedFilePreviewRequestSchema,
  SetWatchedProjectDirectoriesRequestSchema,
} from "./fileSubscriptionSchemas";

/** Which projects a request touches, so the browser holds them before it runs. */
type Scope =
  | "none"
  | "project"
  | "optional-project"
  | "project-id"
  | "session"
  | "optional-session"
  | "interaction"
  | "target"
  | "entries"
  | "directories"
  | "preview";

export interface WebChannel {
  scope: Scope;
  /** Safe to run again after a lost response, so it needs no receipt. */
  repeatable: boolean;
  /** Checks or rewrites a request before the shared handler runs. */
  prepare?(request: unknown): Promise<unknown>;
  /** Replaces the shared handler where the browser's semantics differ. */
  handle?(request: unknown, clientId: string): Promise<unknown>;
}

/** Host capabilities the browser adapters need; supplied by WebApplication. */
export interface WebChannelServices {
  allowAttachment(path: string): boolean | Promise<boolean>;
  /** Grants a presented file outside the project, or throws. */
  authorizePresented(request: unknown): Promise<unknown>;
  watchDirectories(
    clientId: string,
    request: z.infer<typeof SetWatchedProjectDirectoriesRequestSchema>,
  ): Promise<unknown>;
  watchPreview(
    clientId: string,
    request: z.infer<typeof SetWatchedFilePreviewRequestSchema>,
  ): Promise<unknown>;
  respondWorkbench(request: unknown): void;
  exportSession(projectId: string, sessionId: string): Promise<unknown>;
}

export interface ResourceLookup {
  sessionProject(sessionId: string): string | undefined;
  interactionProject(requestId: string): string | undefined;
}

const query = (scope: Scope): WebChannel => ({ scope, repeatable: true });
const command = (
  scope: Scope,
  adapter: Pick<WebChannel, "prepare" | "handle"> = {},
): WebChannel => ({ scope, repeatable: false, ...adapter });

/** Operations the browser performs itself, such as downloads and clipboard. */
const BROWSER_FILE_ACTIONS = new Set([
  "open",
  "reveal",
  "copy-path",
  "move-external",
]);

/**
 * Every channel the browser may call, and how. New IPC handlers stay private
 * until listed here; UI visibility is not an authorization boundary.
 */
export function createWebChannels(
  services: WebChannelServices,
): ReadonlyMap<string, WebChannel> {
  async function requireSharedAttachments(paths: string[]): Promise<void> {
    for (const file of paths)
      if (!(await services.allowAttachment(await realpath(file))))
        throw new Error("This attachment has not been shared with Pine.");
  }

  return new Map<string, WebChannel>([
    [GET_APP_VERSION_CHANNEL, query("none")],
    [GET_EXCHANGE_RATES_CHANNEL, query("none")],
    [GET_USER_PROFILE_CHANNEL, query("none")],
    [SET_USER_PROFILE_CHANNEL, command("none")],
    [GET_APPROXIMATE_LOCATION_CHANNEL, query("none")],
    [SET_APPROXIMATE_LOCATION_CHANNEL, command("none")],
    [GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL, query("none")],
    [SET_TINYFISH_API_KEY_CHANNEL, command("none")],

    [projects.LIST_PROJECTS_CHANNEL, query("none")],
    [projects.CREATE_PROJECT_CHANNEL, command("none")],
    [projects.PROJECT_STORAGE_CHANNEL, query("none")],
    [projects.OPEN_PROJECT_CHANNEL, command("project-id")],
    [
      projects.CLOSE_PROJECT_CHANNEL,
      // Closing a browser tab detaches its UI; execution lives until stopped.
      command("project-id", { handle: () => Promise.resolve(undefined) }),
    ],
    [projects.UPDATE_PROJECT_CHANNEL, command("project-id")],
    [projects.UPDATE_PROJECT_SESSION_GROUPS_CHANNEL, command("project-id")],
    [projects.DELETE_PROJECT_CHANNEL, command("project-id")],
    [projects.CLEAR_PROJECT_STORAGE_CHANNEL, command("project-id")],

    [sessions.LIST_ALL_RECENT_SESSIONS_CHANNEL, query("none")],
    [sessions.SEARCH_ALL_SESSIONS_CHANNEL, query("none")],
    [sessions.SEARCH_SESSIONS_CHANNEL, query("project")],
    [sessions.LOAD_SESSION_MESSAGES_CHANNEL, query("project")],
    [sessions.ATTACH_SESSION_CHANNEL, command("project")],
    [sessions.RESUME_SESSION_CHANNEL, command("project")],
    [sessions.DELETE_SESSION_CHANNEL, command("project")],
    [sessions.RENAME_SESSION_CHANNEL, command("project")],
    [
      sessions.EXPORT_SESSION_CHANNEL,
      {
        ...query("project"),
        // The browser downloads the document instead of a native save dialog.
        handle: (request) => {
          const input = z
            .object({ projectId: z.uuid(), sessionId: z.uuid() })
            .parse(request);
          return services.exportSession(input.projectId, input.sessionId);
        },
      },
    ],

    [
      agent.PROMPT_SESSION_CHANNEL,
      command("target", {
        // A browser cannot turn a hand-written host path into a read grant.
        prepare: async (request) => {
          const { message } = z.object({ message: z.string() }).parse(request);
          await requireSharedAttachments(
            attachments.attachmentFilePaths(
              attachments.parseAttachmentMessage(message).attachments,
            ),
          );
          return request;
        },
      }),
    ],
    [agent.ABORT_SESSION_CHANNEL, command("session")],
    [sideChats.LIST_SIDE_CHATS_CHANNEL, query("project")],
    [sideChats.OPEN_SIDE_CHAT_CHANNEL, command("project")],
    [sideChats.PROMPT_SIDE_CHAT_CHANNEL, command("project")],
    [sideChats.ABORT_SIDE_CHAT_CHANNEL, command("project")],
    [sideChats.CLOSE_SIDE_CHAT_CHANNEL, command("project")],
    [sideChats.DELETE_SIDE_CHAT_CHANNEL, command("project")],
    [agent.COMPACT_SESSION_CHANNEL, command("session")],
    [agent.DEQUEUE_STEERING_CHANNEL, command("session")],
    [agent.SEND_STEERING_NOW_CHANNEL, command("session")],
    [agent.SET_APPROVAL_MODE_CHANNEL, command("session")],
    [agent.APPROVAL_RESPONSE_CHANNEL, command("interaction")],
    [agent.QUESTIONNAIRE_RESPONSE_CHANNEL, command("interaction")],
    [
      WORKBENCH_STATE_RESPONSE_CHANNEL,
      {
        ...query("none"),
        handle: (request) => {
          services.respondWorkbench(request);
          return Promise.resolve(undefined);
        },
      },
    ],

    [background.LIST_BACKGROUND_TASKS_CHANNEL, query("session")],
    [background.READ_BACKGROUND_TASK_OUTPUT_CHANNEL, query("session")],
    [background.STOP_BACKGROUND_TASK_CHANNEL, command("session")],

    [models.GET_MODEL_CATALOG_CHANNEL, query("none")],
    [models.REFRESH_MODEL_CATALOG_CHANNEL, query("none")],
    [models.LOOKUP_MODEL_METADATA_CHANNEL, query("none")],
    [models.SELECT_MODEL_CHANNEL, command("optional-session")],
    [models.SELECT_IMAGE_MODEL_CHANNEL, command("none")],
    [models.SELECT_VIDEO_MODEL_CHANNEL, command("none")],
    [models.SELECT_UTILITY_MODEL_CHANNEL, command("none")],
    [models.SELECT_APPROVAL_MODEL_CHANNEL, command("none")],
    [models.ADD_CUSTOM_MODEL_CHANNEL, command("none")],
    [models.UPDATE_CUSTOM_MODEL_CHANNEL, command("none")],
    [models.DELETE_CUSTOM_MODEL_CHANNEL, command("none")],
    [models.UPDATE_CUSTOM_PROVIDER_CHANNEL, command("none")],
    [models.DELETE_CUSTOM_PROVIDER_CHANNEL, command("none")],
    [models.LOGIN_PROVIDER_CHANNEL, command("none")],
    [models.RESPOND_PROVIDER_AUTH_CHANNEL, command("none")],
    [models.CANCEL_PROVIDER_AUTH_CHANNEL, command("none")],
    [models.LOGOUT_PROVIDER_CHANNEL, command("none")],

    [preferences.GET_AUTO_APPROVAL_SETTINGS_CHANNEL, query("none")],
    [preferences.SET_AUTO_APPROVAL_SETTINGS_CHANNEL, command("none")],
    [preferences.GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL, query("none")],
    [preferences.SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL, command("none")],
    [preferences.GET_CONTEXT_COMPACTION_ROUTE_CHANNEL, query("none")],
    [preferences.SET_CONTEXT_COMPACTION_ROUTE_CHANNEL, command("none")],
    [preferences.GET_COMPLETION_SIGNAL_CHANNEL, query("none")],
    [preferences.SET_COMPLETION_SIGNAL_CHANNEL, command("none")],
    [preferences.GET_ATTENTION_NOTIFICATIONS_CHANNEL, query("none")],
    [preferences.SET_ATTENTION_NOTIFICATIONS_CHANNEL, command("none")],
    [preferences.GET_DIAGNOSTIC_LOGGING_CHANNEL, query("none")],
    [preferences.SET_DIAGNOSTIC_LOGGING_CHANNEL, command("none")],

    [skills.LIST_SKILLS_CHANNEL, query("optional-project")],
    [skills.READ_SKILL_CHANNEL, query("optional-project")],
    [skills.CREATE_SKILL_CHANNEL, command("optional-project")],
    [skills.EDIT_SKILL_CHANNEL, command("optional-project")],
    [skills.REMOVE_SKILL_CHANNEL, command("optional-project")],
    [skills.SET_GLOBAL_SKILL_ENABLED_CHANNEL, command("project")],

    [mcp.LIST_MCP_SERVERS_CHANNEL, query("project")],
    [mcp.SAVE_MCP_SERVER_CHANNEL, command("project")],
    [mcp.REMOVE_MCP_SERVER_CHANNEL, command("project")],

    [
      attachments.INSPECT_ATTACHMENTS_CHANNEL,
      command("none", {
        prepare: async (request) => {
          const { paths } = z
            .object({ paths: z.array(z.string()).max(100) })
            .parse(request);
          await requireSharedAttachments(paths);
          return request;
        },
      }),
    ],
    [attachments.SAVE_PASTED_ATTACHMENT_CHANNEL, command("project")],

    [files.LIST_PROJECT_DIRECTORY_CHANNEL, query("project")],
    [files.READ_PROJECT_FILE_PREVIEW_CHANNEL, query("project")],
    [
      files.READ_PRESENTED_FILE_PREVIEW_CHANNEL,
      {
        ...query("none"),
        prepare: async (request) => {
          await services.authorizePresented(request);
          return request;
        },
      },
    ],
    [files.REOPEN_PRESENTED_TOOL_FILE_CHANNEL, command("project")],
    [files.PROJECT_FILE_ATTACHMENTS_CHANNEL, command("entries")],
    [
      files.PROJECT_FILE_OPERATION_CHANNEL,
      command("target", {
        prepare: (request) => {
          const { action } = z.object({ action: z.string() }).parse(request);
          return BROWSER_FILE_ACTIONS.has(action)
            ? Promise.reject(new Error("This action belongs to the browser."))
            : Promise.resolve(request);
        },
      }),
    ],
    [
      files.SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
      {
        ...query("directories"),
        // Each browser tab keeps its own watch set over one shared watcher.
        handle: (request, clientId) =>
          services.watchDirectories(
            clientId,
            SetWatchedProjectDirectoriesRequestSchema.parse(request),
          ),
      },
    ],
    [
      files.SET_WATCHED_FILE_PREVIEW_CHANNEL,
      {
        ...query("preview"),
        handle: async (request, clientId) => {
          const parsed = SetWatchedFilePreviewRequestSchema.parse(request);
          if (parsed.target?.source === "presented")
            await services.authorizePresented(parsed.target);
          return services.watchPreview(clientId, parsed);
        },
      },
    ],
  ]);
}

export function webChannel(
  channels: ReadonlyMap<string, WebChannel>,
  name: string,
): WebChannel {
  const channel = channels.get(name);
  if (!channel)
    throw new Error("This operation is unavailable in the browser.");
  return channel;
}

const project = z.object({ projectId: z.uuid() });

export function webRequestProjects(
  channel: WebChannel,
  request: unknown,
  lookup: ResourceLookup,
): string[] {
  switch (channel.scope) {
    case "none":
      return [];
    case "project":
      return [project.parse(request).projectId];
    case "optional-project": {
      const input = z.object({ projectId: z.uuid().optional() }).parse(request);
      return input.projectId ? [input.projectId] : [];
    }
    case "project-id":
      return [z.object({ id: z.uuid() }).parse(request).id];
    case "target":
      return [z.object({ target: project }).parse(request).target.projectId];
    case "entries":
      return [
        ...new Set(
          z
            .array(project)
            .max(100)
            .parse(request)
            .map((entry) => entry.projectId),
        ),
      ];
    case "directories":
      return [
        ...new Set(
          z
            .object({ folders: z.array(project).max(64) })
            .parse(request)
            .folders.map((entry) => entry.projectId),
        ),
      ];
    case "preview": {
      const input = z
        .object({
          target: z
            .union([project, z.object({ source: z.literal("presented") })])
            .nullable(),
        })
        .parse(request);
      return input.target && "projectId" in input.target
        ? [input.target.projectId]
        : [];
    }
    case "session":
    case "optional-session": {
      const input = z.object({ sessionId: z.uuid().optional() }).parse(request);
      if (!input.sessionId && channel.scope === "optional-session") return [];
      const projectId =
        input.sessionId && lookup.sessionProject(input.sessionId);
      if (!projectId) throw new Error("The session is no longer running.");
      return [projectId];
    }
    case "interaction": {
      const projectId = lookup.interactionProject(
        z.object({ requestId: z.uuid() }).parse(request).requestId,
      );
      if (!projectId) throw new Error("This request is no longer pending.");
      return [projectId];
    }
  }
}

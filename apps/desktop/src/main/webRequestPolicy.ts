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
const scopes = new Map<string, Scope>();
function allow(scope: Scope, channels: string[]): void {
  for (const channel of channels) scopes.set(channel, scope);
}

// Browser exposure and resource scope are explicit. New IPC handlers remain private
// until added here; UI visibility is not an authorization boundary.
allow("none", [
  GET_APP_VERSION_CHANNEL,
  GET_USER_PROFILE_CHANNEL,
  SET_USER_PROFILE_CHANNEL,
  GET_APPROXIMATE_LOCATION_CHANNEL,
  SET_APPROXIMATE_LOCATION_CHANNEL,
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  SET_TINYFISH_API_KEY_CHANNEL,
  projects.LIST_PROJECTS_CHANNEL,
  projects.CREATE_PROJECT_CHANNEL,
  projects.PROJECT_STORAGE_CHANNEL,
  sessions.LIST_ALL_RECENT_SESSIONS_CHANNEL,
  sessions.SEARCH_ALL_SESSIONS_CHANNEL,
  models.GET_MODEL_CATALOG_CHANNEL,
  models.REFRESH_MODEL_CATALOG_CHANNEL,
  models.LOOKUP_MODEL_METADATA_CHANNEL,
  models.ADD_CUSTOM_MODEL_CHANNEL,
  models.UPDATE_CUSTOM_MODEL_CHANNEL,
  models.DELETE_CUSTOM_MODEL_CHANNEL,
  models.UPDATE_CUSTOM_PROVIDER_CHANNEL,
  models.DELETE_CUSTOM_PROVIDER_CHANNEL,
  models.LOGIN_PROVIDER_CHANNEL,
  models.RESPOND_PROVIDER_AUTH_CHANNEL,
  models.CANCEL_PROVIDER_AUTH_CHANNEL,
  models.LOGOUT_PROVIDER_CHANNEL,
  models.SELECT_IMAGE_MODEL_CHANNEL,
  models.SELECT_UTILITY_MODEL_CHANNEL,
  preferences.GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  preferences.SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  preferences.GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  preferences.SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  preferences.GET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  preferences.SET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  preferences.GET_COMPLETION_SIGNAL_CHANNEL,
  preferences.SET_COMPLETION_SIGNAL_CHANNEL,
  preferences.GET_DIAGNOSTIC_LOGGING_CHANNEL,
  preferences.SET_DIAGNOSTIC_LOGGING_CHANNEL,
  attachments.INSPECT_ATTACHMENTS_CHANNEL,
  files.READ_PRESENTED_FILE_PREVIEW_CHANNEL,
  WORKBENCH_STATE_RESPONSE_CHANNEL,
]);
allow("project", [
  sessions.SEARCH_SESSIONS_CHANNEL,
  sessions.ATTACH_SESSION_CHANNEL,
  sessions.RESUME_SESSION_CHANNEL,
  sessions.DELETE_SESSION_CHANNEL,
  sessions.RENAME_SESSION_CHANNEL,
  sessions.LOAD_SESSION_MESSAGES_CHANNEL,
  sessions.EXPORT_SESSION_CHANNEL,
  mcp.LIST_MCP_SERVERS_CHANNEL,
  mcp.SAVE_MCP_SERVER_CHANNEL,
  mcp.REMOVE_MCP_SERVER_CHANNEL,
  files.READ_PROJECT_FILE_PREVIEW_CHANNEL,
  files.LIST_PROJECT_DIRECTORY_CHANNEL,
  files.REOPEN_PRESENTED_TOOL_FILE_CHANNEL,
  attachments.SAVE_PASTED_ATTACHMENT_CHANNEL,
  skills.SET_GLOBAL_SKILL_ENABLED_CHANNEL,
]);
allow("optional-project", [
  skills.LIST_SKILLS_CHANNEL,
  skills.READ_SKILL_CHANNEL,
  skills.CREATE_SKILL_CHANNEL,
  skills.EDIT_SKILL_CHANNEL,
  skills.REMOVE_SKILL_CHANNEL,
]);
allow("project-id", [
  projects.OPEN_PROJECT_CHANNEL,
  projects.CLOSE_PROJECT_CHANNEL,
  projects.UPDATE_PROJECT_CHANNEL,
  projects.UPDATE_PROJECT_SESSION_GROUPS_CHANNEL,
  projects.DELETE_PROJECT_CHANNEL,
  projects.CLEAR_PROJECT_STORAGE_CHANNEL,
]);
allow("session", [
  agent.ABORT_SESSION_CHANNEL,
  agent.COMPACT_SESSION_CHANNEL,
  agent.DEQUEUE_STEERING_CHANNEL,
  agent.SET_APPROVAL_MODE_CHANNEL,
  background.LIST_BACKGROUND_TASKS_CHANNEL,
  background.STOP_BACKGROUND_TASK_CHANNEL,
  background.READ_BACKGROUND_TASK_OUTPUT_CHANNEL,
]);
allow("optional-session", [models.SELECT_MODEL_CHANNEL]);
allow("interaction", [
  agent.APPROVAL_RESPONSE_CHANNEL,
  agent.QUESTIONNAIRE_RESPONSE_CHANNEL,
]);
allow("target", [
  agent.PROMPT_SESSION_CHANNEL,
  files.PROJECT_FILE_OPERATION_CHANNEL,
]);
allow("entries", [files.PROJECT_FILE_ATTACHMENTS_CHANNEL]);
allow("directories", [files.SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL]);
allow("preview", [files.SET_WATCHED_FILE_PREVIEW_CHANNEL]);

interface ResourceLookup {
  sessionProject(sessionId: string): string | undefined;
  interactionProject(requestId: string): string | undefined;
}
const project = z.object({ projectId: z.uuid() });

const repeatable = new Set<string>([
  GET_APP_VERSION_CHANNEL,
  GET_USER_PROFILE_CHANNEL,
  GET_APPROXIMATE_LOCATION_CHANNEL,
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  projects.LIST_PROJECTS_CHANNEL,
  projects.PROJECT_STORAGE_CHANNEL,
  sessions.LIST_ALL_RECENT_SESSIONS_CHANNEL,
  sessions.SEARCH_ALL_SESSIONS_CHANNEL,
  sessions.SEARCH_SESSIONS_CHANNEL,
  sessions.LOAD_SESSION_MESSAGES_CHANNEL,
  sessions.EXPORT_SESSION_CHANNEL,
  models.GET_MODEL_CATALOG_CHANNEL,
  models.REFRESH_MODEL_CATALOG_CHANNEL,
  models.LOOKUP_MODEL_METADATA_CHANNEL,
  preferences.GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  preferences.GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  preferences.GET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  preferences.GET_COMPLETION_SIGNAL_CHANNEL,
  preferences.GET_DIAGNOSTIC_LOGGING_CHANNEL,
  files.READ_PROJECT_FILE_PREVIEW_CHANNEL,
  files.READ_PRESENTED_FILE_PREVIEW_CHANNEL,
  files.LIST_PROJECT_DIRECTORY_CHANNEL,
  files.SET_WATCHED_FILE_PREVIEW_CHANNEL,
  files.SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  skills.LIST_SKILLS_CHANNEL,
  skills.READ_SKILL_CHANNEL,
  mcp.LIST_MCP_SERVERS_CHANNEL,
  background.LIST_BACKGROUND_TASKS_CHANNEL,
  background.READ_BACKGROUND_TASK_OUTPUT_CHANNEL,
  WORKBENCH_STATE_RESPONSE_CHANNEL,
]);

export function isWebMutation(channel: string): boolean {
  return !repeatable.has(channel);
}

export function webRequestProjects(
  channel: string,
  request: unknown,
  lookup: ResourceLookup,
): string[] {
  const scope = scopes.get(channel);
  if (!scope) throw new Error("This operation is unavailable in the browser.");
  switch (scope) {
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
      if (!input.sessionId && scope === "optional-session") return [];
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

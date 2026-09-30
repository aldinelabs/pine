import type { PineProject } from "@/shared/projects";
import type { ProjectFilePreviewRequest } from "@/shared/projectFiles";
import type { PineToolCall } from "@/shared/sessions";

export type ToolDetailView =
  | "generic"
  | "edit"
  | "search"
  | "fetch"
  | "shell"
  | "file"
  | "questionnaire"
  | "skill"
  | "media"
  | "computer";

export interface ToolViewAdapter {
  detail: ToolDetailView;
  filePath?: string;
}

export interface EditHunk {
  before: string;
  after: string;
}

export interface WebResult {
  title?: string;
  url?: string;
  snippet?: string;
  content?: string;
  metadata: Record<string, unknown>;
}

export interface ToolOutputPart {
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
}

const SKILL_TOOLS = new Set([
  "activate_skill_authoring",
  "invoke_skill",
  "list_skill_resources",
  "read_skill_resource",
  "create_skill",
  "edit_skill",
  "remove_skill",
]);

const COMPUTER_TOOLS = new Set([
  "activate_computer_use",
  "request_computer_use_permissions",
  "install_pine_browser_extension",
  "list_apps",
  "get_app_state",
  "click",
  "type_text",
  "press_key",
  "scroll",
  "activate_app",
  "screenshot",
  "list_displays",
  "right_click",
  "drag",
  "set_value",
  "browser_open_tab",
  "browser_list_tabs",
  "browser_use_tab",
  "browser_release_tab",
  "browser_select_tab",
  "browser_close_tab",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_close_all_tabs",
  "browser_navigate",
  "zoom",
  "hover",
  "wait",
  "select_text",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function firstString(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
  }
}

/** Keep dispatch tied to Pine's first-party names, not similarly named MCP tools. */
export function toolViewAdapter(call: PineToolCall): ToolViewAdapter {
  switch (call.name) {
    case "read":
    case "write":
      return {
        detail: "file",
        filePath:
          call.status === "complete" && call.approval?.state !== "denied"
            ? firstString(record(call.input), ["path"])
            : undefined,
      };
    case "ui_present_file":
      return {
        detail: "file",
        filePath:
          call.status === "complete"
            ? (firstString(record(record(call.output).details), ["path"]) ??
              firstString(record(call.input), ["path"]))
            : undefined,
      };
    case "edit":
      return { detail: editHunks(call.input).length ? "edit" : "file" };
    case "bash":
    case "powershell":
    case "privileged_bash":
    case "privileged_powershell":
      return { detail: "shell" };
    case "ask_user_question":
      return { detail: "questionnaire" };
    case "web_search":
      return { detail: "search" };
    case "web_fetch":
      return { detail: "fetch" };
    case "activate_media_generation":
    case "generate_image":
      return { detail: "media" };
    default:
      return {
        detail: SKILL_TOOLS.has(call.name)
          ? "skill"
          : COMPUTER_TOOLS.has(call.name)
            ? "computer"
            : "generic",
      };
  }
}

/** Extract readable parts without flattening binary image data into the table. */
export function toolOutputParts(output: unknown): ToolOutputPart[] {
  if (typeof output === "string") return [{ type: "text", text: output }];
  const content = Array.isArray(output) ? output : record(output).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): ToolOutputPart[] => {
    const part = record(item);
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }
    if (
      part.type === "image" &&
      typeof part.data === "string" &&
      part.data.length <= 8_000_000 &&
      typeof part.mimeType === "string" &&
      /^image\/(?:png|jpeg|gif|webp)$/u.test(part.mimeType)
    ) {
      return [
        {
          type: "image",
          imageUrl: `data:${part.mimeType};base64,${part.data}`,
        },
      ];
    }
    if (part.type === "image") return [{ type: "image" }];
    return [];
  });
}

export function editHunks(input: unknown): EditHunk[] {
  const edits = record(input).edits;
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((entry): EditHunk[] => {
    const edit = record(entry);
    return typeof edit.oldText === "string" && typeof edit.newText === "string"
      ? [{ before: edit.oldText, after: edit.newText }]
      : [];
  });
}

/** The edit tool supplies replacement hunks, so each hunk is a small diff. */
export function editDiffCode(hunk: EditHunk): string {
  const before = hunk.before.replace(/\r\n?/gu, "\n").split("\n");
  const after = hunk.after.replace(/\r\n?/gu, "\n").split("\n");
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix++;
  }
  return [
    ...before.slice(0, prefix).map((line) => ` ${line}`),
    ...before.slice(prefix, before.length - suffix).map((line) => `-${line}`),
    ...after.slice(prefix, after.length - suffix).map((line) => `+${line}`),
    ...after.slice(after.length - suffix).map((line) => ` ${line}`),
  ].join("\n");
}

/** TinyFish stores its JSON in a text envelope; incomplete output uses the generic view. */
export function webResults(output: unknown): WebResult[] | undefined {
  let value = record(output);
  if (!Array.isArray(value.results)) {
    const content = value.content;
    const text = Array.isArray(content)
      ? content
          .map((item) => record(item).text)
          .find((item) => typeof item === "string")
      : typeof output === "string"
        ? output
        : undefined;
    if (typeof text !== "string") return undefined;
    const startTag = "<tinyfish_web_data>";
    const endTag = "</tinyfish_web_data>";
    const start = text.indexOf(startTag);
    const end = text.indexOf(endTag, start + startTag.length);
    if (start < 0 || end < 0) return undefined;
    try {
      value = record(JSON.parse(text.slice(start + startTag.length, end)));
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(value.results)) return undefined;
  return value.results.map((item) => {
    const result = record(item);
    return {
      title: firstString(result, ["title"]),
      url: firstString(result, ["url"]),
      snippet: firstString(result, ["snippet", "description", "summary"]),
      content: firstString(result, ["text", "markdown", "content"]),
      metadata: Object.fromEntries(
        Object.entries(result).filter(
          ([key]) =>
            !(
              typeof result[key] === "string" &&
              [
                "title",
                "url",
                "snippet",
                "description",
                "summary",
                "text",
                "markdown",
                "content",
              ].includes(key)
            ),
        ),
      ),
    };
  });
}

function normalizedPath(value: string): string | undefined {
  const path = value.replaceAll("\\", "/").replace(/^@/u, "");
  const prefix = path.match(/^(?:[A-Za-z]:\/|\/)/u)?.[0] ?? "";
  const segments: string[] = [];
  for (const segment of path.slice(prefix.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `${prefix}${segments.join("/")}`;
}

export function toolFileRequest(
  filePath: string,
  project: PineProject | null,
): ProjectFilePreviewRequest | undefined {
  if (!project) return undefined;
  const path = normalizedPath(filePath);
  if (!path) return undefined;
  const absolute = path.startsWith("/") || /^[A-Za-z]:\//u.test(path);
  const folders = absolute
    ? [...project.folders].sort((a, b) => b.path.length - a.path.length)
    : project.folders.filter((folder) => folder.id === project.defaultFolderId);
  for (const folder of folders) {
    if (!folder.isAvailable) continue;
    const root = normalizedPath(folder.path);
    if (!root) continue;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    const comparablePath = /^[A-Za-z]:\//u.test(path)
      ? path.toLowerCase()
      : path;
    const comparablePrefix = /^[A-Za-z]:\//u.test(prefix)
      ? prefix.toLowerCase()
      : prefix;
    const relativePath = absolute
      ? comparablePath.startsWith(comparablePrefix)
        ? path.slice(prefix.length)
        : undefined
      : path;
    if (relativePath) {
      return { projectId: project.id, folderId: folder.id, relativePath };
    }
  }
}

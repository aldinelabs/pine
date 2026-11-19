import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineTool,
  type AgentToolResult,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Type, type Static, type TSchema } from "typebox";
import toolSpecs from "@pine/computer-use-runtime/tool-specs.json";
import pineIdentity from "@pine/computer-use-runtime/pine-identity.json";
import type { PineApprovalMode } from "../../shared/agent";
import type { ToolGate } from "../gate";
import COMPUTER_USE_SKILL from "./SKILL.md?raw";
import { ComputerUseMcpClient } from "./mcpClient";

export const ACTIVATE_COMPUTER_USE_TOOL_NAME = "activate_computer_use";
export const REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME =
  "request_computer_use_permissions";
export const INSTALL_PINE_BROWSER_EXTENSION_TOOL_NAME =
  "install_pine_browser_extension";

interface ComputerUseToolSpec {
  name: string;
  description: string;
  inputSchema: TSchema;
}

interface McpToolResult {
  content?: unknown;
  isError?: unknown;
}

export interface ComputerUseControllerOptions {
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  executablePath?: string;
  /** Pine's runtime support directory; defaults to the per-platform location. */
  supportDirectory?: string;
  client?: Pick<ComputerUseMcpClient, "start" | "callTool" | "dispose">;
}

export interface ComputerUseExtensionOptions extends ComputerUseControllerOptions {
  activated(): void;
}

const OBSERVATION_TOOLS = new Set([
  "list_apps",
  "get_app_state",
  "screenshot",
  "zoom",
  "list_displays",
  "browser_list_tabs",
  "browser_snapshot",
  "browser_read",
  "browser_screenshot",
  "browser_page_errors",
  "wait",
]);

/** The vendored Munim Computer Use release; see packages/computer-use-runtime/NOTICE.md. */
export const MUNIM_COMPUTER_USE_VERSION = "0.14.1";

const nativeSpecs = toolSpecs as ComputerUseToolSpec[];
export const MUNIM_COMPUTER_USE_TOOL_NAMES = nativeSpecs.map(
  (tool) => tool.name,
);
export const COMPUTER_USE_DYNAMIC_TOOL_NAMES = [
  REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME,
  INSTALL_PINE_BROWSER_EXTENSION_TOOL_NAME,
  ...MUNIM_COMPUTER_USE_TOOL_NAMES,
] as const;

function defaultBundleRoot(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "pine-computer-use") : "",
    path.resolve(
      process.cwd(),
      "packages/computer-use-runtime/pine-computer-use",
    ),
    path.resolve(
      process.cwd(),
      "../../packages/computer-use-runtime/pine-computer-use",
    ),
    path.resolve(
      moduleDirectory,
      "../../../../packages/computer-use-runtime/pine-computer-use",
    ),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function resolveComputerUseExecutable(): string {
  const configured = process.env.PINE_COMPUTER_USE_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.join(
    defaultBundleRoot(),
    "bin",
    process.platform === "win32"
      ? "pine-computer-use.exe"
      : "pine-computer-use",
  );
}

/**
 * Pine's support directory for the native runtime: the native-host wrapper,
 * the agent-cursor overlay app and the browser bridge socket live here, apart
 * from any standalone Munim Computer Use install.
 */
export function resolveComputerUseSupportDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Pine",
      "computer-use",
    );
  }
  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA?.trim() || path.win32.join(home, "AppData", "Local");
    return path.win32.join(localAppData, "Pine", "computer-use");
  }
  const dataHome =
    env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  return path.join(dataHome, "pine", "computer-use");
}

/**
 * The embedder profile that runs the vendored server under Pine's identity:
 * its own support directory, bridge socket, agent-cursor app, native-messaging
 * host and browser extension id.
 */
export function computerUseProfile(
  supportDir: string = resolveComputerUseSupportDirectory(),
): Record<string, unknown> {
  return { ...pineIdentity.profile, supportDir };
}

export function computerUseProfileArgs(supportDir?: string): readonly string[] {
  return ["--profile", JSON.stringify(computerUseProfile(supportDir))];
}

export function resolvePineBrowserExtensionDirectory(): string {
  return path.join(defaultBundleRoot(), "chrome-extension");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedContent(value: unknown): (TextContent | ImageContent)[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part): (TextContent | ImageContent)[] => {
    if (!isRecord(part)) return [];
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }
    if (
      part.type === "image" &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    ) {
      return [{ type: "image", data: part.data, mimeType: part.mimeType }];
    }
    return [];
  });
}

function resultText(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function subjectForCall(name: string, params: Record<string, unknown>): string {
  const targets: string[] = [];
  if (typeof params.app === "string") targets.push(`app ${params.app}`);
  if (typeof params.tab_id === "number") {
    targets.push(`browser tab ${Math.round(params.tab_id)}`);
  }
  if (typeof params.element_id === "string") {
    targets.push(`element ${params.element_id}`);
  }
  if (typeof params.index === "number") {
    targets.push(`element index ${Math.round(params.index)}`);
  }
  if (typeof params.url === "string") targets.push(`URL ${params.url}`);
  if (typeof params.display === "number") {
    targets.push(`display ${Math.round(params.display)}`);
  }
  if (typeof params.x === "number" && typeof params.y === "number") {
    targets.push(`coordinates ${Math.round(params.x)},${Math.round(params.y)}`);
  }
  return `${name} on ${targets.length > 0 ? targets.join(", ") : "the visible desktop"}`;
}

function titleCaseToolName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function runHelper(
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(stderr.trim() || stdout.trim() || `Exited with ${code}`),
        );
    });
  });
}

export class ComputerUseController {
  readonly executablePath: string;
  readonly supportDirectory: string;
  readonly extensionDirectory = resolvePineBrowserExtensionDirectory();
  private readonly client: Pick<
    ComputerUseMcpClient,
    "start" | "callTool" | "dispose"
  >;
  private taskGeneration = 0;
  private nativeHostRefreshed = false;
  private authorizedMode?: PineApprovalMode;

  constructor(private readonly options: ComputerUseControllerOptions) {
    this.executablePath =
      options.executablePath ?? resolveComputerUseExecutable();
    this.supportDirectory =
      options.supportDirectory ?? resolveComputerUseSupportDirectory();
    this.client =
      options.client ??
      new ComputerUseMcpClient(
        this.executablePath,
        computerUseProfileArgs(this.supportDirectory),
      );
  }

  async activate(
    enableTools: () => void,
  ): Promise<AgentToolResult<Record<string, unknown>>> {
    await this.client.start();
    await this.refreshInstalledNativeHost();
    enableTools();
    return {
      content: [
        {
          type: "text",
          text: `<computer_use_skill>\n${COMPUTER_USE_SKILL.trim()}\n</computer_use_skill>\n\nPine Computer Use is active for this session. Browser extension directory: ${this.extensionDirectory}`,
        },
      ],
      details: {
        backend: "munim-computer-use",
        upstreamVersion: MUNIM_COMPUTER_USE_VERSION,
        extensionDirectory: this.extensionDirectory,
        activatedToolCount: COMPUTER_USE_DYNAMIC_TOOL_NAMES.length,
      },
    };
  }

  async call(
    toolCallId: string,
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<Record<string, unknown>>> {
    const generation = this.taskGeneration;
    await this.client.start();
    this.checkTask(generation, signal);
    await this.reviewAction(toolCallId, name, params, signal);
    this.checkTask(generation, signal);
    const raw = (await this.client.callTool(
      name,
      params,
      signal,
    )) as McpToolResult;
    const content = normalizedContent(raw.content);
    if (raw.isError === true) {
      throw new Error(resultText(content) || `${name} failed.`);
    }
    return {
      content:
        content.length > 0
          ? content
          : [{ type: "text", text: `${name} completed without output.` }],
      details: { backend: "munim-computer-use", toolName: name },
    };
  }

  async requestPermissions(
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<Record<string, unknown>>> {
    if (process.platform !== "darwin") {
      return {
        content: [
          {
            type: "text",
            text: "Pine Computer Use does not need a permission-request helper on this platform. Check the operating system's accessibility/input permissions if a tool reports an access error.",
          },
        ],
        details: { backend: "munim-computer-use" },
      };
    }
    await this.reviewAction(
      toolCallId,
      REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME,
      {},
      signal,
    );
    const output = await runHelper(this.executablePath, [
      ...computerUseProfileArgs(this.supportDirectory),
      "request-permissions",
    ]);
    return {
      content: [
        { type: "text", text: output || "Permission request completed." },
      ],
      details: { backend: "munim-computer-use" },
    };
  }

  async installBrowserExtension(
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<Record<string, unknown>>> {
    await this.reviewAction(
      toolCallId,
      INSTALL_PINE_BROWSER_EXTENSION_TOOL_NAME,
      {},
      signal,
    );
    const output = await runHelper(
      this.executablePath,
      this.nativeHostInstallArgs(),
    );
    this.nativeHostRefreshed = true;
    return {
      content: [
        {
          type: "text",
          text: `${output}\n\nNative Messaging is registered. The user must now load this unpacked extension directory in Chrome: ${this.extensionDirectory}`,
        },
      ],
      details: { extensionDirectory: this.extensionDirectory },
    };
  }

  /**
   * Keep an already-registered browser bridge pointing at this runtime. The
   * wrapper records the executable path and Pine's profile, so an app update
   * or move would otherwise leave Chrome talking to a stale host. Only a host
   * the user approved earlier (its wrapper exists) is rewritten; first-time
   * registration still goes through `install_pine_browser_extension`.
   */
  private async refreshInstalledNativeHost(): Promise<void> {
    if (this.nativeHostRefreshed) return;
    this.nativeHostRefreshed = true;
    const wrapper = path.join(
      this.supportDirectory,
      process.platform === "win32" ? "native-host.cmd" : "native-host",
    );
    if (!existsSync(wrapper)) return;
    try {
      await runHelper(this.executablePath, this.nativeHostInstallArgs());
    } catch (error) {
      console.warn(
        `[Pine Computer Use] Could not refresh the browser bridge: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private nativeHostInstallArgs(): string[] {
    return [
      ...computerUseProfileArgs(this.supportDirectory),
      "install-native-host",
      "--binary",
      this.executablePath,
    ];
  }

  dispose(): Promise<void> {
    this.resetTaskAuthorization();
    return this.client.dispose();
  }

  /** Task grants are intentionally in-memory and never restored with a session. */
  resetTaskAuthorization(): void {
    this.taskGeneration += 1;
    this.authorizedMode = undefined;
  }

  private checkTask(generation: number, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (generation !== this.taskGeneration) {
      throw new Error(
        "Computer control authorization expired; retry the action.",
      );
    }
  }

  private async reviewAction(
    toolCallId: string,
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const mode = this.options.getApprovalMode();
    if (mode === "YOLO" || OBSERVATION_TOOLS.has(name)) {
      return;
    }
    const setup =
      name === REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME ||
      name === INSTALL_PINE_BROWSER_EXTENSION_TOOL_NAME;
    if (!setup && this.authorizedMode === mode) return;
    const gate = this.options.getGate();
    if (!gate)
      throw new Error(
        "Computer control is unavailable without an approval gate.",
      );
    const generation = this.taskGeneration;
    const decision = await gate.reviewPrivilegedCall({
      toolCallId,
      toolName: name,
      subject: setup
        ? subjectForCall(name, params)
        : `Control desktop applications and browser tabs for the current task. First action: ${subjectForCall(name, params)}`,
      description: setup
        ? `Use Computer Use: ${titleCaseToolName(name)}`
        : "Allow computer control for this task; confirm consequential actions when not already authorized",
      evidence: setup
        ? "This setup call changes OS permissions or browser configuration and requires its own approval."
        : "This requests task-level computer control, outside the project filesystem sandbox. Approval covers subsequent ordinary clicks, typing, scrolling, app switching, and browser navigation without further per-action reviews until the run ends or is stopped. The executing model must pause before consequential actions not already authorized by the user; there is no deterministic per-click risk filter. This grant does not cover OS permission requests or browser extension installation.",
      signal,
    });
    if (decision.kind === "deny") {
      throw new Error(decision.reason ?? "This Computer Use call was denied.");
    }
    this.checkTask(generation, signal);
    if (mode !== this.options.getApprovalMode()) {
      throw new Error(
        "Computer control authorization expired; retry the action.",
      );
    }
    if (!setup) this.authorizedMode = mode;
  }
}

const emptyParams = Type.Object({}, { additionalProperties: false });

function createComputerUseToolDefinitions(
  controller: ComputerUseController,
  activate: () => void,
): ToolDefinition[] {
  const activateTool = defineTool({
    name: ACTIVATE_COMPUTER_USE_TOOL_NAME,
    label: "Activate Computer Use",
    description:
      "Dynamically enable Pine's desktop and browser interaction tools for the current session, and load their operating skill. Use only when the task requires a graphical interface and structured tools cannot do it.",
    promptSnippet:
      "Activate desktop/browser UI control on demand; the detailed tools and Computer Use skill stay out of context until activation",
    parameters: emptyParams,
    prepareArguments: () => ({}),
    executionMode: "sequential",
    execute: () => controller.activate(activate),
  });
  const permissionTool = defineTool({
    name: REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME,
    label: "Request Computer Use Permissions",
    description:
      "Ask macOS for the Accessibility and Screen Recording permissions required by Pine Computer Use, then report their current state. Use only after activation when a Computer Use tool reports missing permission.",
    parameters: emptyParams,
    prepareArguments: () => ({}),
    executionMode: "sequential",
    execute: (toolCallId, _params, signal) =>
      controller.requestPermissions(toolCallId, signal),
  });
  const installExtensionTool = defineTool({
    name: INSTALL_PINE_BROWSER_EXTENSION_TOOL_NAME,
    label: "Install Pine Browser Extension",
    description:
      "Register Pine's bundled Chrome Native Messaging host. This changes user-level browser configuration and still requires the user to load the returned unpacked extension directory in Chrome.",
    parameters: emptyParams,
    prepareArguments: () => ({}),
    executionMode: "sequential",
    execute: (toolCallId, _params, signal) =>
      controller.installBrowserExtension(toolCallId, signal),
  });
  const nativeTools = nativeSpecs.map((spec) =>
    defineTool({
      name: spec.name,
      label: titleCaseToolName(spec.name),
      description: spec.description,
      parameters: spec.inputSchema,
      prepareArguments: (args) =>
        (isRecord(args) ? structuredClone(args) : {}) as Static<TSchema>,
      executionMode: "sequential",
      execute: (toolCallId, params, signal) =>
        controller.call(
          toolCallId,
          spec.name,
          params as Record<string, unknown>,
          signal,
        ),
    }),
  );
  return [activateTool, permissionTool, installExtensionTool, ...nativeTools];
}

export function createComputerUseExtension(
  options: ComputerUseExtensionOptions,
): { controller: ComputerUseController; extension: InlineExtension } {
  const controller = new ComputerUseController(options);
  return {
    controller,
    extension: {
      name: "pine-computer-use",
      factory: (pi) => {
        const activate = () => {
          const active = pi.getActiveTools();
          const added = COMPUTER_USE_DYNAMIC_TOOL_NAMES.filter(
            (name) => !active.includes(name),
          );
          if (added.length > 0) {
            pi.setActiveTools([...active, ...added]);
          }
          options.activated();
        };
        for (const tool of createComputerUseToolDefinitions(
          controller,
          activate,
        )) {
          pi.registerTool(tool);
        }
      },
    },
  };
}

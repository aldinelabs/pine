import { createHash, randomUUID } from "node:crypto";
import { createSandboxFileIO, withFileExecutionSignal } from "./sandbox/files";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { TSchema } from "typebox";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  ASK_USER_QUESTION_DESCRIPTION,
  ASK_USER_QUESTION_PROMPT_GUIDELINES,
  ASK_USER_QUESTION_PROMPT_SNIPPET,
  ASK_USER_QUESTION_TOOL_NAME,
  AskUserQuestionParamsSchema,
  buildAskUserQuestionToolResult,
  normalizeAskUserQuestionParams,
  resolveAskUserQuestionSubmission,
  validateAskUserQuestion,
  type AskUserQuestionParams,
  type AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";
import type { AgentFolderGrant, AgentSessionLocation } from "./protocol";
import { UI_PRESENT_FILE_TOOL_NAME } from "../shared/agent";
import { PROJECT_TEMPORARY_DIRECTORY } from "../shared/projects";
import {
  createNativeBashEnvironment,
  resolveLoginPath,
  resolveUserBunPath,
} from "./bash-env";
import {
  createScopedBashOperations,
  SandboxCommandPermissionError,
} from "./bash-execution";
import {
  PineToolAccessPolicy,
  PineAttachedPathAccess,
  PathAccessDeniedError,
  preserveAccessDenial,
} from "./tool-access-policy";
export {
  PineToolAccessPolicy,
  PineAttachedPathAccess,
} from "./tool-access-policy";
export {
  SandboxCommandPermissionError,
  hasPermissionDiagnostic,
} from "./bash-execution";
import type { ToolGate } from "./gate";
import type { PineApprovalMode } from "../shared/agent";
import { resolveImageReference } from "./media/image-input";
import {
  createTinyFishToolDefinitions,
  type TinyFishToolFactoryOptions,
} from "./tinyfishTools";
import { createMediaGenerationToolDefinitions } from "./media/tools";
import { createTodoToolDefinition } from "./todoTool";
import {
  createWorkspaceToolDefinitions,
  type PineWorkspaceToolContext,
} from "./workspaceTools";
import {
  BackgroundTaskRegistry,
  type BackgroundTaskRegistryOptions,
} from "@pine/pi-background-tasks/registry";
import { createBackgroundTaskToolDefinitions } from "./backgroundTaskTools";

interface FileIO {
  access(path: string, mode: number): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  readHeader(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

const nativeFileIO: FileIO = {
  access,
  readFile: (targetPath: string) => readFile(targetPath),
  readHeader: async (targetPath: string) => {
    const file = await open(targetPath, "r");
    try {
      const buffer = Buffer.alloc(12);
      const { bytesRead } = await file.read(buffer, 0, 12, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  },
  writeFile: (targetPath: string, content: string) =>
    writeFile(targetPath, content, "utf8"),
  mkdir: (targetPath: string) =>
    mkdir(targetPath, { recursive: true }).then(() => undefined),
};

function imageMimeType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
    return "image/jpeg";
  const signature = bytes.toString("ascii");
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a"))
    return "image/gif";
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP")
    return "image/webp";
  if (signature.startsWith("BM")) return "image/bmp";
  return null;
}

function createReadOperations(policy: PineToolAccessPolicy, io = nativeFileIO) {
  return {
    access: async (targetPath: string) =>
      io.access(await policy.authorize(targetPath, "read"), constants.R_OK),
    detectImageMimeType: async (targetPath: string) =>
      imageMimeType(
        await io.readHeader(await policy.authorize(targetPath, "read")),
      ),
    readFile: async (targetPath: string) =>
      io.readFile(await policy.authorize(targetPath, "read")),
  };
}

function createEditOperations(policy: PineToolAccessPolicy, io = nativeFileIO) {
  return {
    access: async (targetPath: string) =>
      io.access(
        await policy.authorize(targetPath, "write"),
        constants.R_OK | constants.W_OK,
      ),
    readFile: async (targetPath: string) =>
      io.readFile(await policy.authorize(targetPath, "write")),
    writeFile: async (targetPath: string, content: string) =>
      io.writeFile(await policy.authorize(targetPath, "write"), content),
  };
}

function createWriteOperations(
  policy: PineToolAccessPolicy,
  io = nativeFileIO,
) {
  return {
    mkdir: async (targetPath: string) =>
      io.mkdir(
        await policy.authorize(targetPath, "write", { allowMissing: true }),
      ),
    writeFile: async (targetPath: string, content: string) =>
      io.writeFile(
        await policy.authorize(targetPath, "write", { allowMissing: true }),
        content,
      ),
  };
}

/**
 * Wrap a file-mutating tool with the approval gate: Let Me Review mode confirms before
 * every call, and an authorize denial (outside grants / read-only) escalates
 * to the gate, whose allowance re-runs the call with permissive operations.
 */
function gateFileTool<TParams extends TSchema, TDetails, TState>(
  tool: ToolDefinition<TParams, TDetails, TState>,
  permissive: ToolDefinition<TParams, TDetails, TState>,
  getGate: () => ToolGate | null,
  getApprovalMode: () => PineApprovalMode,
): ToolDefinition<TParams, TDetails, TState> {
  return {
    ...tool,
    execute: async (toolCallId, inputParams, signal, onUpdate, ctx) => {
      const params = structuredClone(inputParams);
      if (getApprovalMode() === "YOLO") {
        return permissive.execute(toolCallId, params, signal, onUpdate, ctx);
      }
      const gate = getGate();
      if (!gate) {
        if (getApprovalMode() === "let-me-review") {
          throw new Error("Execution is unavailable without an approval gate.");
        }
        return withFileExecutionSignal(signal, () =>
          tool.execute(toolCallId, params, signal, onUpdate, ctx),
        );
      }
      const targetPath = (params as { path?: unknown }).path;
      const subject = typeof targetPath === "string" ? targetPath : undefined;
      const pre = await gate.reviewFileCall({
        toolCallId,
        toolName: tool.name,
        path: subject,
        signal,
      });
      if (pre.kind === "deny") {
        throw new Error(pre.reason ?? "This call was denied.");
      }
      if (signal?.aborted) throw new Error("aborted");
      try {
        return await preserveAccessDenial(() =>
          withFileExecutionSignal(signal, () =>
            tool.execute(toolCallId, params, signal, onUpdate, ctx),
          ),
        );
      } catch (error) {
        if (!(error instanceof PathAccessDeniedError)) throw error;
        const decision = await gate.reviewDenial("authorize", {
          toolCallId,
          toolName: tool.name,
          subject: subject ?? "",
          evidence: error instanceof Error ? error.message : String(error),
          signal,
        });
        if (decision.kind === "allow") {
          if (signal?.aborted) throw new Error("aborted");
          return await permissive.execute(
            toolCallId,
            params,
            signal,
            onUpdate,
            ctx,
          );
        }
        throw new Error(
          decision.reason ??
            (error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
}

export interface PineToolPermissionContext {
  /** Media generation beyond the project sandbox: activation, credentials, and the picked image model. */
  mediaGeneration?: PineMediaGenerationContext;
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  /** Managed Skill directories become writable only while Skill Authoring is active. */
  getSkillAuthoringFolders?: () => readonly AgentFolderGrant[];
  getTinyFishApiKey?: () => string | undefined;
  requestQuestionnaire?: (
    toolCallId: string,
    params: AskUserQuestionParams,
    signal?: AbortSignal,
  ) => Promise<AskUserQuestionSubmission>;
  /** Opens a file tab for the user without moving their focus. */
  presentFile?: (toolCallId: string, filePath: string) => void;
  /** Listing the user's projects and moving the session between them. */
  workspace?: Omit<
    PineWorkspaceToolContext,
    "requestQuestionnaire" | "currentProject"
  >;
  /** Gives the session `bg_run` and the other background task tools. */
  backgroundTasks?: PineBackgroundTaskContext;
}

export interface PineBackgroundTaskContext {
  onChange(): void;
  sendCompletionNotification: BackgroundTaskRegistryOptions["sendCompletionNotification"];
  /** Receives the session's registry so the runtime can list and stop tasks. */
  attach(registry: BackgroundTaskRegistry): void;
}

export interface PineMediaGenerationContext {
  /** Enables the hidden media tools for the live session. */
  activate(): void;
  /** Resolves the OpenRouter credential; undefined when it is not configured. */
  resolveOpenRouterApiKey(): Promise<string | undefined>;
  /** The image model the user picked in the composer's model selector. */
  imageModelId?(): Promise<string | undefined> | string | undefined;
}

export async function createPineToolDefinitions(
  location: AgentSessionLocation,
  gate?: ToolGate | null,
  attachedPaths?: PineAttachedPathAccess,
  permissions?: PineToolPermissionContext,
): Promise<ToolDefinition[]> {
  const getApprovalMode = () =>
    permissions?.getApprovalMode() ?? location.approvalMode ?? "auto-approve";
  const getGate = () => permissions?.getGate() ?? gate ?? null;
  const isWindows = process.platform === "win32";
  const shellName = isWindows ? "powershell" : "bash";
  const privilegedShellName = isWindows
    ? "privileged_powershell"
    : "privileged_bash";
  const bashTemporaryDirectory = path.join(
    path.dirname(location.sessionsRoot),
    PROJECT_TEMPORARY_DIRECTORY,
    createHash("sha256")
      .update(await realpath(location.cwd))
      .digest("hex")
      .slice(0, 24),
  );
  await mkdir(bashTemporaryDirectory, { recursive: true });
  const canonicalBashTemporaryDirectory = await realpath(
    bashTemporaryDirectory,
  );
  const policy = await PineToolAccessPolicy.create(
    location.cwd,
    [
      {
        access: "read-write",
        path: canonicalBashTemporaryDirectory,
      },
      ...location.folders,
    ],
    attachedPaths,
    permissions?.getSkillAuthoringFolders,
  );
  // Permissive twin used to re-run a call the gate approved beyond the grants.
  const permissivePolicy = PineToolAccessPolicy.permissive(location.cwd);
  const loginPath = await resolveLoginPath();
  // Bun's standalone installer puts a single executable in HOME. Grant that
  // exact executable (and its canonical target), never its parent directory.
  const bunPath = resolveUserBunPath(os.homedir());
  const canonicalBunPath = await realpath(bunPath).catch(() => null);
  const runtimeFiles = [
    ...(canonicalBunPath ? [bunPath, canonicalBunPath] : []),
    process.execPath,
    await realpath(process.execPath),
    // Electron's Windows Node mode loads ICU and runtime data beside the exe.
    // Grant this once for all ordinary tools so shell and file calls can share
    // one persistent SRT authority snapshot.
    ...(isWindows ? [path.dirname(process.execPath)] : []),
  ];
  const sandboxFiles = createSandboxFileIO(
    policy,
    canonicalBashTemporaryDirectory,
    loginPath,
    runtimeFiles,
  );

  // Approval changes authority, not the user's shell environment.
  const nativeShellTool = (
    isWindows ? createPowerShellToolDefinition : createBashToolDefinition
  )(location.cwd, {
    operations: isWindows
      ? createLocalPowerShellOperations()
      : createLocalBashOperations(),
    spawnHook: (context) => ({
      ...context,
      env: createNativeBashEnvironment(context.env, loginPath, location.cwd),
    }),
  });

  const readTool = createReadToolDefinition(location.cwd, {
    operations: createReadOperations(policy, sandboxFiles),
  });
  const editTool = createEditToolDefinition(location.cwd, {
    operations: createEditOperations(policy, sandboxFiles),
  });
  const writeTool = createWriteToolDefinition(location.cwd, {
    operations: createWriteOperations(policy, sandboxFiles),
  });
  const permissiveEditTool = createEditToolDefinition(location.cwd, {
    operations: createEditOperations(permissivePolicy),
  });
  const permissiveWriteTool = createWriteToolDefinition(location.cwd, {
    operations: createWriteOperations(permissivePolicy),
  });
  const permissiveReadTool = createReadToolDefinition(location.cwd, {
    operations: createReadOperations(permissivePolicy),
  });

  const gatedReadTool = gateFileTool(
    readTool,
    permissiveReadTool,
    getGate,
    getApprovalMode,
  );
  const gatedEditTool = gateFileTool(
    editTool,
    permissiveEditTool,
    getGate,
    getApprovalMode,
  );
  const gatedWriteTool = gateFileTool(
    writeTool,
    permissiveWriteTool,
    getGate,
    getApprovalMode,
  );

  const shellTool = (
    isWindows ? createPowerShellToolDefinition : createBashToolDefinition
  )(location.cwd, {
    operations: createScopedBashOperations(
      policy,
      canonicalBashTemporaryDirectory,
      loginPath,
      runtimeFiles,
    ),
  });

  // Rebuild the bash tool with a required `description` field so the agent
  // must state what each command does. The original execute handles the
  // command/timeout args and ignores the extra description, so we forward
  // straight to it.
  const pineShellParams = Type.Object({
    // First property on purpose: models emit keys in schema order, so the
    // description streams in before the command and can render immediately.
    description: Type.String({
      description:
        "A short, imperative description of what this command does, for the user reading the transcript. Write this argument FIRST, before composing command, so readers see the intent while the call streams in. Write it in the same language the user is using in this conversation, not the model's preferred language.",
    }),
    command: Type.String({
      description: `${isWindows ? "PowerShell" : "Bash"} command to execute`,
    }),
    timeout: Type.Optional(
      Type.Number({
        description: "Timeout in seconds (optional, no default timeout)",
      }),
    ),
  });
  const sandboxGuidance = ` Ordinary ${shellName} can read only shared project folders, user-attached files/directories, this project's temporary directory, and installed system/application/toolchain runtime files. Ancestor directories can be listed for toolchain discovery without granting access to sibling file contents. Reading or listing other external paths, private configs, and unrelated projects is blocked even in Auto Approve mode. Use ${privilegedShellName} directly for those external reads and explain the required access; each call requires approval. Writes are limited to read-write shared folders and this project's temporary directory. System temporary storage, network access, and local servers are blocked. Use ${privilegedShellName} with approval when native capabilities are needed. Some runtime-protected configuration files also require native approval.`;
  const pineShellTool = defineTool({
    ...shellTool,
    parameters: pineShellParams,
    prepareArguments: (args) => args as Static<typeof pineShellParams>,
    execute: async (toolCallId, inputParams, signal, onUpdate, ctx) => {
      const params = structuredClone(inputParams);
      if (getApprovalMode() === "YOLO") {
        throw new Error(
          `Ordinary ${shellName} is disabled in YOLO mode. Use ${privilegedShellName} instead.`,
        );
      }
      const command = params.command;
      const description = params.description;
      // Let Me Review mode keeps its explicit "confirm every call" contract. Automatic
      // mode never reviews ordinary bash: the project sandbox is its complete,
      // non-escalating authority boundary.
      const currentGate = getGate();
      if (getApprovalMode() === "let-me-review" && !currentGate) {
        throw new Error("Execution is unavailable without an approval gate.");
      }
      if (currentGate && getApprovalMode() === "let-me-review") {
        const pre = await currentGate.reviewBashCommand({
          toolCallId,
          toolName: shellName,
          command,
          description,
          signal,
        });
        if (pre.kind === "deny") {
          throw new Error(pre.reason ?? "This call was denied.");
        }
      }

      try {
        return await shellTool.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          ctx,
        );
      } catch (error) {
        if (error instanceof SandboxCommandPermissionError) {
          throw new Error(
            `${error.message}\n\nPermission diagnostic (not verified sandbox evidence):\n${error.outputTail.trim()}`,
          );
        }
        throw error;
      }
    },
    description: `${shellTool.description}${sandboxGuidance} The shell is ${isWindows ? "PowerShell without a profile" : "zsh with no user startup files"}. The scratch directory is ${JSON.stringify(canonicalBashTemporaryDirectory)}. Keep diagnostic stderr visible. Explicitly describe what each command does in the description field, written first, in the same language as the user's messages.`,
    promptSnippet: `${shellTool.promptSnippet}. Reads are restricted to shared folders, attachments, project temporary storage and runtime files; use ${privilegedShellName} directly to read or list other external paths, subject to approval. Use the project temporary directory for temporary files; always write description before command, in the user's language`,
  });

  const privilegedShellTool =
    getGate() || getApprovalMode() === "YOLO" || permissions
      ? defineTool({
          ...nativeShellTool,
          name: privilegedShellName,
          parameters: pineShellParams,
          prepareArguments: (args) => args as Static<typeof pineShellParams>,
          execute: async (toolCallId, inputParams, signal, onUpdate, ctx) => {
            const params = structuredClone(inputParams);
            const command = params.command;
            // YOLO bypasses every Pine permission gate. Other modes require a
            // fresh review before native execution.
            if (getApprovalMode() !== "YOLO") {
              const currentGate = getGate();
              if (!currentGate) {
                throw new Error(
                  "Privileged execution is unavailable without an approval gate.",
                );
              }
              const decision = await currentGate.reviewPrivilegedCall({
                toolCallId,
                toolName: privilegedShellName,
                subject: command,
                description: params.description,
                evidence:
                  "The agent explicitly requested execution outside Pine's project sandbox because the required capability cannot be completed inside it.",
                signal,
              });
              if (decision.kind === "deny") {
                throw new Error(
                  `Approval denied before execution; the command was not started. ${decision.reason ?? "The reviewer did not allow native execution."}`,
                );
              }
            }
            if (signal?.aborted) throw new Error("aborted");
            return nativeShellTool.execute(
              toolCallId,
              params,
              signal,
              onUpdate,
              ctx,
            );
          },
          description: `Run a ${isWindows ? "PowerShell" : "shell"} command with the user's native permissions, outside Pine's project sandbox. Every call requires a fresh approval unless YOLO mode is active. Use it directly for out-of-project filesystem access, network access, system temporary storage, external writes, GUI application control, or another operation that ordinary ${shellName} explicitly reports was denied by the project sandbox. State the needed external access in description. Do not use it for normal project commands or ordinary command errors.`,
          promptSnippet: `Use ${privilegedShellName} directly for app/GUI control, external process control, out-of-project filesystem access, or after ordinary ${shellName} explicitly says the project sandbox denied an operation. Calls receive a fresh review before native execution unless YOLO mode is active. State why native privileges are required in description before composing command.`,
        })
      : null;

  const tinyFishTools: ToolDefinition[] = permissions?.getTinyFishApiKey
    ? createTinyFishToolDefinitions({
        getApiKey: permissions.getTinyFishApiKey,
        outputDirectory: path.join(canonicalBashTemporaryDirectory, "web"),
      } satisfies TinyFishToolFactoryOptions)
    : [];
  const requestQuestionnaire = permissions?.requestQuestionnaire;
  const presentFile = permissions?.presentFile;

  /**
   * File paths are resolved and checked by Pine's access policy before main is
   * told to open a tab, so a presented file can never point the renderer at a
   * path the agent could not read itself. Paths outside the shared folders and
   * attachments raise a normal access denial, which the gate can then approve.
   */
  const createPresentFileTool = (accessPolicy: PineToolAccessPolicy) => {
    const params = Type.Object({
      path: Type.String({
        description:
          "Path of the file to open for the user. A project-relative path is preferred; an absolute path is required for files outside the shared project folders.",
      }),
    });
    return defineTool({
      name: UI_PRESENT_FILE_TOOL_NAME,
      label: "Present File",
      description:
        "Open a file in a new tab so the user can read it, without switching them to that tab. The tab pulses until the user looks at it, so the user keeps control of what they are reading. Use this when the user asks to see a file or when showing the file is clearer than describing it. Presenting a path outside the shared project folders and the user's attachments needs approval, because Pine must read that path to display it.",
      promptSnippet: `Use ${UI_PRESENT_FILE_TOOL_NAME} to open a file the user should look at, instead of only naming it in prose`,
      promptGuidelines: [
        `${UI_PRESENT_FILE_TOOL_NAME} opens a tab in the background: the user is not switched to it, so say what you presented and why rather than assuming they saw it.`,
        `Pass the file's project-relative path when it has one. Directories, missing files, and unsupported content are reported back to you.`,
        `Present only the files that matter to the current request; opening several tabs at once costs the user attention.`,
      ],
      parameters: params,
      prepareArguments: (args) => args as Static<typeof params>,
      execute: async (toolCallId, inputParams, signal) => {
        const requested = inputParams.path.trim();
        if (!requested) throw new Error("A file path is required.");
        const authorizedPath = await accessPolicy.authorize(
          path.resolve(location.cwd, requested),
          "read",
        );
        const metadata = await stat(authorizedPath).catch(() => null);
        if (!metadata?.isFile()) {
          throw new Error(`Expected a readable file, not: ${requested}`);
        }
        if (signal?.aborted) throw new Error("aborted");
        presentFile?.(toolCallId, authorizedPath);
        return {
          content: [
            {
              type: "text" as const,
              text: `Opened ${authorizedPath} in a new background tab. The user was not switched to it.`,
            },
          ],
          details: { path: authorizedPath },
        };
      },
    });
  };

  const workspace = permissions?.workspace;
  const workspaceTools =
    workspace && requestQuestionnaire
      ? createWorkspaceToolDefinitions({
          ...workspace,
          requestQuestionnaire,
          currentProject: {
            name: location.projectName,
            temporaryWorkspace: location.temporaryWorkspace === true,
          },
        })
      : [];

  const uiPresentFileTool = presentFile
    ? gateFileTool(
        createPresentFileTool(policy),
        createPresentFileTool(permissivePolicy),
        getGate,
        getApprovalMode,
      )
    : null;
  const askUserQuestionTool = requestQuestionnaire
    ? defineTool({
        name: ASK_USER_QUESTION_TOOL_NAME,
        label: "Ask User Question",
        description: ASK_USER_QUESTION_DESCRIPTION,
        promptSnippet: ASK_USER_QUESTION_PROMPT_SNIPPET,
        promptGuidelines: [...ASK_USER_QUESTION_PROMPT_GUIDELINES],
        parameters: AskUserQuestionParamsSchema,
        prepareArguments: (args) =>
          args as Static<typeof AskUserQuestionParamsSchema>,
        execute: async (toolCallId, inputParams, signal) => {
          const params = normalizeAskUserQuestionParams(
            structuredClone(inputParams),
          );
          const validation = validateAskUserQuestion(params);
          if (!validation.ok) {
            return {
              content: [{ type: "text" as const, text: validation.message }],
              details: {
                answers: [],
                cancelled: true,
                error: validation.error,
              },
            };
          }
          const autonomous = getApprovalMode() === "autonomous";
          const timeoutSeconds = autonomous
            ? (params.timeout ?? 60)
            : undefined;
          const timeoutController = autonomous ? new AbortController() : null;
          const timer =
            timeoutController && timeoutSeconds !== undefined
              ? setTimeout(
                  () => timeoutController.abort(),
                  timeoutSeconds * 1000,
                )
              : undefined;
          let submission: AskUserQuestionSubmission;
          try {
            submission = await requestQuestionnaire(
              toolCallId,
              params,
              timeoutController
                ? AbortSignal.any(
                    signal
                      ? [signal, timeoutController.signal]
                      : [timeoutController.signal],
                  )
                : signal,
            );
          } finally {
            if (timer) clearTimeout(timer);
          }
          const result = resolveAskUserQuestionSubmission(params, submission);
          if (timeoutController?.signal.aborted && result.cancelled) {
            result.timedOut = true;
            result.timeoutSeconds = timeoutSeconds;
          }
          return buildAskUserQuestionToolResult(result, params);
        },
      })
    : null;

  const backgroundTaskContext = permissions?.backgroundTasks;
  const backgroundTaskTools: ToolDefinition[] = [];
  if (backgroundTaskContext) {
    const sandboxedOperations = createScopedBashOperations(
      policy,
      canonicalBashTemporaryDirectory,
      loginPath,
      runtimeFiles,
    );
    const nativeOperations = isWindows
      ? createLocalPowerShellOperations()
      : createLocalBashOperations();
    const registry = new BackgroundTaskRegistry({
      cwd: location.cwd,
      // Inside the project's temporary directory, so read and sandboxed
      // shell can open the full output.
      outputDirectory: path.join(
        canonicalBashTemporaryDirectory,
        "background-tasks",
        randomUUID(),
      ),
      executor: (privileged) =>
        privileged
          ? {
              exec: (command, cwd, options) =>
                nativeOperations.exec(command, cwd, {
                  ...options,
                  env: createNativeBashEnvironment(
                    { ...process.env },
                    loginPath,
                    location.cwd,
                  ),
                }),
            }
          : sandboxedOperations,
      onChange: () => backgroundTaskContext.onChange(),
      ...(backgroundTaskContext.sendCompletionNotification
        ? {
            sendCompletionNotification:
              backgroundTaskContext.sendCompletionNotification,
          }
        : {}),
    });
    backgroundTaskContext.attach(registry);
    backgroundTaskTools.push(
      ...createBackgroundTaskToolDefinitions({
        registry,
        getApprovalMode,
        getGate,
        sandboxAvailable: !isWindows,
        shellName,
      }),
    );
  }

  const mediaGeneration = permissions?.mediaGeneration;
  const activateMediaGeneration = mediaGeneration
    ? () => mediaGeneration.activate()
    : undefined;
  const imageModelId = mediaGeneration?.imageModelId
    ? () => mediaGeneration.imageModelId?.()
    : undefined;
  const mediaTools = createMediaGenerationToolDefinitions({
    activateMediaGeneration,
    authorizeWrite: (targetPath) =>
      policy.authorize(targetPath, "write", { allowMissing: true }),
    cwd: location.cwd,
    getApprovalMode,
    getGate,
    imageModelId,
    outputDirectory: path.join(canonicalBashTemporaryDirectory, "media"),
    resolveApiKey: () =>
      mediaGeneration?.resolveOpenRouterApiKey() ?? Promise.resolve(undefined),
    resolveImageReference: (reference, signal) =>
      resolveImageReference(reference, {
        cwd: location.cwd,
        readFile: async (targetPath) =>
          readFile(await policy.authorize(targetPath, "read")),
        ...(signal ? { signal } : {}),
      }),
  });

  return [
    {
      ...gatedReadTool,
      description: `${gatedReadTool.description} Read shared project files and user attachments. To read files in other external folders, use ${privilegedShellName} with an explanation of the needed access; approval is required.`,
      promptSnippet: `${gatedReadTool.promptSnippet}. For files outside shared folders and user attachments, use ${privilegedShellName} subject to approval`,
    },
    pineShellTool,
    gatedEditTool,
    gatedWriteTool,
    ...(privilegedShellTool ? [privilegedShellTool] : []),
    ...(uiPresentFileTool ? [uiPresentFileTool] : []),
    ...workspaceTools,
    ...(askUserQuestionTool ? [askUserQuestionTool] : []),
    createTodoToolDefinition(),
    ...backgroundTaskTools,
    ...tinyFishTools,
    ...mediaTools,
  ] as ToolDefinition[];
}

/**
 * `live_context_capture`: the agent starts, pauses, resumes or stops Live
 * Context for its own conversation. Starting listens to the room, so it
 * always asks the user on Pine's approval card, whatever the approval mode;
 * pausing and stopping only take capture away and need no approval. The
 * definition is static, like `read_live_transcript`, so the tool list never
 * changes with capture. See docs/live-context.md §7.5.
 */
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  LIVE_CONTEXT_LOCALES,
  LIVE_CONTEXT_SOURCES,
  type LiveContextSource,
} from "../../shared/liveContext";
import {
  LIVE_CONTEXT_CAPTURE_TOOL_NAME,
  READ_LIVE_TRANSCRIPT_TOOL_NAME,
  type LiveContextCaptureOperation,
  type LiveContextCaptureResult,
  type LiveContextCaptureSettings,
} from "../../shared/liveContextAgent";
import {
  LIVE_CONTEXT_PANEL,
  type WorkbenchCommand,
} from "../../shared/workbench";
import type { UserApprovalRequest } from "../gate";
import type { GateDecision } from "../protocol";

export interface LiveContextCaptureToolOptions {
  /** One capture operation, answered by main. */
  call(
    operation: LiveContextCaptureOperation,
  ): Promise<LiveContextCaptureResult>;
  /** Pine's approval card, shown in every approval mode. */
  requestApproval(
    request: Omit<UserApprovalRequest, "trigger">,
  ): Promise<GateDecision>;
  /** Shows the conversation's Live Context card. */
  sendCommand(toolCallId: string, command: WorkbenchCommand): void;
}

const SOURCE_NAMES: Record<LiveContextSource, string> = {
  mic: "microphone",
  system: "system audio",
};

const STATE_TEXT = {
  idle: "is stopped",
  preparing: "is starting",
  downloading: "is downloading the on-device speech model first",
  listening: "is listening",
  paused: "is paused",
  stopping: "is stopping",
} as const;

const captureParameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("start"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("stop"),
    ],
    { description: "What to do with this conversation's capture." },
  ),
  sources: Type.Optional(
    Type.Array(
      Type.Union(LIVE_CONTEXT_SOURCES.map((source) => Type.Literal(source))),
      {
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        description:
          'Start only: "mic" (the room, the user\'s own voice) and/or "system" (what this Mac plays: a call, a video). Defaults to the user\'s last choice, else both.',
      },
    ),
  ),
  language: Type.Optional(
    Type.Union(
      LIVE_CONTEXT_LOCALES.map((locale) => Type.Literal(locale)),
      {
        description:
          "Start only: the spoken language. Defaults to the user's last choice, else Pine's interface language.",
      },
    ),
  ),
  identify_speakers: Type.Optional(
    Type.Boolean({
      description:
        "Start only: label who is speaking, where this Mac supports it. Defaults to the user's last choice.",
    }),
  ),
});

export const LIVE_CONTEXT_CAPTURE_DESCRIPTION = `Start, pause, resume or stop Live Context for this conversation: on-device transcription of the audio around the user (a meeting, class or call). Use it when the user asks you to listen, take notes or follow along. Starting always shows the user an approval card with the sources and language; once they approve, the Live Context card opens and new speech reaches you in <live_context> blocks (read more with ${READ_LIVE_TRANSCRIPT_TOOL_NAME}). Pause, resume and stop need no approval. Only this conversation's capture can be changed: if another conversation is capturing, this says so and leaves it alone.`;

function settingsText(settings: {
  sources: readonly LiveContextSource[];
  locale?: string;
  speakers?: boolean;
}): string {
  return [
    settings.sources.map((source) => SOURCE_NAMES[source]).join(" and "),
    ...(settings.locale ? [settings.locale] : []),
    ...(settings.speakers !== undefined
      ? [settings.speakers ? "speaker labels on" : "speaker labels off"]
      : []),
  ].join(", ");
}

/** What the model is told, in plain words with what to do next. */
export function describeCaptureResult(
  result: LiveContextCaptureResult,
): string {
  switch (result.outcome) {
    case "unavailable":
      return result.reason === "platform"
        ? "Live Context is unavailable: it needs macOS 26 or later."
        : "Live Context is unavailable: this build of Pine doesn't include it.";
    case "elsewhere":
      return "Another conversation is capturing Live Context. It was left running; the user can stop it from that conversation's Live Context card.";
    case "idle":
      return "Live Context isn't capturing in this conversation.";
    case "ready":
      return `Live Context is ready to start: ${settingsText(result.settings)}.`;
    case "status": {
      const head = `Live Context ${STATE_TEXT[result.state]} (${settingsText(result)}).`;
      const { error } = result;
      if (!error) return head;
      if (error.code === "permission_denied")
        return `${head} macOS denied access to the ${SOURCE_NAMES[error.source ?? "mic"]}. The Live Context card shows where to allow it in System Settings; ask the user to allow it, then start again.`;
      if (error.code === "unsupported_locale")
        return `${head} This Mac can't transcribe that language; start again with another one.`;
      return `${head} It ran into a problem (${error.code}); the Live Context card shows the details.`;
    }
  }
}

/**
 * The answer as the tool's result. Nothing done (unavailable, another
 * conversation's capture, nothing to pause) or a start that failed is an
 * error, so the conversation shows it as one.
 */
function result(capture: LiveContextCaptureResult) {
  const text = describeCaptureResult(capture);
  if (
    capture.outcome === "unavailable" ||
    capture.outcome === "elsewhere" ||
    capture.outcome === "idle" ||
    (capture.outcome === "status" && capture.error)
  )
    throw new Error(text);
  return {
    content: [{ type: "text" as const, text }],
    details: { outcome: capture.outcome },
  };
}

export function createLiveContextCaptureToolDefinition(
  options: LiveContextCaptureToolOptions,
): ToolDefinition {
  return defineTool({
    name: LIVE_CONTEXT_CAPTURE_TOOL_NAME,
    label: "Live Context",
    description: LIVE_CONTEXT_CAPTURE_DESCRIPTION,
    parameters: captureParameters,
    execute: async (toolCallId, params, signal) => {
      if (params.action !== "start") {
        const capture = await options.call({ op: params.action });
        return result(capture);
      }
      const plan = await options.call({
        op: "plan-start",
        ...(params.sources ? { sources: params.sources } : {}),
        ...(params.language ? { locale: params.language } : {}),
        ...(params.identify_speakers !== undefined
          ? { speakers: params.identify_speakers }
          : {}),
      });
      // Already capturing here, elsewhere, or unavailable: nothing to ask.
      if (plan.outcome !== "ready") return result(plan);
      const settings: LiveContextCaptureSettings = plan.settings;
      const decision = await options.requestApproval({
        toolCallId,
        toolName: LIVE_CONTEXT_CAPTURE_TOOL_NAME,
        subject: `Live Context: ${settingsText(settings)}`,
        description:
          "Start transcribing the audio around you into this conversation",
        liveContextCapture: settings,
        ...(signal ? { signal } : {}),
      });
      if (decision.kind === "deny")
        throw new Error(
          decision.reason ?? "The user declined to start Live Context.",
        );
      // The card shows progress, permission prompts and the controls.
      options.sendCommand(toolCallId, {
        kind: "open",
        panel: LIVE_CONTEXT_PANEL,
        highlight: true,
      });
      const started = await options.call({ op: "start", settings });
      return result(started);
    },
  });
}

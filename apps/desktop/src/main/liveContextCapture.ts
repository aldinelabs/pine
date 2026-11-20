/**
 * The agent's control over Live Context: start (after the user approved
 * the exact settings in the conversation), pause, resume and stop, always
 * for the asking conversation only. The worker's arguments are checked here
 * again, since main is what touches the microphone. See docs/live-context.md §7.5.
 */
import { z } from "zod";
import {
  LIVE_CONTEXT_LOCALES,
  LIVE_CONTEXT_SOURCES,
  type LiveContextStatus,
  type LiveContextTarget,
} from "../shared/liveContext";
import type {
  LiveContextCaptureResult,
  LiveContextCaptureSettings,
} from "../shared/liveContextAgent";
import type { LiveContextService } from "./liveContext";

const sourcesSchema = z
  .array(z.enum(LIVE_CONTEXT_SOURCES))
  .min(1)
  .max(2)
  .transform((sources) => [...new Set(sources)]);
const localeSchema = z.enum(LIVE_CONTEXT_LOCALES);

const operationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("plan-start"),
    sources: sourcesSchema.optional(),
    locale: localeSchema.optional(),
    speakers: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("start"),
    settings: z.object({
      sources: sourcesSchema,
      locale: localeSchema,
      speakers: z.boolean(),
    }),
  }),
  z.object({ op: z.literal("pause") }),
  z.object({ op: z.literal("resume") }),
  z.object({ op: z.literal("stop") }),
]);

/** How long a start waits to see listening, a download or an error. */
const START_SETTLE_MS = 5_000;
const SETTLE_POLL_MS = 100;

export interface LiveContextCaptureOptions {
  /** Pine's interface language, the default when nothing was captured yet. */
  uiLocale: () => string;
  /** Waits between status checks; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** The interface language as a capture language, else US English. */
export function defaultCaptureLocale(uiLocale: string): string {
  return (
    LIVE_CONTEXT_LOCALES.find((option) => option === uiLocale) ??
    LIVE_CONTEXT_LOCALES.find((option) =>
      option.startsWith(uiLocale.slice(0, 2)),
    ) ??
    "en-US"
  );
}

function statusResult(status: LiveContextStatus): LiveContextCaptureResult {
  return {
    outcome: "status",
    state: status.state,
    sources: [...status.sources],
    ...(status.locale ? { locale: status.locale } : {}),
    ...(status.speakers !== undefined ? { speakers: status.speakers } : {}),
    ...(status.lastError
      ? {
          error: {
            code: status.lastError.code,
            ...(status.lastError.source
              ? { source: status.lastError.source }
              : {}),
          },
        }
      : {}),
  };
}

function isUnsettled(status: LiveContextStatus): boolean {
  return (
    (status.state === "preparing" || status.state === "stopping") &&
    !status.lastError
  );
}

export async function answerLiveContextCapture(
  service: LiveContextService,
  target: LiveContextTarget,
  request: unknown,
  options: LiveContextCaptureOptions,
): Promise<LiveContextCaptureResult> {
  const operation = operationSchema.parse(request);
  const status = service.status();
  if (!status.available)
    return {
      outcome: "unavailable",
      reason: status.unavailableReason ?? "platform",
    };
  const capturing = status.state !== "idle";
  const here = capturing && status.sessionId === target.sessionId;
  if (capturing && !here) return { outcome: "elsewhere" };
  switch (operation.op) {
    case "plan-start": {
      if (here) return statusResult(status);
      const last = service.lastCaptureSettings();
      const settings: LiveContextCaptureSettings = {
        sources: operation.sources ?? last.sources ?? ["mic", "system"],
        locale:
          operation.locale ??
          last.locale ??
          defaultCaptureLocale(options.uiLocale()),
        // Only what this build can do; the user's last choice otherwise.
        speakers:
          status.speakersAvailable === true &&
          (operation.speakers ?? last.speakers ?? false),
      };
      return { outcome: "ready", settings };
    }
    case "start": {
      // Started meanwhile, here: nothing to do.
      if (here) return statusResult(status);
      const { settings } = operation;
      await service.start({
        ...target,
        sources: settings.sources,
        locale: settings.locale,
        speakers: settings.speakers && status.speakersAvailable === true,
      });
      const sleep =
        options.sleep ??
        ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
      let current = service.status();
      for (
        let waited = 0;
        waited < START_SETTLE_MS && isUnsettled(current);
        waited += SETTLE_POLL_MS
      ) {
        await sleep(SETTLE_POLL_MS);
        current = service.status();
      }
      return statusResult(current);
    }
    case "pause":
    case "resume":
    case "stop": {
      if (!here) return { outcome: "idle" };
      const next =
        operation.op === "pause"
          ? await service.pause()
          : operation.op === "resume"
            ? await service.resume()
            : await service.stop();
      return statusResult(next);
    }
  }
}

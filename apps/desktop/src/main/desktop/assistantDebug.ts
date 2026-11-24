import { app, ipcMain } from "electron";
import { z } from "zod";
import {
  ASSISTANT_DEBUG_PROMPT_CHANNEL,
  type AssistantDebugPromptResult,
} from "../../shared/assistant";
import type { PineCore } from "../core/pineCore";

/**
 * The Assistant's development entry. Until it has an interface, a developer
 * talks to it from the DevTools console of an unpackaged build started with
 * PINE_DEV_ASSISTANT=1:
 *
 *   await pineAssistantDebug.prompt("看看现在都在跑什么")
 *
 * A packaged build never registers the channel or exposes the function.
 */
export function assistantDebugEnabled(): boolean {
  return !app.isPackaged && process.env.PINE_DEV_ASSISTANT === "1";
}

const RequestSchema = z.object({
  message: z.string().trim().min(1).max(100_000),
  locale: z.enum(["en-US", "zh-CN"]).optional(),
});

/** Registered on ipcMain only, never on the router the web interface uses. */
export function registerAssistantDebugIpc(core: () => PineCore | null): void {
  if (!assistantDebugEnabled()) return;
  ipcMain.handle(
    ASSISTANT_DEBUG_PROMPT_CHANNEL,
    (_event, request: unknown): Promise<AssistantDebugPromptResult> => {
      const { message, locale } = RequestSchema.parse(request);
      const current = core();
      if (!current) throw new Error("Pine is still starting.");
      return current.assistant.debugPrompt(message, locale);
    },
  );
}

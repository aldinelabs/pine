import {
  CLEAR_ASSISTANT_CHANNEL,
  GET_ASSISTANT_CHANNEL,
  SET_ASSISTANT_SETTINGS_CHANNEL,
  type AssistantSettings,
  type AssistantState,
  type ClearAssistantResult,
} from "../../../shared/assistant";
import type { PineCore } from "../pineCore";

/** The Assistant's settings and conversation, as its desktop entry uses them. */
export function registerAssistantRequests(core: PineCore): void {
  core.handle(GET_ASSISTANT_CHANNEL, (): Promise<AssistantState> =>
    core.assistant.describeState(),
  );

  core.handle(
    SET_ASSISTANT_SETTINGS_CHANNEL,
    (_context, request: unknown): Promise<AssistantSettings> =>
      core.assistant.saveSettings(request),
  );

  core.handle(CLEAR_ASSISTANT_CHANNEL, (): Promise<ClearAssistantResult> =>
    core.assistant.clear(),
  );
}

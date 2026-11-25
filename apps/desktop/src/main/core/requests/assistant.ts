import {
  GET_ASSISTANT_CHANNEL,
  type AssistantState,
} from "../../../shared/assistant";
import type { PineCore } from "../pineCore";

/** The Assistant's conversation, as its desktop entry opens it. */
export function registerAssistantRequests(core: PineCore): void {
  core.handle(GET_ASSISTANT_CHANNEL, (): Promise<AssistantState> =>
    core.assistant.describeState(),
  );
}

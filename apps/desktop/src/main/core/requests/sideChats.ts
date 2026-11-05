import {
  ABORT_SIDE_CHAT_CHANNEL,
  CLOSE_SIDE_CHAT_CHANNEL,
  DELETE_SIDE_CHAT_CHANNEL,
  LIST_SIDE_CHATS_CHANNEL,
  OPEN_SIDE_CHAT_CHANNEL,
  PROMPT_SIDE_CHAT_CHANNEL,
  type ListSideChatsResult,
  type OpenSideChatResult,
  type PromptSideChatResult,
} from "../../../shared/sideChats";
import type { PineCore } from "../pineCore";
import {
  DeleteSideChatRequestSchema,
  OpenSideChatRequestSchema,
  ProjectSessionRequestSchema,
  PromptSideChatRequestSchema,
  SideChatRequestSchema,
} from "../requestSchemas";

export function registerSideChatRequests(core: PineCore): void {
  const { runtimes } = core;

  core.handle(
    LIST_SIDE_CHATS_CHANNEL,
    async (context, request: unknown): Promise<ListSideChatsResult> => {
      const { projectId, sessionId } =
        ProjectSessionRequestSchema.parse(request);
      return {
        sideChats: await runtimes.listSideChats(
          context.clientId,
          projectId,
          sessionId,
        ),
      };
    },
  );

  core.handle(
    OPEN_SIDE_CHAT_CHANNEL,
    async (context, request: unknown): Promise<OpenSideChatResult> =>
      runtimes.openSideChat(
        context.clientId,
        OpenSideChatRequestSchema.parse(request),
      ),
  );

  core.handle(
    PROMPT_SIDE_CHAT_CHANNEL,
    async (context, request: unknown): Promise<PromptSideChatResult> =>
      runtimes.promptSideChat(
        context.clientId,
        PromptSideChatRequestSchema.parse(request),
      ),
  );

  core.handle(ABORT_SIDE_CHAT_CHANNEL, async (context, request: unknown) => {
    const { projectId, sideChatId } = SideChatRequestSchema.parse(request);
    return runtimes.abortSideChat(context.clientId, projectId, sideChatId);
  });

  core.handle(CLOSE_SIDE_CHAT_CHANNEL, async (context, request: unknown) => {
    const { projectId, sideChatId } = SideChatRequestSchema.parse(request);
    return runtimes.closeSideChat(context.clientId, projectId, sideChatId);
  });

  core.handle(DELETE_SIDE_CHAT_CHANNEL, async (context, request: unknown) => {
    const { projectId, sessionId, sideChatId } =
      DeleteSideChatRequestSchema.parse(request);
    return runtimes.deleteSideChat(
      context.clientId,
      projectId,
      sessionId,
      sideChatId,
    );
  });
}

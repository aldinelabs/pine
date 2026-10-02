import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import {
  applyTaskMutation,
  buildTodoToolResult,
  replayTodoState,
  TODO_DESCRIPTION,
  TODO_PROMPT_GUIDELINES,
  TODO_PROMPT_SNIPPET,
  TODO_TOOL_LABEL,
  TODO_TOOL_NAME,
  TodoParamsSchema,
  type TaskMutationParams,
  type TaskState,
} from "@pine/rpiv-todo";

/**
 * The model's task list. Each session gets its own tool instance, so the list
 * lives in this closure. It is replayed from the session branch on first use,
 * and every result carries the full snapshot, so the list survives restarts
 * and compaction without any extra persistence.
 */
export function createTodoToolDefinition() {
  let state: TaskState | undefined;
  return defineTool({
    name: TODO_TOOL_NAME,
    label: TODO_TOOL_LABEL,
    description: TODO_DESCRIPTION,
    promptSnippet: TODO_PROMPT_SNIPPET,
    promptGuidelines: [...TODO_PROMPT_GUIDELINES],
    parameters: TodoParamsSchema,
    prepareArguments: (args) => args as Static<typeof TodoParamsSchema>,
    execute: (_toolCallId, inputParams, _signal, _onUpdate, ctx) => {
      // Calls in one parallel batch run before any result reaches the branch,
      // so only the first call may read it.
      state ??= replayTodoState(ctx.sessionManager.getBranch());
      const params = structuredClone(inputParams) as TaskMutationParams;
      const result = applyTaskMutation(state, inputParams.action, params);
      state = result.state;
      return Promise.resolve(
        buildTodoToolResult(
          inputParams.action,
          params,
          result.state,
          result.op,
        ),
      );
    },
  });
}

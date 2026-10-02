import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskDetails } from "@pine/rpiv-todo";
import { createTodoToolDefinition } from "../todoTool";

function contextWithBranch(branch: unknown[]) {
  const getBranch = vi.fn(() => branch);
  return {
    ctx: { sessionManager: { getBranch } } as unknown as ExtensionContext,
    getBranch,
  };
}

async function call(
  tool: ReturnType<typeof createTodoToolDefinition>,
  ctx: ExtensionContext,
  params: Parameters<typeof tool.execute>[1],
) {
  const result = await tool.execute("call", params, undefined, undefined, ctx);
  return {
    text: (result.content[0] as { text: string }).text,
    details: result.details as TaskDetails,
  };
}

describe("todo tool", () => {
  it("resumes from the branch once, then keeps its own state", async () => {
    const { ctx, getBranch } = contextWithBranch([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "todo",
          details: {
            action: "create",
            params: {},
            tasks: [{ id: 1, subject: "Earlier task", status: "pending" }],
            nextId: 2,
          },
        },
      },
    ]);
    const tool = createTodoToolDefinition();

    const created = await call(tool, ctx, {
      action: "create",
      subject: "Next task",
    });
    // A parallel call runs before the first result reaches the branch.
    const started = await call(tool, ctx, {
      action: "update",
      id: 2,
      status: "in_progress",
    });

    expect(created.text).toBe("Created #2: Next task (pending)");
    expect(started.text).toBe("Updated #2 (pending → in_progress)");
    expect(started.details.tasks.map((task) => task.status)).toEqual([
      "pending",
      "in_progress",
    ]);
    expect(getBranch).toHaveBeenCalledTimes(1);
  });

  it("does not let the result alias the caller's arguments", async () => {
    const { ctx } = contextWithBranch([]);
    const tool = createTodoToolDefinition();
    const metadata = { area: "ui" };

    const result = await call(tool, ctx, {
      action: "create",
      subject: "Task",
      metadata,
    });
    metadata.area = "changed";

    expect(result.details.tasks[0]?.metadata).toEqual({ area: "ui" });
    expect(result.details.params).toEqual({
      action: "create",
      subject: "Task",
      metadata: { area: "ui" },
    });
  });
});

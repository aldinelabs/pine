import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PineWorkbenchStateRequestEvent } from "../shared/agent";
import {
  WORKBENCH_MAX_SPLIT,
  WORKBENCH_MIN_SPLIT,
  WORKBENCH_PANELS,
  type WorkbenchState,
} from "../shared/workbench";

const RESPONSE_TIMEOUT_MS = 5_000;
const responseSchema = z.object({
  requestId: z.uuid(),
  state: z.object({
    open: z.boolean(),
    visible: z.boolean(),
    top: z.enum(WORKBENCH_PANELS).nullable(),
    bottom: z.enum(WORKBENCH_PANELS).nullable(),
    split: z.number().min(WORKBENCH_MIN_SPLIT).max(WORKBENCH_MAX_SPLIT),
  }),
});

/** Correlates a read with its owning window; other windows cannot answer it. */
export class WorkbenchStateRequests {
  private readonly pending = new Map<
    string,
    { ownerId: number; resolve(state: WorkbenchState): void }
  >();

  request(
    ownerId: number,
    sessionId: string,
    send: (event: PineWorkbenchStateRequestEvent) => void,
  ): Promise<WorkbenchState> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error("The Pine window did not respond with workbench state."),
        );
      }, RESPONSE_TIMEOUT_MS);
      this.pending.set(requestId, {
        ownerId,
        resolve: (state) => {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve(state);
        },
      });
      try {
        send({ type: "workbench-state-request", sessionId, requestId });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  respond(ownerId: number, response: unknown): boolean {
    const parsed = responseSchema.safeParse(response);
    if (!parsed.success) return false;
    const pending = this.pending.get(parsed.data.requestId);
    if (!pending || pending.ownerId !== ownerId) return false;
    pending.resolve(parsed.data.state);
    return true;
  }
}

import type { AutomationRunSummary } from "@/shared/automation";
import { useContentTabNavigation } from "./useContentTabNavigation";

/**
 * Opens an automation run as the ordinary conversation it is. The run's
 * session sits with its project's sessions, so the session view shows it
 * like any other; reading it there marks the run read.
 */
export function useAutomationRunSession() {
  const navigation = useContentTabNavigation();

  /** False when the run never got as far as starting its agent. */
  function openRun(
    run: Pick<
      AutomationRunSummary,
      | "projectId"
      | "automationId"
      | "automationName"
      | "id"
      | "sessionId"
      | "startedAt"
      | "endedAt"
      | "read"
      | "status"
    >,
  ): boolean {
    if (!run.sessionId) return false;
    navigation.openSession(
      {
        id: run.sessionId,
        createdAt: run.startedAt,
        updatedAt: run.endedAt ?? run.startedAt,
        messageCount: 0,
        automationRun: {
          automationId: run.automationId,
          runId: run.id,
          name: run.automationName,
          startedAt: run.startedAt,
        },
      },
      run.projectId,
    );
    if (!run.read && run.status !== "running")
      void window.pine.automations
        .markRunsRead({
          runIds: [
            {
              projectId: run.projectId,
              automationId: run.automationId,
              runId: run.id,
            },
          ],
        })
        .catch(() => undefined);
    return true;
  }

  return { openRun };
}

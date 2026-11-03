import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  AutomationApprovalRequest,
  AutomationRevealEvent,
  AutomationsChangedEvent,
} from "@/shared/automation";

/**
 * Automation state shared across views: the unread count for the sidebar,
 * pending approvals for session cards, and which automation the manager
 * dialog shows. Lists and runs are loaded by the dialog itself.
 */
export const useAutomationsStore = defineStore("automations", () => {
  const unread = ref(0);
  const approvals = ref<AutomationApprovalRequest[]>([]);
  const respondingIds = ref(new Set<string>());
  const isManagerOpen = ref(false);
  /** Bumped on every change event, so open views reload. */
  const revision = ref(0);
  const reveal = ref<AutomationRevealEvent | null>(null);
  /** Approvals only count on this computer's windows. */
  const canApprove = computed(() => window.pine?.runtime === "desktop");
  let stop: (() => void)[] = [];

  function apply(event: AutomationsChangedEvent): void {
    unread.value = event.unread;
    approvals.value = event.approvals;
    respondingIds.value = new Set(
      [...respondingIds.value].filter((id) =>
        event.approvals.some((approval) => approval.requestId === id),
      ),
    );
    revision.value += 1;
  }

  async function start(): Promise<void> {
    const api = window.pine?.automations;
    if (stop.length > 0 || !api) return;
    stop = [
      api.onChanged(apply),
      api.onReveal((event) => {
        reveal.value = event;
        isManagerOpen.value = true;
      }),
    ];
    try {
      const [pending, runs] = await Promise.all([
        api.approvals(),
        api.runs({ filter: "unread", limit: 500 }),
      ]);
      apply({ unread: runs.length, approvals: pending });
    } catch {
      // Older hosts without automations simply show none.
    }
  }

  function dispose(): void {
    for (const unsubscribe of stop) unsubscribe();
    stop = [];
  }

  function approvalsFor(sessionId: string | undefined) {
    return sessionId
      ? approvals.value.filter((approval) => approval.sessionId === sessionId)
      : [];
  }

  async function respond(requestId: string, approve: boolean): Promise<void> {
    if (respondingIds.value.has(requestId)) return;
    respondingIds.value = new Set([...respondingIds.value, requestId]);
    try {
      await window.pine.automations.respondApproval({ requestId, approve });
    } finally {
      const next = new Set(respondingIds.value);
      next.delete(requestId);
      respondingIds.value = next;
    }
  }

  function open(target?: AutomationRevealEvent): void {
    reveal.value = target ?? null;
    isManagerOpen.value = true;
  }

  return {
    unread,
    approvals,
    respondingIds,
    isManagerOpen,
    revision,
    reveal,
    canApprove,
    start,
    dispose,
    approvalsFor,
    respond,
    open,
  };
});

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useAutomationsStore, import.meta.hot));

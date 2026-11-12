import type { PineSessionEvent, SessionEventListener } from "@/shared/agent";

type Subscribe = (listener: SessionEventListener) => (() => void) | undefined;

interface Hub {
  listeners: SessionEventListener[];
  stop: (() => void) | undefined;
}

// One bridge subscription per `window.pine.onSessionEvent`, so each event
// crosses the context bridge once per window instead of once per consumer.
// A listener stays bound to the source it subscribed through, which keeps a
// replaced `window.pine` (a test stub, a hot reload) from feeding stale
// listeners or being fed by them.
const hubs = new Map<Subscribe, Hub>();

function deliver(hub: Hub, event: PineSessionEvent): void {
  // A snapshot, so a listener that subscribes or leaves during delivery
  // changes only the next event, as separate bridge listeners did.
  for (const listener of [...hub.listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("[Pine] session event listener failed", error);
    }
  }
}

/**
 * Subscribe to the window's session events. Listeners run synchronously in
 * subscription order; a throwing listener does not stop the others. Returns
 * the unsubscribe function; the bridge subscription ends with the last one.
 */
export function onSessionEvent(listener: SessionEventListener): () => void {
  const subscribe = window.pine?.onSessionEvent as Subscribe | undefined;
  if (!subscribe) return () => undefined;
  let hub = hubs.get(subscribe);
  if (!hub) {
    const created: Hub = { listeners: [], stop: undefined };
    hubs.set(subscribe, created);
    created.stop = subscribe((event) => deliver(created, event));
    hub = created;
  }
  const owner = hub;
  owner.listeners.push(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = owner.listeners.indexOf(listener);
    if (index >= 0) owner.listeners.splice(index, 1);
    if (owner.listeners.length > 0 || hubs.get(subscribe) !== owner) return;
    hubs.delete(subscribe);
    owner.stop?.();
  };
}

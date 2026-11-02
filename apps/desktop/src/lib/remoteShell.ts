import { readonly, ref, type Ref } from "vue";

/**
 * Over remote control the web interface runs in an iframe of the RC page,
 * which holds the connection and the list of computers.
 */
export const SWITCH_COMPUTER_MESSAGE = "pine-switch-computer";
/** Pine asks the RC page how many computers this device has paired. */
export const COMPUTERS_REQUEST_MESSAGE = "pine-computers-request";
/** The RC page's answer: `{ type, count }`. */
export const COMPUTERS_MESSAGE = "pine-computers";

export function isRemoteShell(): boolean {
  try {
    return window.parent !== window && window.pine?.runtime === "web";
  } catch {
    return false;
  }
}

/** Asks the RC page to leave this computer and show the list. */
export function switchComputer(): void {
  window.parent.postMessage(
    { type: SWITCH_COMPUTER_MESSAGE },
    window.location.origin,
  );
}

let pairedComputers: Ref<number> | undefined;

/**
 * How many computers the RC page has paired, asked once. Zero until it
 * answers, and outside the RC page.
 */
export function usePairedComputerCount(): Readonly<Ref<number>> {
  if (pairedComputers) return readonly(pairedComputers);
  const count = ref(0);
  pairedComputers = count;
  if (isRemoteShell()) {
    window.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as { type?: unknown; count?: unknown } | null;
      if (
        event.origin === window.location.origin &&
        event.source === window.parent &&
        data?.type === COMPUTERS_MESSAGE &&
        typeof data.count === "number"
      )
        count.value = data.count;
    });
    window.parent.postMessage(
      { type: COMPUTERS_REQUEST_MESSAGE },
      window.location.origin,
    );
  }
  return readonly(count);
}

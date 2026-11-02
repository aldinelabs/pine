/**
 * Over remote control the web interface runs in an iframe of the RC page,
 * which holds the connection and the list of computers.
 */
export const SWITCH_COMPUTER_MESSAGE = "pine-switch-computer";

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

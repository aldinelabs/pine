import type { WebContents } from "electron";
import {
  CLOSE_TAB_REQUESTED_CHANNEL,
  NEW_TAB_REQUESTED_CHANNEL,
} from "../shared/window";

export function installWindowShortcuts(
  contents: WebContents,
  onNewWindow: () => void,
): void {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt)
      return;
    // Ctrl/Cmd+W closes the tab, Ctrl/Cmd+N or Ctrl/Cmd+T opens a tab, and
    // Ctrl/Cmd+Shift+N opens a window.
    const key = input.key.toLowerCase();
    const action =
      key === "n"
        ? input.shift
          ? "new-window"
          : "new-tab"
        : key === "t" && !input.shift
          ? "new-tab"
          : key === "w" && !input.shift
            ? "close-tab"
            : undefined;
    if (!action) return;
    // Prevent Electron's native menu accelerators as well as the DOM event.
    event.preventDefault();
    if (input.isAutoRepeat) return;
    if (action === "close-tab") {
      contents.send(CLOSE_TAB_REQUESTED_CHANNEL);
    } else if (action === "new-tab") {
      contents.send(NEW_TAB_REQUESTED_CHANNEL);
    } else {
      onNewWindow();
    }
  });
}

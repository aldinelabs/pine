import { Notification, powerMonitor, type BrowserWindow } from "electron";
import { AUTOMATIONS_REVEAL_CHANNEL } from "../../shared/automation";
import type {
  AutomationNotification,
  AutomationPowerEvents,
} from "../automation/service";
import { isChineseLocale } from "./attention";

/** Electron's power signals, as automations' system triggers use them. */
export function desktopAutomationPower(): AutomationPowerEvents {
  const events = {
    resume: "resume",
    unlock: "unlock-screen",
    lock: "lock-screen",
  } as const;
  return {
    on(event, listener) {
      const name = events[event];
      powerMonitor.on(name as "resume", listener);
      return () => powerMonitor.off(name as "resume", listener);
    },
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
  };
}

const shown = new Set<Notification>();

/** Clicking opens the automation in a Pine window. */
export function showAutomationNotification(
  notification: AutomationNotification,
  window: () => BrowserWindow | undefined,
): void {
  if (!Notification.isSupported()) return;
  const native = new Notification({
    title: notification.title,
    body: notification.body,
  });
  shown.add(native);
  const release = () => shown.delete(native);
  native.on("click", () => {
    release();
    const target = window();
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    target.webContents.send(AUTOMATIONS_REVEAL_CHANNEL, {
      projectId: notification.projectId,
      automationId: notification.automationId,
      ...(notification.runId ? { runId: notification.runId } : {}),
    });
  });
  native.on("close", release);
  native.on("failed", release);
  native.show();
}

export function automationLocale(): "en-US" | "zh-CN" {
  return isChineseLocale() ? "zh-CN" : "en-US";
}

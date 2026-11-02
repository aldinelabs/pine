import { app, BrowserWindow, Notification } from "electron";
import { COMPLETION_SOUND_EVENT_CHANNEL } from "../../shared/preferences";
import type { PineAgentEvent } from "../../shared/agent";
import {
  approvalNotificationActions,
  approvalNotificationBody,
  replyNotificationBody,
  questionnaireNotificationBody,
} from "../attentionNotifications";
import {
  CompletionSignalTracker,
  type PineCompletedRun,
} from "../completionSignal";
import type { PineCore } from "../core/pineCore";

const SESSION_NOTIFICATION_BODY_LIMIT = 280;

interface SessionNotificationOptions {
  /** Button labels; macOS and Windows show them on the notification. */
  actions?: string[];
  onAction?: (actionIndex: number) => void;
}

interface AttentionNotice extends SessionNotificationOptions {
  requestId: string;
  body: string;
}

/** The language chosen in Pine's preferences, once a window has reported it. */
let appLocale: string | null = null;

export function setAppLocale(locale: unknown): void {
  if (typeof locale === "string") appLocale = locale;
}

/** Native dialogs and notifications follow Pine's language, not the system's. */
export function isChineseLocale(): boolean {
  return (appLocale ?? app.getLocale()).toLowerCase().startsWith("zh");
}

/**
 * Tells the user, at the OS level, that a session needs them or finished:
 * desktop notifications, the macOS dock and the Windows taskbar.
 */
export class DesktopAttention {
  /** Keep shown notifications referenced so their click handlers survive GC. */
  private readonly sessionNotifications = new Set<Notification>();
  /** Approval and question notifications by request id, closed once decided. */
  private readonly attentionNotifications = new Map<string, Notification>();
  /** macOS dock bounce id for the pending approval attention request. */
  private approvalBounceId: number | null = null;
  private readonly completionSignals = new CompletionSignalTracker();

  constructor(
    private readonly core: () => PineCore,
    private readonly ownerWindow: (
      ownerId: number,
    ) => BrowserWindow | undefined,
  ) {}

  observe(event: PineAgentEvent, ownerId: number | undefined): void {
    if (ownerId === undefined) {
      this.completionSignals.forget(event.sessionId);
      return;
    }
    const core = this.core();
    const completedRun = this.completionSignals.observe(event);
    if (completedRun && core.completionSignalMode !== "off") {
      this.signalCompletedRun(completedRun, ownerId);
      if (core.completionSignalMode === "notification-sound")
        this.ownerWindow(ownerId)?.webContents.send(
          COMPLETION_SOUND_EVENT_CHANNEL,
        );
    }
    if (event.type === "approval-request") {
      const chinese = isChineseLocale();
      this.requestApprovalAttention(ownerId, event.sessionId, {
        requestId: event.requestId,
        body: approvalNotificationBody(event.toolName, event.input, chinese),
        actions: approvalNotificationActions(chinese),
        onAction: (actionIndex) =>
          this.answerApprovalFromNotification(
            ownerId,
            event.requestId,
            actionIndex,
          ),
      });
    } else if (event.type === "questionnaire-request") {
      this.requestApprovalAttention(ownerId, event.sessionId, {
        requestId: event.requestId,
        body: questionnaireNotificationBody(
          event.questionnaire,
          isChineseLocale(),
        ),
      });
    } else if (
      event.type === "approval-decided" ||
      event.type === "questionnaire-decided"
    ) {
      this.closeAttentionNotification(event.requestId);
      this.clearApprovalAttention();
    }
  }

  closeAttentionNotifications(): void {
    for (const requestId of [...this.attentionNotifications.keys()])
      this.closeAttentionNotification(requestId);
  }

  clearApprovalAttention(): void {
    if (process.platform === "darwin") {
      if (this.approvalBounceId !== null)
        app.dock?.cancelBounce(this.approvalBounceId);
      this.approvalBounceId = null;
      return;
    }
    if (process.platform === "win32") {
      for (const window of BrowserWindow.getAllWindows()) {
        window.flashFrame(false);
      }
    }
  }

  private closeAttentionNotification(requestId: string): void {
    this.attentionNotifications.get(requestId)?.close();
    this.attentionNotifications.delete(requestId);
  }

  /**
   * Show a desktop notification titled with the session name. Clicking it
   * brings the owning window back to the front.
   */
  private showSessionNotification(
    window: BrowserWindow,
    sessionId: string,
    text: string,
    options: SessionNotificationOptions = {},
  ): Notification | undefined {
    if (!Notification.isSupported()) return undefined;
    const summary = this.core().runtimes.sessionSummary(sessionId);
    const title =
      summary?.name ||
      summary?.preview ||
      (isChineseLocale() ? "新会话" : "New session");
    const body = text.replaceAll(/\s+/g, " ").trim();
    const notification = new Notification({
      title,
      body:
        body.length > SESSION_NOTIFICATION_BODY_LIMIT
          ? `${body.slice(0, SESSION_NOTIFICATION_BODY_LIMIT - 1)}…`
          : body,
      ...(options.actions?.length
        ? {
            actions: options.actions.map((label) => ({
              type: "button" as const,
              text: label,
            })),
          }
        : {}),
    });
    this.sessionNotifications.add(notification);
    const release = (): void => {
      this.sessionNotifications.delete(notification);
    };
    notification.on("click", () => {
      release();
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
    const { onAction } = options;
    if (onAction)
      notification.on("action", (details) => {
        release();
        onAction(details.actionIndex);
      });
    notification.on("close", release);
    notification.on("failed", release);
    notification.show();
    return notification;
  }

  /**
   * Surface a pending approval or question at the OS level: a desktop
   * notification while the window is in the background (unless the user
   * turned them off), and a dock icon that keeps bouncing on macOS or a
   * flashing taskbar button on Windows until the decision (or window focus)
   * clears it.
   */
  private requestApprovalAttention(
    ownerId: number,
    sessionId: string,
    notice: AttentionNotice,
  ): void {
    const window = this.ownerWindow(ownerId);
    if (
      window &&
      !window.isFocused() &&
      this.core().attentionNotificationsEnabled
    ) {
      const notification = this.showSessionNotification(
        window,
        sessionId,
        notice.body,
        notice,
      );
      if (notification) {
        this.closeAttentionNotification(notice.requestId);
        this.attentionNotifications.set(notice.requestId, notification);
      }
    }
    if (process.platform === "darwin") {
      if (this.approvalBounceId !== null)
        app.dock?.cancelBounce(this.approvalBounceId);
      this.approvalBounceId = app.dock?.bounce("critical") ?? null;
      return;
    }
    if (process.platform === "win32") {
      window?.flashFrame(true);
    }
  }

  /** Approve (first button) or deny a tool call straight from its notification. */
  private answerApprovalFromNotification(
    ownerId: number,
    requestId: string,
    actionIndex: number,
  ): void {
    this.attentionNotifications.delete(requestId);
    try {
      this.core().runtimes.respondApproval(ownerId, {
        requestId,
        action: actionIndex === 0 ? "approve" : "reject",
      });
    } catch (error) {
      // Already decided in a window or browser before the button was pressed.
      console.warn(
        "Could not answer the approval from its notification.",
        error,
      );
    }
  }

  /**
   * Tell the user a session finished on its own: a desktop notification with
   * the session title and final reply, plus a single dock bounce on macOS or
   * a flashing taskbar button on Windows. Skipped while the owning window is
   * focused, since the user is already looking at Pine.
   */
  private signalCompletedRun(run: PineCompletedRun, ownerId: number): void {
    const window = this.ownerWindow(ownerId);
    if (!window || window.isFocused()) return;
    this.showSessionNotification(
      window,
      run.sessionId,
      replyNotificationBody(run.text),
    );
    if (process.platform === "darwin") {
      app.dock?.bounce("informational");
    } else if (process.platform === "win32") {
      window.flashFrame(true);
    }
  }
}

import { toast } from "vue-sonner";

export interface ErrorNotification {
  description?: string;
  id: string;
  title: string;
}

/**
 * What went wrong, readable under a toast's title: the error's own message,
 * without the wrapper Electron adds to a main-process rejection
 * ("Error invoking remote method '…': Error: …").
 */
export function errorReason(error: unknown): string | undefined {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;
  const reason = message
    ?.replace(/^Error invoking remote method '[^']*': /, "")
    .replace(/^[A-Za-z]*Error: /, "")
    .trim();
  return reason || undefined;
}

export function handleError(
  error: unknown,
  notification: ErrorNotification,
): void {
  console.error(`[Pine] ${notification.id}`, error);
  toast.error(notification.title, {
    description: notification.description,
    id: notification.id,
  });
}

import { useI18n } from "vue-i18n";
import type { AutomationRunStatus } from "@/shared/automation";

/** Badge variant for a run's status, shared by every run list. */
export function runStatusVariant(
  status: AutomationRunStatus,
): "default" | "secondary" | "destructive" {
  return status === "failed" || status === "interrupted"
    ? "destructive"
    : status === "findings"
      ? "default"
      : "secondary";
}

/** Short date and time in the interface language. */
export function useAutomationTime(): (value: string) => string {
  const { locale } = useI18n();
  return (value) =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
}

import { useI18n } from "vue-i18n";
import type { PineUser } from "@/shared/users";

/** The primary user shows a localized name until someone names them. */
export function useUserDisplayName() {
  const { t } = useI18n();
  return (user: Pick<PineUser, "name"> | null | undefined) =>
    user ? user.name || t("users.fallbackName") : "";
}

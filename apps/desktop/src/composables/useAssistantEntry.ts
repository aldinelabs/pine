import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useAssistantStore } from "@/stores/assistant";
import { useContentTabsStore } from "@/stores/contentTabs";

/**
 * Opens the Assistant's one tab. Its project follows the usual rule: when
 * another window shows it, that window comes forward instead.
 */
export function useAssistantEntry() {
  const { t } = useI18n();
  const assistant = useAssistantStore();
  const contentTabs = useContentTabsStore();
  const tabNavigation = useContentTabNavigation();

  async function openAssistant(): Promise<void> {
    try {
      const state = await assistant.load();
      tabNavigation.activate(contentTabs.openAssistant(state.session).id);
    } catch (error) {
      handleError(error, {
        id: "assistant.open",
        title: t("errors.assistantOpen.title"),
        description: t("errors.assistantOpen.description"),
      });
    }
  }

  return { openAssistant };
}

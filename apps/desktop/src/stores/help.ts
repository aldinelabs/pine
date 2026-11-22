import { defineStore } from "pinia";
import { ref } from "vue";
import type { HelpTopicId } from "@/app/help";

/**
 * The guide open in the window's one tutorial dialog, if any, and whether
 * the Guides overview is open. A guide opened from the overview stacks on
 * top of it, so closing the guide returns to the list.
 */
export const useHelpStore = defineStore("help", () => {
  const topicId = ref<HelpTopicId | null>(null);
  const step = ref(0);
  const isOverviewOpen = ref(false);

  function openTopic(id: HelpTopicId, atStep = 0): void {
    topicId.value = id;
    step.value = Math.max(0, Math.floor(atStep));
  }

  function close(): void {
    topicId.value = null;
  }

  function openOverview(): void {
    isOverviewOpen.value = true;
  }

  function closeOverview(): void {
    isOverviewOpen.value = false;
  }

  return {
    topicId,
    step,
    isOverviewOpen,
    openTopic,
    close,
    openOverview,
    closeOverview,
  };
});

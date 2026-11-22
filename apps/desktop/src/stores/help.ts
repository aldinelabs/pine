import { defineStore } from "pinia";
import { ref } from "vue";
import type { HelpTopicId } from "@/app/help";

/** The guide open in the window's one tutorial dialog, if any. */
export const useHelpStore = defineStore("help", () => {
  const topicId = ref<HelpTopicId | null>(null);
  const step = ref(0);

  function openTopic(id: HelpTopicId, atStep = 0): void {
    topicId.value = id;
    step.value = Math.max(0, Math.floor(atStep));
  }

  function close(): void {
    topicId.value = null;
  }

  return { topicId, step, openTopic, close };
});

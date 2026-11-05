<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSideChat } from "@/composables/useSideChat";
import {
  SIDE_CHAT_PANEL,
  WORKBENCH_CARD_PANELS,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useSessionStore } from "@/stores/session";

/** The card's title, which switches the panel it shows. */
const props = defineProps<{
  panel: WorkbenchPanel;
  position: WorkbenchPosition;
  /** The title, when it says more than the panel's name. */
  label?: string;
}>();
const { t } = useI18n();
const sessionStore = useSessionStore();
const sideChat = useSideChat();

/** A side chat needs a conversation to fork. */
const panels = computed(() =>
  WORKBENCH_CARD_PANELS.filter(
    (panel) =>
      panel !== SIDE_CHAT_PANEL ||
      panel === props.panel ||
      Boolean(sessionStore.activeSession),
  ),
);

const selected = computed({
  get: () => props.panel,
  set: (panel: unknown) => {
    const next = panels.value.find((option) => option === panel);
    if (next && next !== props.panel)
      void sideChat.showPanel(props.position, next);
  },
});
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="shrink-0"
        data-testid="workbench-card-switch"
        :aria-label="t('project.workbench.switchPanel')"
      >
        {{ label ?? t(`project.workbench.panels.${panel}`) }}
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuRadioGroup v-model="selected">
        <DropdownMenuRadioItem
          v-for="option in panels"
          :key="option"
          :value="option"
        >
          {{ t(`project.workbench.panels.${option}`) }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

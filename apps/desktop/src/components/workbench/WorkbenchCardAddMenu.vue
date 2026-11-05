<script setup lang="ts">
import { PlusIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useWorkbenchStore } from "@/stores/workbench";

/** A single card can take a second one below it. */
const props = defineProps<{
  panel: WorkbenchPanel;
  position: WorkbenchPosition;
}>();
const { t } = useI18n();
const workbench = useWorkbenchStore();
const sessionStore = useSessionStore();
const sideChat = useSideChat();

const addablePanels = computed(() =>
  props.position === "top" && !workbench.activeLayout.bottom
    ? WORKBENCH_CARD_PANELS.filter(
        (panel) =>
          panel !== props.panel &&
          // A side chat needs a conversation to fork.
          (panel !== SIDE_CHAT_PANEL || Boolean(sessionStore.activeSession)),
      )
    : [],
);
</script>

<template>
  <DropdownMenu v-if="addablePanels.length">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        data-testid="workbench-card-add"
        :aria-label="t('project.workbench.addCard')"
        :title="t('project.workbench.addCard')"
      >
        <PlusIcon aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        v-for="option in addablePanels"
        :key="option"
        @select="sideChat.showPanel('bottom', option)"
      >
        {{ t(`project.workbench.panels.${option}`) }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

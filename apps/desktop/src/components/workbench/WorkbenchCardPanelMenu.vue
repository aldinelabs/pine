<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
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
  LIVE_CONTEXT_PANEL,
  SIDE_CHAT_PANEL,
  WORKBENCH_CARD_PANELS,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useLiveContextStore } from "@/stores/liveContext";
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
const liveContext = useLiveContextStore();
const sideChat = useSideChat();

/** Panels still in beta carry a badge beside their name. */
function isBeta(panel: WorkbenchPanel): boolean {
  return panel === LIVE_CONTEXT_PANEL;
}

/** A side chat needs a conversation to fork. */
const panels = computed(() =>
  WORKBENCH_CARD_PANELS.filter(
    (panel) =>
      panel === props.panel ||
      ((panel !== SIDE_CHAT_PANEL || Boolean(sessionStore.activeSession)) &&
        (panel !== LIVE_CONTEXT_PANEL || liveContext.available)),
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
        <Badge
          v-if="isBeta(panel)"
          variant="outline"
          class="text-muted-foreground px-1.5 tracking-wide uppercase"
          data-testid="workbench-panel-beta"
        >
          {{ t("project.workbench.beta") }}
        </Badge>
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
          <!-- One line of text with the badge, so a narrow menu moves the
               badge to the next line rather than splitting the name. -->
          <span>
            {{ t(`project.workbench.panels.${option}`) }}
            <Badge
              v-if="isBeta(option)"
              variant="outline"
              class="text-muted-foreground ml-1 inline-flex px-1.5 align-middle tracking-wide uppercase"
            >
              {{ t("project.workbench.beta") }}
            </Badge>
          </span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

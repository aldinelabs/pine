<script setup lang="ts">
import {
  CircleGaugeIcon,
  CpuIcon,
  FolderLockIcon,
  HandIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  ShrinkIcon,
  SlidersHorizontalIcon,
  WandSparklesIcon,
  BrainIcon,
  GitForkIcon,
  PanelRightIcon,
  UserCogIcon,
  LibraryIcon,
  BlocksIcon,
  WorkflowIcon,
  SparklesIcon,
} from "@lucide/vue";
import OrchestratorIcon from "@/components/assistant/OrchestratorIcon.vue";
import { storeToRefs } from "pinia";
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import {
  HELP_TOPIC_GROUPS,
  resolveHelpTopic,
  type HelpTopicId,
} from "@/app/help";
import type { AppLocale } from "@/app/i18n";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { useHelpStore } from "@/stores/help";

/**
 * Guides: every guide in one list, grouped from first steps to the settings
 * explained. A guide opens on top of the list, so closing it comes back
 * here.
 */
const { t, locale } = useI18n();
const help = useHelpStore();
const { isOverviewOpen } = storeToRefs(help);

const TOPIC_ICONS: Record<HelpTopicId, Component> = {
  "approval-modes": ShieldCheckIcon,
  models: CpuIcon,
  "context-window": CircleGaugeIcon,
  "steer-stop": HandIcon,
  "reasoning-effort": SlidersHorizontalIcon,
  "project-folders": FolderLockIcon,
  "auto-approval-path": ShieldQuestionIcon,
  "compaction-strategy": ShrinkIcon,
  "compaction-method": WandSparklesIcon,
  memory: BrainIcon,
  "sub-sessions": GitForkIcon,
  assistant: OrchestratorIcon,
  workbench: PanelRightIcon,
  "work-style": UserCogIcon,
  skills: LibraryIcon,
  mcp: BlocksIcon,
  automations: WorkflowIcon,
  "best-practices": SparklesIcon,
};

const groups = computed(() =>
  HELP_TOPIC_GROUPS.filter((group) => group.topics.length > 0).map((group) => ({
    id: group.id,
    topics: group.topics.map((id) => ({
      ...resolveHelpTopic(id, locale.value as AppLocale),
      icon: TOPIC_ICONS[id],
    })),
  })),
);

const open = computed({
  get: () => isOverviewOpen.value,
  set: (value: boolean) => {
    if (!value) help.closeOverview();
  },
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="help-overview"
      :class="[
        'flex max-h-[min(85vh,40rem)] flex-col sm:max-w-lg',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{ t("help.guides") }}</DialogTitle>
        <DialogDescription>{{ t("help.guidesDescription") }}</DialogDescription>
      </DialogHeader>

      <DialogScrollArea
        class="min-h-0 flex-1"
        viewport-class="scroll-fade-y"
        content-class="flex flex-col gap-5 pb-1 text-pretty [line-break:strict]"
      >
        <section
          v-for="group in groups"
          :key="group.id"
          :data-group="group.id"
          class="flex flex-col gap-1"
        >
          <h3 class="text-muted-foreground px-3.5 text-xs font-medium">
            {{ t(`help.groups.${group.id}`) }}
          </h3>
          <ItemGroup class="gap-0.5">
            <Item
              v-for="topic in group.topics"
              :key="topic.id"
              as="button"
              type="button"
              size="sm"
              :lang="topic.locale"
              :data-topic="topic.id"
              aria-haspopup="dialog"
              class="hover:bg-accent text-start"
              @click="help.openTopic(topic.id)"
            >
              <ItemMedia variant="icon">
                <component
                  :is="topic.icon"
                  class="text-muted-foreground"
                  aria-hidden="true"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{{ topic.title }}</ItemTitle>
                <ItemDescription class="line-clamp-2">
                  {{ topic.summary }}
                </ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </section>
      </DialogScrollArea>
    </DialogContent>
  </Dialog>
</template>

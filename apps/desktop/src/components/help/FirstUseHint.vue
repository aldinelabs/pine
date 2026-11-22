<script setup lang="ts">
import { LightbulbIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, type HTMLAttributes } from "vue";
import { useI18n } from "vue-i18n";
import type { HelpTopicId } from "@/app/help";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useFirstUseHintsStore,
  type FirstUseHintId,
} from "@/stores/firstUseHints";
import { useHelpStore } from "@/stores/help";

/**
 * A one-time hint: one line of text with Show me and Got it, set into the
 * interface right where a feature first appears. Either button dismisses it
 * for good. A window shows one hint at a time (see the store).
 */
const props = defineProps<{
  id: FirstUseHintId;
  text: string;
  guide: { topic: HelpTopicId; step?: number };
  class?: HTMLAttributes["class"];
}>();

const { t } = useI18n();
const hints = useFirstUseHintsStore();
const help = useHelpStore();
const holder = Symbol(props.id);

hints.claim(props.id, holder);
onBeforeUnmount(() => hints.release(holder));

const isShown = computed(() => hints.shows(holder));

function showGuide(): void {
  hints.dismiss(props.id);
  help.openTopic(props.guide.topic, props.guide.step);
}
</script>

<template>
  <div
    v-if="isShown"
    data-slot="first-use-hint"
    :data-hint="id"
    role="note"
    :class="
      cn(
        'bg-muted text-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl py-2 ps-3 pe-2 text-sm text-pretty [line-break:strict]',
        props.class,
      )
    "
  >
    <span class="flex min-w-0 flex-[1_1_12rem] items-start gap-2">
      <LightbulbIcon
        class="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <span>{{ text }}</span>
    </span>
    <span class="ms-auto flex shrink-0 items-center gap-1">
      <Button
        data-testid="first-use-hint-guide"
        type="button"
        variant="outline"
        size="xs"
        aria-haspopup="dialog"
        @click="showGuide"
      >
        {{ t("help.hintShowGuide") }}
      </Button>
      <Button
        data-testid="first-use-hint-dismiss"
        type="button"
        variant="ghost"
        size="xs"
        @click="hints.dismiss(id)"
      >
        {{ t("help.hintDismiss") }}
      </Button>
    </span>
  </div>
</template>

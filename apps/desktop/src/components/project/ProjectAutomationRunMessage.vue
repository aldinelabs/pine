<script setup lang="ts">
import { ChevronRightIcon, WorkflowIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { AutomationRunMessage } from "@/shared/automationRunMessage";

const props = defineProps<{ run: AutomationRunMessage }>();

const { t, locale } = useI18n();
const showInstructions = ref(false);
const startedAt = computed(() => {
  const date = new Date(props.run.startedAt);
  return Number.isNaN(date.getTime())
    ? props.run.startedAt
    : new Intl.DateTimeFormat(locale.value, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
});
</script>

<template>
  <!-- The run's rules for the agent stay out of view; the user sees which
       automation started this conversation and what it was asked to do. -->
  <Collapsible
    v-model:open="showInstructions"
    as-child
    data-slot="automation-run-message"
  >
    <Item variant="outline" class="w-full">
      <ItemMedia variant="icon"><WorkflowIcon /></ItemMedia>
      <ItemContent>
        <ItemTitle>{{ run.name }}</ItemTitle>
        <ItemDescription>
          {{ t("project.transcript.automationRun.started") }} ·
          {{ t(`automations.trigger.${run.trigger}`) }} · {{ startedAt }}
        </ItemDescription>
      </ItemContent>
      <ItemFooter class="flex-col items-stretch gap-2">
        <CollapsibleTrigger
          class="flex w-fit cursor-pointer items-center gap-1 text-xs text-muted-foreground"
        >
          <ChevronRightIcon
            class="size-3.5 transition-transform"
            :class="showInstructions && 'rotate-90'"
            aria-hidden="true"
          />
          {{ t("automations.instructions") }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p
            data-slot="automation-run-instructions"
            class="text-sm whitespace-pre-wrap"
          >
            {{ run.instructions }}
          </p>
        </CollapsibleContent>
      </ItemFooter>
    </Item>
  </Collapsible>
</template>

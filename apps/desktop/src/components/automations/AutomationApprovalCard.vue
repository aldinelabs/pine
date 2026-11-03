<script setup lang="ts">
import { TriangleAlertIcon, WorkflowIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  AutomationApprovalRequest,
  AutomationWarning,
} from "@/shared/automation";
import { useAutomationsStore } from "@/stores/automations";
import AutomationFactsList from "./AutomationFactsList.vue";

const props = defineProps<{ approval: AutomationApprovalRequest }>();

const { t } = useI18n();
const store = useAutomationsStore();
const showScripts = ref(false);
const responding = computed(() =>
  store.respondingIds.has(props.approval.requestId),
);
const scripts = computed(() =>
  props.approval.facts.triggers.flatMap((trigger) =>
    trigger.kind === "script" ? [trigger.source] : [],
  ),
);

function warning(item: AutomationWarning): string {
  switch (item.code) {
    case "network-execution":
      return t("automations.warnings.networkExecution", {
        hosts: item.hosts.join(", "),
      });
    default:
      return t(`automations.warnings.${item.code}`);
  }
}
</script>

<template>
  <Card
    data-testid="automation-approval-card"
    class="mx-auto w-full max-w-3xl gap-3 border-primary/40 py-4"
  >
    <CardHeader class="px-4">
      <CardTitle class="flex items-center gap-2 text-base">
        <WorkflowIcon class="size-4" aria-hidden="true" />
        {{ t(`automations.approval.title.${approval.kind}`) }}:
        {{ approval.facts.name }}
      </CardTitle>
      <CardDescription>{{
        t("automations.approval.description", { project: approval.projectName })
      }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3 px-4">
      <p
        v-if="approval.explanation"
        class="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
      >
        {{ approval.explanation }}
        <span class="mt-1 block text-xs text-muted-foreground">{{
          t("automations.approval.explanationNote")
        }}</span>
      </p>
      <ul
        v-if="approval.warnings.length"
        class="flex flex-col gap-1 text-sm text-amber-700 dark:text-amber-400"
      >
        <li
          v-for="item in approval.warnings"
          :key="item.code"
          class="flex gap-2"
        >
          <TriangleAlertIcon
            class="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>{{ warning(item) }}</span>
        </li>
      </ul>
      <AutomationFactsList
        :facts="approval.facts"
        :previous="approval.previousFacts"
      />
      <Collapsible v-if="scripts.length" v-model:open="showScripts">
        <CollapsibleTrigger as-child>
          <Button variant="link" size="sm" class="h-auto px-0">{{
            showScripts
              ? t("automations.approval.hideScript")
              : t("automations.approval.showScript")
          }}</Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre
            v-for="(source, index) in scripts"
            :key="index"
            class="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
            >{{ source }}</pre>
        </CollapsibleContent>
      </Collapsible>
    </CardContent>
    <CardFooter class="justify-end gap-2 px-4">
      <template v-if="store.canApprove">
        <Button
          variant="outline"
          :disabled="responding"
          @click="store.respond(approval.requestId, false)"
          >{{ t("automations.approval.reject") }}</Button
        >
        <Button
          :disabled="responding"
          @click="store.respond(approval.requestId, true)"
          >{{ t(`automations.approval.approve.${approval.kind}`) }}</Button
        >
      </template>
      <p v-else class="text-sm text-muted-foreground">
        {{ t("automations.approval.desktopOnly") }}
      </p>
    </CardFooter>
  </Card>
</template>

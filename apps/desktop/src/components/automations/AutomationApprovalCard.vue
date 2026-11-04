<script setup lang="ts">
import { ArrowUpIcon, TriangleAlertIcon } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useShortcutHints } from "@/composables/useShortcutHints";
import type {
  AutomationApprovalRequest,
  AutomationWarning,
} from "@/shared/automation";
import { useAutomationsStore } from "@/stores/automations";
import AutomationFactsList from "./AutomationFactsList.vue";

const props = defineProps<{
  approval: AutomationApprovalRequest;
  /** Keyboard shortcuts only apply where the card replaces the composer. */
  isActive?: boolean;
}>();

const { t } = useI18n();
const store = useAutomationsStore();
const showShortcutHints = useShortcutHints();
const showScripts = ref(false);
const guidance = ref("");
const guiding = ref(false);
const guidanceInput = ref<{ $el: HTMLInputElement } | null>(null);
const responding = computed(() =>
  store.respondingIds.has(props.approval.requestId),
);
const shortcuts = computed(() => props.isActive === true && store.canApprove);
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
    case "mcp-outside-sandbox":
      return t("automations.warnings.mcpOutsideSandbox", {
        servers: item.servers.join(", "),
      });
    default:
      return t(`automations.warnings.${item.code}`);
  }
}

function respond(approve: boolean, guidanceText?: string): void {
  if (responding.value || !store.canApprove) return;
  void store.respond(props.approval.requestId, approve, guidanceText);
}

/** Rejects and tells the agent what to do instead, as tool approvals do. */
function submitGuidance(): void {
  const guidanceText = guidance.value.trim();
  if (guidanceText) respond(false, guidanceText);
}

async function startGuidance(): Promise<void> {
  guiding.value = true;
  await nextTick();
  guidanceInput.value?.$el?.focus();
}

function handleShortcut(event: KeyboardEvent): void {
  if (!shortcuts.value || guiding.value) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.defaultPrevented) return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    respond(true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    respond(false);
  } else if (event.key === "/") {
    event.preventDefault();
    void startGuidance();
  }
}

onMounted(() => window.addEventListener("keydown", handleShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", handleShortcut));
</script>

<template>
  <Card
    data-testid="automation-approval-card"
    class="max-h-[min(28rem,60dvh)] min-h-0"
  >
    <CardHeader class="shrink-0">
      <CardTitle
        >{{ t(`automations.approval.title.${approval.kind}`) }}:
        {{ approval.facts.name }}</CardTitle
      >
      <CardDescription>{{
        t("automations.approval.description", { project: approval.projectName })
      }}</CardDescription>
    </CardHeader>
    <CardContent
      class="scroll-fade-y flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain"
    >
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
      <div v-if="approval.explanation" class="flex flex-col gap-1">
        <p class="text-sm whitespace-pre-wrap">{{ approval.explanation }}</p>
        <p class="text-xs text-muted-foreground">
          {{ t("automations.approval.explanationNote") }}
        </p>
      </div>
      <AutomationFactsList
        class="rounded-lg bg-muted/60 px-3 py-2"
        :facts="approval.facts"
        :previous="approval.previousFacts"
      />
      <Collapsible v-if="scripts.length" v-model:open="showScripts">
        <CollapsibleTrigger
          class="cursor-pointer text-xs text-muted-foreground"
          >{{
            showScripts
              ? t("automations.approval.hideScript")
              : t("automations.approval.showScript")
          }}</CollapsibleTrigger
        >
        <CollapsibleContent>
          <pre
            v-for="(source, index) in scripts"
            :key="index"
            class="mt-1 overflow-x-auto rounded-lg bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
            >{{ source }}</pre>
        </CollapsibleContent>
      </Collapsible>
    </CardContent>
    <CardFooter class="mt-auto shrink-0 gap-2">
      <div v-if="store.canApprove && guiding" class="relative flex-1">
        <Input
          ref="guidanceInput"
          v-model="guidance"
          class="min-h-12 pr-16"
          :placeholder="t('project.approvalRequest.guide')"
          @keydown.enter.exact.prevent="submitGuidance"
          @keydown.escape.prevent="guiding = false"
        />
        <div class="absolute inset-y-0 right-2 flex items-center">
          <Button
            type="button"
            size="sm"
            class="h-8 gap-1 px-2 text-xs"
            :disabled="!guidance.trim() || responding"
            :aria-label="t('project.approvalRequest.guide')"
            @click="submitGuidance"
          >
            <ArrowUpIcon />
            <Kbd v-if="showShortcutHints && !guidance" aria-hidden="true"
              >↵</Kbd
            >
          </Button>
        </div>
      </div>
      <template v-else-if="store.canApprove">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="responding"
          @click="startGuidance"
        >
          {{ t("project.approvalRequest.guide") }}
          <Kbd v-if="showShortcutHints && shortcuts" aria-hidden="true">/</Kbd>
        </Button>
        <div class="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="responding"
            @click="respond(false)"
          >
            {{ t("automations.approval.reject") }}
            <Kbd v-if="showShortcutHints && shortcuts" aria-hidden="true"
              >esc</Kbd
            >
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="responding"
            @click="respond(true)"
          >
            {{ t(`automations.approval.approve.${approval.kind}`) }}
            <Kbd v-if="showShortcutHints && shortcuts" aria-hidden="true"
              >↵</Kbd
            >
          </Button>
        </div>
      </template>
      <p v-else class="text-sm text-muted-foreground">
        {{ t("automations.approval.desktopOnly") }}
      </p>
    </CardFooter>
  </Card>
</template>

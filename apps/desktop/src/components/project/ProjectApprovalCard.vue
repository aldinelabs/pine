<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowUpIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import type { PineApprovalAction } from "@/shared/agent";
import type { PinePendingApproval } from "@/stores/session";

const props = defineProps<{
  approval: PinePendingApproval;
  isActive?: boolean;
  isResponding?: boolean;
}>();

const emit = defineEmits<{
  respond: [action: PineApprovalAction, guidance?: string];
}>();

const { t } = useI18n();
const guidance = ref("");
const guiding = ref(false);
// The Input component forwards its root element through `$el`; typing the
// wrapper keeps the focus call honest on both sides.
const guidanceInput = ref<{ $el: HTMLInputElement } | null>(null);

const triggerKey = computed(() => {
  switch (props.approval.trigger) {
    case "pre-execution":
      return "triggerPreExecution";
    case "sandbox-denied":
      return "triggerSandboxDenied";
    case "authorize-denied":
      return "triggerAuthorizeDenied";
    case "destructive-pattern":
      return "triggerDestructivePattern";
    case "privileged-execution":
      return "triggerPrivilegedExecution";
  }
});

function respond(action: PineApprovalAction, guidanceText?: string): void {
  if (props.isResponding) return;
  emit("respond", action, guidanceText);
}

function submitGuidance(): void {
  const guidanceText = guidance.value.trim();
  if (guidanceText) respond("guide", guidanceText);
}

// While the guidance input is open the keys are regular text; the
// shortcuts only apply to the decision buttons.
function handleShortcut(event: KeyboardEvent): void {
  if (props.isActive === false) return;
  if (guiding.value || event.metaKey || event.ctrlKey || event.altKey) return;
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
    respond("approve");
  } else if (event.key === "Escape") {
    event.preventDefault();
    respond("reject");
  } else if (event.key === "/") {
    event.preventDefault();
    void startGuidance();
  }
}

onMounted(() => window.addEventListener("keydown", handleShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", handleShortcut));

async function startGuidance(): Promise<void> {
  guiding.value = true;
  await nextTick();
  guidanceInput.value?.$el?.focus();
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ t("project.approvalRequest.title") }}</CardTitle>
      <CardDescription>
        {{ t(`project.approvalRequest.${triggerKey}`) }}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <!-- What is being approved sits between the header and the decision so
           the choice is made with the evidence in view. -->
      <div
        v-if="approval.description || approval.subject"
        class="flex flex-col gap-2"
      >
        <p v-if="approval.description" class="text-sm">
          {{ approval.description }}
        </p>
        <div
          v-if="approval.subject"
          class="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap"
        >
          {{ approval.subject }}
        </div>
      </div>
      <details v-if="approval.evidence">
        <summary class="cursor-pointer text-xs text-muted-foreground">
          {{ t("project.approvalRequest.evidence") }}
        </summary>
        <pre
          class="mt-1 overflow-x-auto rounded-lg bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
          >{{ approval.evidence }}</pre>
      </details>
    </CardContent>
    <CardFooter class="mt-auto gap-2">
      <!-- Decisions as compact buttons with their shortcut keys; the
           freeform guidance swaps the whole group for an input. -->
      <template v-if="guiding">
        <div class="relative flex-1">
          <Input
            ref="guidanceInput"
            v-model="guidance"
            class="min-h-12 pr-16"
            :placeholder="t('project.approvalRequest.guide')"
            @keydown.enter.exact.prevent="submitGuidance"
          />
          <div class="absolute inset-y-0 right-2 flex items-center">
            <Button
              type="button"
              size="sm"
              class="h-8 gap-1 px-2 text-xs"
              :disabled="!guidance.trim() || props.isResponding"
              :aria-label="t('project.approvalRequest.guide')"
              @click="submitGuidance"
            >
              <ArrowUpIcon />
              <Kbd v-if="!guidance" aria-hidden="true">↵</Kbd>
            </Button>
          </div>
        </div>
      </template>
      <template v-else>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="props.isResponding"
          @click="startGuidance"
        >
          {{ t("project.approvalRequest.guide") }}
          <Kbd aria-hidden="true">/</Kbd>
        </Button>
        <div class="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="props.isResponding"
            @click="respond('reject')"
          >
            {{ t("project.approvalRequest.reject") }}
            <Kbd aria-hidden="true">esc</Kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="props.isResponding"
            @click="respond('approve')"
          >
            {{ t("project.approvalRequest.approve") }}
            <Kbd aria-hidden="true">↵</Kbd>
          </Button>
        </div>
      </template>
    </CardFooter>
  </Card>
</template>

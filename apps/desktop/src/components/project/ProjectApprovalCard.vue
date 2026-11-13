<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronRightIcon, TriangleAlertIcon } from "@lucide/vue";
import ApprovalGuidanceComposer from "@/components/approval/ApprovalGuidanceComposer.vue";
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
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useShortcutHints } from "@/composables/useShortcutHints";
import { approvalReasonText } from "@/lib/approvalReasons";
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

const i18n = useI18n();
const { t } = i18n;

// Pine's own note on why the call reached the user follows the gate's
// evidence, in the interface language.
const evidence = computed(() =>
  [
    props.approval.evidence,
    props.approval.reasonCode
      ? approvalReasonText(
          {
            reasonCode: props.approval.reasonCode,
            reasonDetail: props.approval.reasonDetail,
          },
          t,
        )
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n"),
);
const showShortcutHints = useShortcutHints();
const guidance = ref("");
const guiding = ref(false);
// Decided once: an inline explanation starts with the parameters collapsed; a
// late one leaves them expanded so nothing moves away under the reader. With
// no explanation view (none arrived) they are forced open: the trigger is
// hidden then, so the raw parameters must never stay collapsed.
const showParameters = ref(!props.approval.explanation);
const hasExplanationView = computed(
  () =>
    Boolean(props.approval.explanation) ||
    props.approval.explanationPending === true,
);

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
    case "long-context-activation":
      return "triggerLongContextActivation";
  }
});

// Both answers carry the user's intent forward, so the decision buttons name
// what happens next and the "reject with guidance" path does not apply.
const isActivationChoice = computed(
  () => props.approval.trigger === "long-context-activation",
);

function respond(action: PineApprovalAction, guidanceText?: string): void {
  if (props.isResponding) return;
  emit("respond", action, guidanceText);
}

// While the guidance input is open the keys are regular text; the
// shortcuts only apply to the decision buttons.
function handleShortcut(event: KeyboardEvent): void {
  if (props.isActive === false) return;
  if (guiding.value || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return;
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
    respond(isActivationChoice.value ? "abort" : "reject");
  } else if (event.key === "/" && !isActivationChoice.value) {
    event.preventDefault();
    startGuidance();
  }
}

onMounted(() => window.addEventListener("keydown", handleShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", handleShortcut));

function startGuidance(): void {
  guiding.value = true;
}
</script>

<template>
  <Card class="max-h-[min(28rem,60dvh)] min-h-0">
    <CardHeader class="shrink-0">
      <CardTitle>{{ t("project.approvalRequest.title") }}</CardTitle>
      <CardDescription>
        <span
          v-if="approval.autoApprovalFailure"
          class="mb-1 flex items-center gap-1.5 text-foreground"
          role="status"
        >
          <TriangleAlertIcon class="size-4 shrink-0" aria-hidden="true" />
          {{ t("project.approvalRequest.autoApprovalFallback") }}
        </span>
        {{ t(`project.approvalRequest.${triggerKey}`) }}
      </CardDescription>
    </CardHeader>
    <CardContent
      class="scroll-fade-y flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain"
    >
      <!-- What is being approved sits between the header and the decision so
           the choice is made with the evidence in view. -->
      <div v-if="isActivationChoice" class="flex flex-col gap-3 text-sm">
        <p class="font-medium">
          {{
            i18n.te(
              `project.approvalRequest.activationTools.${approval.toolName}`,
            )
              ? t(
                  `project.approvalRequest.activationTools.${approval.toolName}`,
                )
              : approval.toolName
          }}
        </p>
        <p>
          {{
            t("project.approvalRequest.activationWhy", {
              tokens: approval.subject ?? "",
            })
          }}
        </p>
        <ul class="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{{ t("project.approvalRequest.activationNowEffect") }}</li>
          <li>{{ t("project.approvalRequest.activationCompactEffect") }}</li>
        </ul>
      </div>
      <template v-else>
        <!-- Reviewer prose is untrusted model text: plain interpolation only. -->
        <div
          v-if="approval.explanation"
          class="flex flex-col gap-2"
          data-slot="approval-explanation"
        >
          <p class="text-sm">{{ approval.explanation.summary }}</p>
          <div
            v-if="approval.explanation.risks.length > 0"
            class="flex flex-col gap-1"
          >
            <p class="text-xs font-medium">
              {{ t("project.approvalRequest.risks") }}
            </p>
            <ul class="list-disc space-y-1 pl-5 text-sm">
              <li
                v-for="(risk, index) in approval.explanation.risks"
                :key="index"
              >
                {{ risk }}
              </li>
            </ul>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t("project.approvalRequest.explanationNote") }}
          </p>
        </div>
        <p
          v-else-if="approval.explanationPending"
          class="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          data-slot="approval-explanation-loading"
        >
          <Spinner class="size-3.5" aria-hidden="true" />
          {{ t("project.approvalRequest.explanationLoading") }}
        </p>
        <Collapsible
          v-if="approval.description || approval.subject"
          :open="showParameters || !hasExplanationView"
          class="flex flex-col gap-2"
          @update:open="showParameters = $event"
        >
          <CollapsibleTrigger
            v-if="hasExplanationView"
            class="flex w-fit cursor-pointer items-center gap-1 text-xs text-muted-foreground"
          >
            <ChevronRightIcon
              class="size-3.5 transition-transform"
              :class="showParameters && 'rotate-90'"
              aria-hidden="true"
            />
            {{
              t(
                showParameters
                  ? "project.approvalRequest.hideParameters"
                  : "project.approvalRequest.showParameters",
              )
            }}
          </CollapsibleTrigger>
          <CollapsibleContent class="flex flex-col gap-2">
            <p v-if="approval.description" class="text-sm">
              {{ approval.description }}
            </p>
            <div
              v-if="approval.subject"
              class="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap"
            >
              {{ approval.subject }}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
      <details v-if="evidence">
        <summary class="cursor-pointer text-xs text-muted-foreground">
          {{ t("project.approvalRequest.evidence") }}
        </summary>
        <pre
          class="mt-1 overflow-x-auto rounded-lg bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
          >{{ evidence }}</pre>
      </details>
    </CardContent>
    <CardFooter class="mt-auto shrink-0 gap-2">
      <!-- Decisions as compact buttons with their shortcut keys; the
           freeform guidance swaps the whole group for a composer. -->
      <ApprovalGuidanceComposer
        v-if="guiding"
        v-model="guidance"
        :disabled="props.isResponding"
        @submit="respond('guide', $event)"
        @cancel="guiding = false"
      />
      <template v-else>
        <Button
          v-if="isActivationChoice"
          type="button"
          variant="outline"
          size="sm"
          :disabled="props.isResponding"
          @click="respond('abort')"
        >
          {{ t("project.approvalRequest.abortActivation") }}
          <Kbd v-if="showShortcutHints" aria-hidden="true">esc</Kbd>
        </Button>
        <Button
          v-else
          type="button"
          variant="outline"
          size="sm"
          :disabled="props.isResponding"
          @click="startGuidance"
        >
          {{ t("project.approvalRequest.guide") }}
          <Kbd v-if="showShortcutHints" aria-hidden="true">/</Kbd>
        </Button>
        <div class="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="props.isResponding"
            @click="respond(isActivationChoice ? 'compact' : 'reject')"
          >
            {{
              t(
                isActivationChoice
                  ? "project.approvalRequest.compactFirst"
                  : "project.approvalRequest.reject",
              )
            }}
            <Kbd
              v-if="showShortcutHints && !isActivationChoice"
              aria-hidden="true"
              >esc</Kbd
            >
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="props.isResponding"
            @click="respond('approve')"
          >
            {{
              t(
                isActivationChoice
                  ? "project.approvalRequest.activateNow"
                  : "project.approvalRequest.approve",
              )
            }}
            <Kbd v-if="showShortcutHints" aria-hidden="true">↵</Kbd>
          </Button>
        </div>
      </template>
    </CardFooter>
  </Card>
</template>

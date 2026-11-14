<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronRightIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from "@lucide/vue";
import ApprovalAttribution from "@/components/project/ApprovalAttribution.vue";
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
// Decided once at mount: an inline explanation starts with the technical
// details closed; a pending one (shown after the wait window) leaves them open
// so a late explanation never collapses what the reader is looking at.
const showDetails = ref(
  !props.approval.explanation && props.approval.explanationPending === true,
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
// The approval model's account leads; without one (none requested, or none
// arrived) the description and parameters are shown directly.
const explainedView = computed(
  () =>
    !isActivationChoice.value &&
    (Boolean(props.approval.explanation) ||
      props.approval.explanationPending === true),
);

// An MCP server change gets its own plain account: what runs or where it
// connects, where it is available and which credentials it receives.
const mcpChange = computed(() =>
  explainedView.value ? undefined : props.approval.mcpChange,
);
const mcpTitleKey = computed(() => {
  switch (mcpChange.value?.action) {
    case "update":
      return "titleUpdate";
    case "rename":
      return "titleRename";
    case "enable":
      return "titleEnable";
    default:
      return "titleAdd";
  }
});
const showDetailsDisclosure = computed(() =>
  mcpChange.value
    ? Boolean(mcpChange.value.definition)
    : explainedView.value || Boolean(evidence.value),
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
      <CardDescription v-if="approval.autoApprovalFailure || !explainedView">
        <span
          v-if="approval.autoApprovalFailure"
          class="mb-1 flex items-center gap-1.5 text-foreground"
          role="status"
        >
          <TriangleAlertIcon class="size-4 shrink-0" aria-hidden="true" />
          {{ t("project.approvalRequest.autoApprovalFallback") }}
        </span>
        <template v-if="mcpChange">
          {{
            t(`project.approvalRequest.mcp.${mcpTitleKey}`, {
              name: mcpChange.name,
              previousName: mcpChange.previousName ?? "",
            })
          }}
        </template>
        <template v-else-if="!explainedView">
          {{ t(`project.approvalRequest.${triggerKey}`) }}
        </template>
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
      <!-- Reviewer prose is untrusted model text: plain interpolation only. -->
      <template v-else-if="explainedView">
        <p
          v-if="approval.explanation"
          class="text-sm leading-relaxed text-foreground"
          data-slot="approval-summary"
        >
          {{ approval.explanation.summary }}
        </p>
        <p
          v-else
          class="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          data-slot="approval-explanation-loading"
        >
          <Spinner class="size-3.5" aria-hidden="true" />
          {{ t("project.approvalRequest.explanationLoading") }}
        </p>
        <div
          v-if="approval.explanation && approval.explanation.risks.length > 0"
          class="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2"
          data-slot="approval-risks"
        >
          <p
            class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            <ShieldAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
            {{ t("project.approvalRequest.risks") }}
          </p>
          <ul
            class="list-disc space-y-0.5 pl-4 text-sm marker:text-muted-foreground"
          >
            <li
              v-for="(risk, index) in approval.explanation.risks"
              :key="index"
            >
              {{ risk }}
            </li>
          </ul>
        </div>
      </template>
      <div
        v-else-if="mcpChange"
        class="flex flex-col gap-3 text-sm"
        data-slot="approval-mcp-change"
      >
        <p>{{ t("project.approvalRequest.mcp.intro") }}</p>
        <dl class="flex flex-col gap-2.5">
          <div v-if="mcpChange.command" class="flex flex-col gap-1">
            <dt class="text-xs font-medium text-muted-foreground">
              {{ t("project.approvalRequest.mcp.runs") }}
            </dt>
            <dd class="flex flex-col gap-1">
              <code
                class="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
                >{{ mcpChange.command }}</code
              >
              <span class="flex items-center gap-1.5 text-muted-foreground">
                <ShieldAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
                {{ t("project.approvalRequest.mcp.runsNote") }}
              </span>
            </dd>
          </div>
          <div v-else-if="mcpChange.address" class="flex flex-col gap-1">
            <dt class="text-xs font-medium text-muted-foreground">
              {{ t("project.approvalRequest.mcp.connects") }}
            </dt>
            <dd>
              <code
                class="block overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
                >{{ mcpChange.address }}</code
              >
            </dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-xs font-medium text-muted-foreground">
              {{ t("project.approvalRequest.mcp.scope") }}
            </dt>
            <dd>
              {{
                t(
                  mcpChange.scope === "global"
                    ? "project.approvalRequest.mcp.scopeGlobal"
                    : "project.approvalRequest.mcp.scopeProject",
                )
              }}
            </dd>
          </div>
          <div
            v-if="mcpChange.credentials.length > 0"
            class="flex flex-col gap-1"
          >
            <dt class="text-xs font-medium text-muted-foreground">
              {{ t("project.approvalRequest.mcp.credentials") }}
            </dt>
            <dd class="flex flex-wrap items-center gap-1.5">
              <code
                v-for="credential in mcpChange.credentials"
                :key="credential"
                class="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-xs"
                >{{ credential }}</code
              >
              <span class="text-muted-foreground">
                {{ t("project.approvalRequest.mcp.credentialsNote") }}
              </span>
            </dd>
          </div>
        </dl>
      </div>
      <template v-else>
        <p v-if="approval.description" class="text-sm">
          {{ approval.description }}
        </p>
        <div
          v-if="approval.subject"
          class="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap"
        >
          {{ approval.subject }}
        </div>
      </template>
      <!-- One disclosure for everything technical, in every layout. -->
      <Collapsible
        v-if="showDetailsDisclosure"
        v-model:open="showDetails"
        class="flex flex-col gap-2"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
        >
          <CollapsibleTrigger
            class="flex w-fit cursor-pointer items-center gap-1 text-xs text-muted-foreground"
            data-slot="approval-details-trigger"
          >
            <ChevronRightIcon
              class="size-3.5 transition-transform"
              :class="showDetails && 'rotate-90'"
              aria-hidden="true"
            />
            {{ t("project.approvalRequest.details") }}
          </CollapsibleTrigger>
          <ApprovalAttribution v-if="explainedView && approval.explanation" />
        </div>
        <CollapsibleContent
          class="flex flex-col gap-2.5"
          data-slot="approval-details"
        >
          <template v-if="explainedView">
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-muted-foreground">
                {{ t("project.approvalRequest.detailsReason") }}
              </p>
              <p class="text-sm">
                {{ t(`project.approvalRequest.${triggerKey}`) }}
              </p>
            </div>
            <div v-if="approval.description" class="flex flex-col gap-1">
              <p class="text-xs font-medium text-muted-foreground">
                {{ t("project.approvalRequest.detailsDescription") }}
              </p>
              <p class="text-sm">{{ approval.description }}</p>
            </div>
            <div v-if="approval.subject" class="flex flex-col gap-1">
              <p class="text-xs font-medium text-muted-foreground">
                {{ t("project.approvalRequest.detailsParameters") }}
              </p>
              <div
                class="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap"
              >
                {{ approval.subject }}
              </div>
            </div>
          </template>
          <div
            v-if="mcpChange?.definition"
            class="flex flex-col gap-1"
            data-slot="approval-mcp-definition"
          >
            <p class="text-xs font-medium text-muted-foreground">
              {{ t("project.approvalRequest.mcp.definition") }}
            </p>
            <pre
              class="overflow-x-auto rounded-lg bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
              >{{ mcpChange.definition }}</pre>
          </div>
          <div
            v-else-if="evidence"
            class="flex flex-col gap-1"
            data-slot="approval-reviewer-notes"
          >
            <p class="text-xs font-medium text-muted-foreground">
              {{ t("project.approvalRequest.detailsReviewerNotes") }}
            </p>
            <pre
              class="overflow-x-auto rounded-lg bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap"
              >{{ evidence }}</pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
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

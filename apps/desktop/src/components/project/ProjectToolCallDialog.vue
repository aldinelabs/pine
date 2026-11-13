<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ForwardIcon,
  ShieldBanIcon,
  UserRoundIcon,
} from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { Badge, type BadgeVariants } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import { Separator } from "@/components/ui/separator";
import { approvalFailureText, approvalReasonText } from "@/lib/approvalReasons";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import type {
  PineApprovalReview,
  PineApprovalReviewReasonCode,
  PineToolCall,
} from "@/shared/sessions";
import ProjectToolSemanticValue from "./ProjectToolSemanticValue.vue";
import { isDeniedTool } from "./toolKinds";
import { toolViewAdapter } from "./toolViewAdapter";

const props = defineProps<{
  toolCall: PineToolCall;
  reviewing?: boolean;
  awaitingApproval?: boolean;
  openFile?: (
    path: string,
    toolCall: PineToolCall,
  ) => boolean | Promise<boolean>;
}>();

const { t } = useI18n();
const isOpen = ref(false);
// A transcript mounts one of these per tool call; keep the closed dialog's
// content tree unmounted until it is first opened. It stays mounted after
// that so the close animation and later opens behave as before.
const hasOpened = ref(false);
watch(
  isOpen,
  (open) => {
    if (open) hasOpened.value = true;
  },
  { flush: "sync" },
);
const isDenied = computed(() => isDeniedTool(props.toolCall));
const view = computed(() => toolViewAdapter(props.toolCall));
const wideDetails = computed(() =>
  ["edit", "search", "fetch", "fileSearch"].includes(view.value.detail),
);

type StatusKey =
  | "pending"
  | "running"
  | "complete"
  | "error"
  | "reviewing"
  | "awaitingApproval"
  | "autoApprovalDenied"
  | "userApprovalDenied"
  | "sandboxDenied";

const statusKey = computed<StatusKey>(() => {
  if (isDenied.value) {
    const decidedBy = props.toolCall.approval?.decidedBy;
    return decidedBy === "judge"
      ? "autoApprovalDenied"
      : decidedBy === "sandbox"
        ? "sandboxDenied"
        : "userApprovalDenied";
  }
  if (props.reviewing || props.toolCall.approval?.state === "reviewing") {
    return "reviewing";
  }
  if (
    props.awaitingApproval ||
    props.toolCall.approval?.state === "awaiting-user"
  ) {
    return "awaitingApproval";
  }
  return props.toolCall.status;
});

const statusVariant = computed<BadgeVariants["variant"]>(() =>
  statusKey.value === "error"
    ? "destructive"
    : statusKey.value === "complete"
      ? "outline"
      : "secondary",
);

const approvalKey = computed(() => {
  const approval = props.toolCall.approval;
  if (!approval || approval.state === "reviewing") return undefined;
  if (approval.state === "awaiting-user") return "awaitingApproval";
  if (approval.decidedBy === "judge") {
    return approval.state === "approved" ? "autoApproved" : "autoDenied";
  }
  if (approval.decidedBy === "sandbox") {
    return "sandboxDenied";
  }
  return approval.state === "approved" ? "userApproved" : "userDenied";
});

const approvalVariant = computed<BadgeVariants["variant"]>(() =>
  isDenied.value ? "outline" : "secondary",
);

// Each review's result is the part a reader scans for, so it carries its own
// icon and tone; deny matches the warning tone of the denied status badge.
const reviewOutcomeStyles: Record<
  PineApprovalReview["outcome"],
  { icon: Component; class: string }
> = {
  allow: {
    icon: CircleCheckIcon,
    class: "text-emerald-600 dark:text-emerald-400",
  },
  deny: { icon: ShieldBanIcon, class: "text-warning" },
  needs_user: { icon: UserRoundIcon, class: "text-info" },
  fallback: { icon: ForwardIcon, class: "text-muted-foreground" },
  error: { icon: CircleAlertIcon, class: "text-destructive" },
};

// Records saved before reasons carried a code only have the fixed text, in
// English or Chinese; recognise those so older history is localized too.
const legacyReviewReasonCodes: Record<string, PineApprovalReviewReasonCode> = {
  "Decisions requested detailed model review.": "decisionsModelReview",
  "Decisions returned no valid answer for this tool call.": "decisionsNoAnswer",
  "No OpenRouter API key is available for Decisions screening.":
    "decisionsNoApiKey",
  "Decisions screening classified this action as authorized and permitted.":
    "decisionsAllow",
  "Decisions 初筛认为该操作符合用户授权与审批规则。": "decisionsAllow",
  "Decisions screening requests your confirmation of this action's authority and risks.":
    "decisionsNeedsUser",
  "Decisions 初筛建议由你确认此操作的授权与风险。": "decisionsNeedsUser",
};

function reviewReason(review: PineApprovalReview): string | undefined {
  const code =
    review.reasonCode ??
    (review.kind === "decisions" && review.reason
      ? legacyReviewReasonCodes[review.reason]
      : undefined);
  if (code) return t(`project.transcript.toolDetails.reviewReasons.${code}`);
  return review.kind === "model" && review.reason
    ? approvalFailureText(review.reason, t)
    : review.reason;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return t("project.transcript.toolDetails.durationMilliseconds", {
      value: Math.round(durationMs),
    });
  }
  return t("project.transcript.toolDetails.durationSeconds", {
    value: (durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0),
  });
}

async function openDialog(): Promise<void> {
  if (view.value.filePath && props.openFile) {
    try {
      if (await props.openFile(view.value.filePath, props.toolCall)) return;
    } catch {
      // A missing file is an action failure, not a reason to show parameters.
    }
    toast.error(t("project.preview.failedTitle"), {
      description: t("project.preview.failedDescription"),
    });
    return;
  }
  isOpen.value = true;
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <slot :open="openDialog" />
    <DialogContent
      v-if="hasOpened"
      :class="[
        'w-fit min-w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] max-sm:flex max-sm:flex-col max-sm:gap-4',
        wideDetails ? 'sm:max-w-4xl' : 'sm:max-w-2xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader class="pr-12">
        <DialogTitle>{{
          t("project.transcript.toolDetails.title")
        }}</DialogTitle>
        <DialogDescription>
          {{ t("project.transcript.toolDetails.description") }}
        </DialogDescription>
      </DialogHeader>

      <DialogScrollArea class="max-h-[70vh] max-sm:max-h-none max-sm:flex-1">
        <div class="flex min-w-0 flex-col gap-5">
          <dl
            class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm"
          >
            <dt class="text-muted-foreground">
              {{ t("project.transcript.toolDetails.status") }}
            </dt>
            <dd>
              <Badge
                :variant="statusVariant"
                :class="
                  isDenied && 'border-transparent bg-warning/10 text-warning'
                "
              >
                <ShieldBanIcon v-if="isDenied" data-icon="inline-start" />
                {{ t(`project.transcript.toolDetails.statuses.${statusKey}`) }}
              </Badge>
            </dd>

            <template v-if="approvalKey">
              <dt class="text-muted-foreground">
                {{ t("project.transcript.toolDetails.approval") }}
              </dt>
              <dd>
                <Badge
                  :variant="approvalVariant"
                  :class="
                    isDenied && 'border-transparent bg-warning/10 text-warning'
                  "
                >
                  <ShieldBanIcon v-if="isDenied" data-icon="inline-start" />
                  {{
                    t(`project.transcript.toolDetails.approvals.${approvalKey}`)
                  }}
                </Badge>
              </dd>
            </template>

            <dt class="text-muted-foreground">
              {{ t("project.transcript.toolDetails.tool") }}
            </dt>
            <dd class="font-mono">{{ toolCall.name }}</dd>

            <dt class="text-muted-foreground">
              {{ t("project.transcript.toolDetails.callId") }}
            </dt>
            <dd class="truncate font-mono" :title="toolCall.id">
              {{ toolCall.id }}
            </dd>

            <template v-if="toolCall.durationMs !== undefined">
              <dt class="text-muted-foreground">
                {{ t("project.transcript.toolDetails.duration") }}
              </dt>
              <dd>{{ formatDuration(toolCall.durationMs) }}</dd>
            </template>
          </dl>

          <template v-if="toolCall.approval?.reviews?.length">
            <Separator />
            <section class="flex min-w-0 flex-col gap-3" data-approval-reviews>
              <h3 class="text-sm font-medium">
                {{ t("project.transcript.toolDetails.reviewHistory") }}
              </h3>
              <ol class="flex min-w-0 flex-col gap-3">
                <li
                  v-for="(review, index) in toolCall.approval.reviews"
                  :key="index"
                  class="flex min-w-0 flex-col gap-1 text-sm"
                >
                  <p class="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    <span class="text-muted-foreground">
                      {{
                        t(
                          `project.transcript.toolDetails.reviewKinds.${review.kind}`,
                        )
                      }}
                    </span>
                    <span class="text-muted-foreground" aria-hidden="true">
                      ·
                    </span>
                    <span
                      :class="[
                        'inline-flex items-center gap-1 font-semibold',
                        reviewOutcomeStyles[review.outcome].class,
                      ]"
                      :data-review-outcome="review.outcome"
                    >
                      <component
                        :is="reviewOutcomeStyles[review.outcome].icon"
                        class="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {{
                        t(
                          `project.transcript.toolDetails.reviewOutcomes.${review.outcome}`,
                        )
                      }}
                    </span>
                  </p>
                  <p class="break-words">
                    {{
                      review.modelName ||
                      review.modelId ||
                      t("project.transcript.toolDetails.noReviewModel")
                    }}
                  </p>
                  <p
                    v-if="
                      review.providerId || (review.modelName && review.modelId)
                    "
                    class="font-mono text-xs break-all text-muted-foreground"
                  >
                    {{
                      [
                        review.providerId,
                        review.modelName ? review.modelId : undefined,
                      ]
                        .filter(Boolean)
                        .join(" / ")
                    }}
                  </p>
                  <p
                    v-if="reviewReason(review)"
                    class="text-muted-foreground whitespace-pre-wrap break-words"
                    data-review-reason
                  >
                    {{ reviewReason(review) }}
                  </p>
                </li>
              </ol>
            </section>
          </template>

          <template
            v-if="
              toolCall.approval?.state === 'denied' && toolCall.approval.reason
            "
          >
            <Separator />
            <section class="flex flex-col gap-2">
              <h3 class="text-sm font-medium">
                {{ t("project.transcript.toolDetails.rejectionReason") }}
              </h3>
              <pre
                class="overflow-x-auto rounded-xl bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap"
                data-rejection-reason
                >{{ approvalReasonText(toolCall.approval, t) }}</pre>
            </section>
          </template>

          <Separator />
          <section class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">
              {{ t("project.transcript.toolDetails.parameters") }}
            </h3>
            <ProjectToolSemanticValue
              :tool-call="toolCall"
              :view="view.detail"
              section="parameters"
            />
          </section>

          <Separator />
          <section class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">
              {{ t("project.transcript.toolDetails.result") }}
            </h3>
            <ProjectToolSemanticValue
              :tool-call="toolCall"
              :view="view.detail"
              section="result"
            />
          </section>
        </div>
      </DialogScrollArea>
    </DialogContent>
  </Dialog>
</template>

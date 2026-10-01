<script setup lang="ts">
import { computed, ref } from "vue";
import { ShieldBanIcon } from "@lucide/vue";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { PineToolCall } from "@/shared/sessions";
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
const isDenied = computed(() => isDeniedTool(props.toolCall));
const view = computed(() => toolViewAdapter(props.toolCall));
const wideDetails = computed(() =>
  ["edit", "search", "fetch"].includes(view.value.detail),
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
      class="w-fit min-w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
      :class="wideDetails ? 'sm:max-w-4xl' : 'sm:max-w-2xl'"
    >
      <DialogHeader class="pr-12">
        <DialogTitle>{{
          t("project.transcript.toolDetails.title")
        }}</DialogTitle>
        <DialogDescription>
          {{ t("project.transcript.toolDetails.description") }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[70vh] max-w-full min-w-0 pr-4">
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
                >{{ toolCall.approval.reason }}</pre>
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
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>

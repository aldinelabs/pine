<script setup lang="ts">
import { FileJsonIcon, HistoryIcon, PlayIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import { Switch } from "@/components/ui/switch";
import type {
  AutomationDetail,
  AutomationPauseReason,
  AutomationRunSummary,
} from "@/shared/automation";
import { useAutomationsStore } from "@/stores/automations";
import AutomationEditorDialog from "./AutomationEditorDialog.vue";
import AutomationFactsList from "./AutomationFactsList.vue";
import { runStatusVariant, useAutomationTime } from "./automationDisplay";

/** The automation this dialog shows; null closes it. */
const target = defineModel<{ projectId: string; id: string } | null>("target", {
  default: null,
});
const emit = defineEmits<{ openRun: [run: AutomationRunSummary] }>();

const { t } = useI18n();
const store = useAutomationsStore();
const time = useAutomationTime();
const detail = shallowRef<AutomationDetail | null>(null);
const runs = ref<AutomationRunSummary[]>([]);
const deleting = ref(false);
const editing = ref(false);
const isDesktop = computed(() => window.pine.runtime === "desktop");
const open = computed({
  get: () => target.value !== null,
  set: (value) => {
    if (!value) target.value = null;
  },
});

function failed(cause: unknown): void {
  toast.error(cause instanceof Error ? cause.message : String(cause));
}

async function load(): Promise<void> {
  const current = target.value;
  if (!current) return;
  try {
    const identity = { projectId: current.projectId, automationId: current.id };
    const [automation, automationRuns] = await Promise.all([
      window.pine.automations.get(identity),
      window.pine.automations.runs({ ...identity, filter: "all", limit: 20 }),
    ]);
    if (target.value !== current) return;
    detail.value = automation;
    runs.value = automationRuns;
  } catch (cause) {
    failed(cause);
    target.value = null;
  }
}

watch(
  target,
  (current, previous) => {
    if (
      current?.id !== previous?.id ||
      current?.projectId !== previous?.projectId
    )
      detail.value = null;
    void load();
  },
  { immediate: true },
);
watch(
  () => store.revision,
  () => void load(),
);

async function setEnabled(enabled: boolean): Promise<void> {
  if (!detail.value) return;
  try {
    await window.pine.automations.setEnabled({
      projectId: detail.value.projectId,
      automationId: detail.value.id,
      enabled,
    });
  } catch (cause) {
    failed(cause);
  }
}

async function runNow(): Promise<void> {
  if (!detail.value) return;
  try {
    await window.pine.automations.runNow({
      projectId: detail.value.projectId,
      automationId: detail.value.id,
    });
    toast.success(t("automations.started"));
  } catch (cause) {
    failed(cause);
  }
}

async function remove(): Promise<void> {
  if (!detail.value) return;
  try {
    await window.pine.automations.delete({
      projectId: detail.value.projectId,
      automationId: detail.value.id,
    });
    target.value = null;
  } catch (cause) {
    failed(cause);
  }
}

function pauseText(reason: AutomationPauseReason): string {
  switch (reason.code) {
    case "failures":
    case "script-failures":
      return t(`automations.pause.${reason.code}`, { count: reason.count });
    case "permission":
      return t("automations.pause.permission", { detail: reason.detail });
    default:
      return t("automations.pause.secret", { secret: reason.secret });
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="automation-detail"
      :class="[
        'flex h-[min(85vh,44rem)] flex-col sm:max-w-3xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{ detail?.name ?? t("automations.title") }}</DialogTitle>
        <DialogDescription>{{
          detail?.description ?? detail?.projectName ?? ""
        }}</DialogDescription>
      </DialogHeader>

      <DialogScrollArea class="flex-1">
        <div v-if="detail" class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <Badge
              :variant="detail.status === 'active' ? 'default' : 'secondary'"
              >{{ t(`automations.state.${detail.status}`) }}</Badge
            >
            <span
              v-if="detail.pauseReason"
              class="text-sm text-muted-foreground"
              >{{ pauseText(detail.pauseReason) }}</span
            >
            <div class="ml-auto flex items-center gap-2">
              <Switch
                :model-value="detail.status === 'active'"
                :disabled="!isDesktop && detail.status !== 'active'"
                :aria-label="t('automations.enabled')"
                @update:model-value="setEnabled"
              />
              <Button
                variant="outline"
                size="sm"
                :disabled="detail.status !== 'active' || detail.running"
                @click="runNow"
                ><PlayIcon data-icon="inline-start" />{{
                  t("automations.runNow")
                }}</Button
              >
              <Button
                v-if="isDesktop"
                variant="outline"
                size="sm"
                data-testid="automation-edit-definition"
                @click="editing = true"
                ><FileJsonIcon data-icon="inline-start" />{{
                  t("automations.editor.edit")
                }}</Button
              >
              <Button
                v-if="isDesktop"
                variant="outline"
                size="sm"
                @click="deleting = true"
                ><Trash2Icon data-icon="inline-start" />{{
                  t("common.delete")
                }}</Button
              >
            </div>
          </div>
          <AutomationFactsList :facts="detail.facts" />
          <details class="text-sm">
            <summary class="cursor-pointer text-muted-foreground">
              {{ t("automations.instructions") }}
            </summary>
            <p class="mt-2 whitespace-pre-wrap">
              {{ detail.spec.action.instructions }}
            </p>
          </details>
          <ItemGroup v-if="runs.length">
            <Item
              v-for="entry in runs"
              :key="entry.id"
              variant="outline"
              size="sm"
              as="button"
              class="text-left"
              :disabled="!entry.sessionId"
              @click="emit('openRun', entry)"
            >
              <ItemContent>
                <ItemTitle>
                  <Badge :variant="runStatusVariant(entry.status)">{{
                    t(`automations.status.${entry.status}`)
                  }}</Badge>
                  {{ time(entry.startedAt) }}
                </ItemTitle>
                <ItemDescription>{{
                  entry.summary ?? entry.error ?? ""
                }}</ItemDescription>
              </ItemContent>
              <ItemActions
                v-if="!entry.read"
                :aria-label="t('automations.unread')"
              >
                <span class="size-2 rounded-full bg-primary" />
              </ItemActions>
            </Item>
          </ItemGroup>
          <Empty v-else class="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon"><HistoryIcon /></EmptyMedia>
              <EmptyTitle>{{ t("automations.noRuns") }}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      </DialogScrollArea>
    </DialogContent>
  </Dialog>
  <AlertDialog v-model:open="deleting">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("automations.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>{{
          t("automations.deleteDescription", { name: detail?.name ?? "" })
        }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="remove">{{
          t("common.delete")
        }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
  <AutomationEditorDialog
    v-if="detail"
    v-model:open="editing"
    :project-id="detail.projectId"
    :automation="detail"
  />
</template>

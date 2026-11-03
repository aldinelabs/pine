<script setup lang="ts">
import {
  ArrowLeftIcon,
  KeyRoundIcon,
  PinIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "@lucide/vue";
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
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import type {
  AutomationDetail,
  AutomationPauseReason,
  AutomationRunDetail,
  AutomationRunStatus,
  AutomationRunSummary,
  AutomationSecretSummary,
  AutomationSummary,
} from "@/shared/automation";
import { MIN_REDACTED_SECRET_LENGTH } from "@/shared/automationRedaction";
import { useAutomationsStore } from "@/stores/automations";
import AutomationApprovalCard from "./AutomationApprovalCard.vue";
import AutomationFactsList from "./AutomationFactsList.vue";

const props = defineProps<{ projectId: string }>();
const open = defineModel<boolean>("open", { default: false });

const { t, locale } = useI18n();
const store = useAutomationsStore();
const tabNavigation = useContentTabNavigation();
const tab = ref<"activity" | "automations" | "secrets">("activity");
const runs = ref<AutomationRunSummary[]>([]);
const automations = ref<AutomationSummary[]>([]);
const secrets = ref<AutomationSecretSummary[]>([]);
const detail = shallowRef<AutomationDetail | null>(null);
const detailRuns = ref<AutomationRunSummary[]>([]);
const run = shallowRef<AutomationRunDetail | null>(null);
const showAllRuns = ref(false);
const loading = ref(false);
const deleting = ref<AutomationSummary | null>(null);
const secretName = ref("");
const secretValue = ref("");
const secretDescription = ref("");
const editingSecret = ref(false);
const runInBackground = ref(true);
const isDesktop = computed(() => window.pine.runtime === "desktop");

function failed(cause: unknown): void {
  toast.error(cause instanceof Error ? cause.message : String(cause));
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const api = window.pine.automations;
    [runs.value, automations.value, secrets.value] = await Promise.all([
      api.runs({ filter: showAllRuns.value ? "all" : "default", limit: 200 }),
      api.list(),
      api.secrets({ projectId: props.projectId }),
    ]);
    if (detail.value) await openAutomation(detail.value);
    if (run.value && run.value.status === "running") await openRun(run.value);
    if (window.pine.getRunInBackground)
      runInBackground.value = await window.pine.getRunInBackground();
  } catch (cause) {
    failed(cause);
  } finally {
    loading.value = false;
  }
}

watch(
  [open, () => props.projectId, showAllRuns],
  ([isOpen]) => {
    if (isOpen) void load();
  },
  { immediate: true },
);
watch(
  () => store.revision,
  () => {
    if (open.value) void load();
  },
);
watch(
  () => store.reveal,
  (target) => {
    if (!target || !open.value) return;
    if (target.runId)
      void openRun({
        projectId: target.projectId,
        automationId: target.automationId,
        id: target.runId,
      });
    else
      void openAutomation({
        projectId: target.projectId,
        id: target.automationId,
      });
    store.reveal = null;
  },
  { immediate: true },
);

async function openAutomation(
  target: Pick<AutomationSummary, "projectId" | "id">,
): Promise<void> {
  try {
    const identity = { projectId: target.projectId, automationId: target.id };
    [detail.value, detailRuns.value] = await Promise.all([
      window.pine.automations.get(identity),
      window.pine.automations.runs({ ...identity, filter: "all", limit: 20 }),
    ]);
    run.value = null;
  } catch (cause) {
    failed(cause);
  }
}

async function openRun(
  target: Pick<AutomationRunSummary, "projectId" | "automationId" | "id">,
): Promise<void> {
  try {
    run.value = await window.pine.automations.run({
      projectId: target.projectId,
      automationId: target.automationId,
      runId: target.id,
    });
    if (!run.value.read && run.value.status !== "running")
      await window.pine.automations.markRunsRead({
        runIds: [
          {
            projectId: target.projectId,
            automationId: target.automationId,
            runId: target.id,
          },
        ],
      });
  } catch (cause) {
    failed(cause);
  }
}

function back(): void {
  if (run.value && detail.value) run.value = null;
  else {
    run.value = null;
    detail.value = null;
  }
}

async function setEnabled(
  automation: AutomationSummary,
  enabled: boolean,
): Promise<void> {
  try {
    await window.pine.automations.setEnabled({
      projectId: automation.projectId,
      automationId: automation.id,
      enabled,
    });
  } catch (cause) {
    failed(cause);
  }
}

async function runNow(automation: AutomationSummary): Promise<void> {
  try {
    await window.pine.automations.runNow({
      projectId: automation.projectId,
      automationId: automation.id,
    });
    toast.success(t("automations.started"));
  } catch (cause) {
    failed(cause);
  }
}

async function remove(automation: AutomationSummary): Promise<void> {
  try {
    await window.pine.automations.delete({
      projectId: automation.projectId,
      automationId: automation.id,
    });
    detail.value = null;
    run.value = null;
  } catch (cause) {
    failed(cause);
  }
}

async function keep(current: AutomationRunDetail): Promise<void> {
  try {
    await window.pine.automations.keepRun({
      projectId: current.projectId,
      automationId: current.automationId,
      runId: current.id,
      kept: !current.kept,
    });
    run.value = { ...current, kept: !current.kept };
  } catch (cause) {
    failed(cause);
  }
}

async function continueRun(current: AutomationRunDetail): Promise<void> {
  try {
    const result = await window.pine.automations.continueRun({
      projectId: current.projectId,
      automationId: current.automationId,
      runId: current.id,
    });
    const { sessions } = await window.pine.listAllRecentSessions();
    const session = sessions.find((entry) => entry.id === result.sessionId);
    if (session) {
      tabNavigation.openSession(session, result.projectId);
      open.value = false;
    } else toast.success(t("automations.run.continued"));
  } catch (cause) {
    failed(cause);
  }
}

async function markAllRead(): Promise<void> {
  try {
    await window.pine.automations.markRunsRead({ all: true });
  } catch (cause) {
    failed(cause);
  }
}

function beginSecret(secret?: AutomationSecretSummary): void {
  secretName.value = secret?.name ?? "";
  secretDescription.value = secret?.description ?? "";
  secretValue.value = "";
  editingSecret.value = true;
}

async function saveSecret(): Promise<void> {
  try {
    secrets.value = await window.pine.automations.setSecret({
      projectId: props.projectId,
      name: secretName.value.trim(),
      description: secretDescription.value,
      ...(secretValue.value ? { value: secretValue.value } : {}),
    });
    editingSecret.value = false;
    secretValue.value = "";
  } catch (cause) {
    failed(cause);
  }
}

async function deleteSecret(secret: AutomationSecretSummary): Promise<void> {
  try {
    secrets.value = await window.pine.automations.deleteSecret({
      projectId: props.projectId,
      name: secret.name,
    });
  } catch (cause) {
    failed(cause);
  }
}

const statusVariant = (status: AutomationRunStatus) =>
  status === "failed" || status === "interrupted"
    ? "destructive"
    : status === "findings"
      ? "default"
      : "secondary";

function pauseText(reason: AutomationPauseReason): string {
  switch (reason.code) {
    case "failures":
    case "script-failures":
      return t(`automations.pause.${reason.code}`, { count: reason.count });
    case "permission":
      return t("automations.pause.permission", { detail: reason.detail });
    case "secret-removed":
      return t("automations.pause.secret", { secret: reason.secret });
    default:
      return t(`automations.pause.${reason.code}`);
  }
}

function time(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

const shortSecret = computed(
  () =>
    secretValue.value.length > 0 &&
    secretValue.value.length < MIN_REDACTED_SECRET_LENGTH,
);
const pendingApprovals = computed(() =>
  store.approvals.filter((approval) => approval.projectId === props.projectId),
);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="automation-manager"
      :class="[
        'max-h-[85vh] sm:max-w-3xl max-sm:flex max-sm:flex-col',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Button
            v-if="detail || run"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('common.back')"
            @click="back"
            ><ArrowLeftIcon
          /></Button>
          {{
            run
              ? run.automationName
              : detail
                ? detail.name
                : t("automations.title")
          }}
        </DialogTitle>
        <DialogDescription>{{
          t("automations.description")
        }}</DialogDescription>
      </DialogHeader>

      <p
        v-if="isDesktop && !runInBackground"
        class="rounded-md bg-muted px-3 py-2 text-sm"
      >
        {{ t("automations.backgroundNotice") }}
      </p>

      <ScrollArea
        class="max-h-[62vh] max-sm:max-h-none max-sm:min-h-0 max-sm:flex-1"
      >
        <!-- One run -->
        <div v-if="run" class="flex flex-col gap-4 pr-3">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <Badge :variant="statusVariant(run.status)">{{
              t(`automations.status.${run.status}`)
            }}</Badge>
            <span class="text-muted-foreground">{{
              t(`automations.trigger.${run.trigger}`)
            }}</span>
            <span class="text-muted-foreground">{{ time(run.startedAt) }}</span>
            <div class="ml-auto flex gap-2">
              <Button variant="outline" size="sm" @click="keep(run)">
                <PinIcon data-icon="inline-start" />{{
                  run.kept
                    ? t("automations.run.unkeep")
                    : t("automations.run.keep")
                }}
              </Button>
              <Button
                v-if="
                  run.sessionId && !run.continued && run.status !== 'running'
                "
                size="sm"
                @click="continueRun(run)"
                >{{ t("automations.run.continue") }}</Button
              >
            </div>
          </div>
          <p v-if="run.report?.summary" class="text-sm whitespace-pre-wrap">
            {{ run.report.summary }}
          </p>
          <p v-if="run.error" class="text-sm text-destructive">
            {{ run.error }}
          </p>
          <div v-if="run.changedOutputs?.length" class="text-sm">
            <p class="font-medium">{{ t("automations.run.outputs") }}</p>
            <ul class="list-disc pl-5 text-muted-foreground">
              <li v-for="output in run.changedOutputs" :key="output">
                {{ output }}
              </li>
            </ul>
          </div>
          <div v-if="run.eventCount" class="text-sm">
            <p class="font-medium">
              {{ t("automations.run.events", { count: run.eventCount }) }}
            </p>
            <ul class="list-disc pl-5 text-muted-foreground">
              <li v-for="event in run.events.slice(0, 20)" :key="event.id">
                {{
                  event.file
                    ? `${t(`automations.facts.change.${event.file.change}`)} ${event.file.path}`
                    : event.system
                      ? t(`automations.facts.system.${event.system.event}`, {
                          minutes: "",
                        })
                      : event.script
                        ? JSON.stringify(event.script.data).slice(0, 200)
                        : t(`automations.trigger.${event.trigger}`)
                }}
              </li>
            </ul>
          </div>
          <p v-if="run.discardedEvents" class="text-xs text-muted-foreground">
            {{ t("automations.run.discarded", { count: run.discardedEvents }) }}
          </p>
          <div v-if="run.transcript?.length" class="flex flex-col gap-2">
            <p class="text-sm font-medium">
              {{ t("automations.run.transcript") }}
            </p>
            <div
              v-for="(entry, index) in run.transcript"
              :key="index"
              :class="[
                'rounded-md px-3 py-2 text-xs whitespace-pre-wrap',
                entry.role === 'assistant'
                  ? 'bg-muted'
                  : entry.role === 'tool'
                    ? 'border font-mono text-muted-foreground'
                    : 'border-l-2 pl-3',
                entry.isError && 'border-destructive',
              ]"
            >
              <span v-if="entry.toolName" class="font-semibold"
                >{{ entry.toolName }}: </span
              >{{ entry.text }}
            </div>
          </div>
          <p v-else-if="run.continued" class="text-sm text-muted-foreground">
            {{ t("automations.run.continued") }}
          </p>
        </div>

        <!-- One automation -->
        <div v-else-if="detail" class="flex flex-col gap-4 pr-3">
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
                @update:model-value="setEnabled(detail, $event)"
              />
              <Button
                variant="outline"
                size="sm"
                :disabled="detail.status !== 'active' || detail.running"
                @click="runNow(detail)"
                ><PlayIcon data-icon="inline-start" />{{
                  t("automations.runNow")
                }}</Button
              >
              <Button
                v-if="isDesktop"
                variant="outline"
                size="sm"
                @click="deleting = detail"
                ><Trash2Icon data-icon="inline-start" />{{
                  t("common.delete")
                }}</Button
              >
            </div>
          </div>
          <p v-if="detail.description" class="text-sm">
            {{ detail.description }}
          </p>
          <AutomationFactsList :facts="detail.facts" />
          <details class="text-sm">
            <summary class="cursor-pointer text-muted-foreground">
              {{ t("automations.instructions") }}
            </summary>
            <p class="mt-2 whitespace-pre-wrap">
              {{ detail.spec.action.instructions }}
            </p>
          </details>
          <ItemGroup v-if="detailRuns.length">
            <Item
              v-for="entry in detailRuns"
              :key="entry.id"
              variant="outline"
              size="sm"
              as="button"
              class="text-left"
              @click="openRun(entry)"
            >
              <ItemContent>
                <ItemTitle>
                  <Badge :variant="statusVariant(entry.status)">{{
                    t(`automations.status.${entry.status}`)
                  }}</Badge>
                  {{ time(entry.startedAt) }}
                </ItemTitle>
                <ItemDescription>{{
                  entry.summary ?? entry.error ?? ""
                }}</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </div>

        <!-- Lists -->
        <Tabs v-else v-model="tab" class="pr-3">
          <TabsList>
            <TabsTrigger value="activity">{{
              t("automations.tabs.activity")
            }}</TabsTrigger>
            <TabsTrigger value="automations">{{
              t("automations.tabs.automations")
            }}</TabsTrigger>
            <TabsTrigger value="secrets">{{
              t("automations.tabs.secrets")
            }}</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" class="flex flex-col gap-3">
            <AutomationApprovalCard
              v-for="approval in pendingApprovals"
              :key="approval.requestId"
              :approval="approval"
            />
            <div class="flex items-center gap-3 text-sm">
              <label class="flex items-center gap-2">
                <Switch v-model="showAllRuns" />
                {{ t("automations.showNothingRuns") }}
              </label>
              <Button
                variant="ghost"
                size="sm"
                class="ml-auto"
                :disabled="store.unread === 0"
                @click="markAllRead"
                >{{ t("automations.markAllRead") }}</Button
              >
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="t('automations.refresh')"
                :disabled="loading"
                @click="load"
                ><RefreshCwIcon
              /></Button>
            </div>
            <ItemGroup v-if="runs.length">
              <Item
                v-for="entry in runs"
                :key="entry.id"
                variant="outline"
                as="button"
                class="text-left"
                @click="openRun(entry)"
              >
                <ItemContent>
                  <ItemTitle>
                    <span
                      v-if="!entry.read"
                      class="size-2 rounded-full bg-primary"
                      :aria-label="t('automations.unread')"
                    />
                    {{ entry.automationName }}
                    <Badge :variant="statusVariant(entry.status)">{{
                      t(`automations.status.${entry.status}`)
                    }}</Badge>
                  </ItemTitle>
                  <ItemDescription>{{
                    entry.summary ?? entry.error ?? ""
                  }}</ItemDescription>
                </ItemContent>
                <ItemActions class="text-xs text-muted-foreground">{{
                  time(entry.startedAt)
                }}</ItemActions>
              </Item>
            </ItemGroup>
            <Empty v-else>
              <EmptyHeader>
                <EmptyTitle>{{ t("automations.noRuns") }}</EmptyTitle>
                <EmptyDescription>{{
                  t("automations.emptyHint")
                }}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TabsContent>

          <TabsContent value="automations">
            <ItemGroup v-if="automations.length">
              <Item
                v-for="automation in automations"
                :key="`${automation.projectId}/${automation.id}`"
                variant="outline"
              >
                <ItemContent
                  class="cursor-pointer"
                  @click="openAutomation(automation)"
                >
                  <ItemTitle>
                    {{ automation.name }}
                    <Badge variant="secondary">{{
                      t(`automations.state.${automation.status}`)
                    }}</Badge>
                    <Badge v-if="automation.running">{{
                      t("automations.status.running")
                    }}</Badge>
                  </ItemTitle>
                  <ItemDescription>
                    {{ automation.projectName }} ·
                    {{
                      automation.triggers
                        .map((kind) => t(`automations.trigger.${kind}`))
                        .join(", ")
                    }}
                    <template v-if="automation.nextRunAt">
                      ·
                      {{
                        t("automations.next", {
                          time: time(automation.nextRunAt),
                        })
                      }}
                    </template>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    :model-value="automation.status === 'active'"
                    :disabled="!isDesktop && automation.status !== 'active'"
                    :aria-label="t('automations.enabled')"
                    @update:model-value="setEnabled(automation, $event)"
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
            <Empty v-else>
              <EmptyHeader>
                <EmptyTitle>{{ t("automations.empty") }}</EmptyTitle>
                <EmptyDescription>{{
                  t("automations.emptyHint")
                }}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TabsContent>

          <TabsContent value="secrets" class="flex flex-col gap-3">
            <p class="text-sm text-muted-foreground">
              {{ t("automations.secrets.description") }}
            </p>
            <ItemGroup v-if="secrets.length">
              <Item
                v-for="secret in secrets"
                :key="secret.name"
                variant="outline"
              >
                <ItemContent>
                  <ItemTitle>
                    <KeyRoundIcon class="size-4" aria-hidden="true" />
                    {{ secret.name }}
                    <Badge v-if="!secret.hasValue" variant="destructive">{{
                      t("automations.secrets.noValue")
                    }}</Badge>
                  </ItemTitle>
                  <ItemDescription>
                    {{ secret.description }}
                    <template v-if="secret.usedBy.length">
                      ·
                      {{
                        t("automations.secrets.usedBy", {
                          names: secret.usedBy
                            .map((use) => use.name)
                            .join(", "),
                        })
                      }}
                    </template>
                  </ItemDescription>
                </ItemContent>
                <ItemActions v-if="isDesktop">
                  <Button
                    variant="outline"
                    size="sm"
                    @click="beginSecret(secret)"
                    >{{ t("automations.secrets.setValue") }}</Button
                  >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="t('common.delete')"
                    @click="deleteSecret(secret)"
                    ><Trash2Icon
                  /></Button>
                </ItemActions>
              </Item>
            </ItemGroup>
            <template v-if="isDesktop">
              <FieldGroup v-if="editingSecret" class="rounded-md border p-3">
                <Field>
                  <FieldLabel for="automation-secret-name">{{
                    t("automations.secrets.name")
                  }}</FieldLabel>
                  <Input
                    id="automation-secret-name"
                    v-model="secretName"
                    placeholder="github-token"
                    autocomplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel for="automation-secret-description">{{
                    t("automations.secrets.descriptionLabel")
                  }}</FieldLabel>
                  <Input
                    id="automation-secret-description"
                    v-model="secretDescription"
                  />
                </Field>
                <Field>
                  <FieldLabel for="automation-secret-value">{{
                    t("automations.secrets.value")
                  }}</FieldLabel>
                  <Input
                    id="automation-secret-value"
                    v-model="secretValue"
                    type="password"
                    autocomplete="off"
                  />
                  <p
                    v-if="shortSecret"
                    class="text-xs text-amber-700 dark:text-amber-400"
                  >
                    {{
                      t("automations.secrets.short", {
                        count: MIN_REDACTED_SECRET_LENGTH,
                      })
                    }}
                  </p>
                </Field>
                <div class="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    @click="editingSecret = false"
                    >{{ t("common.cancel") }}</Button
                  >
                  <Button
                    size="sm"
                    :disabled="!secretName.trim()"
                    @click="saveSecret"
                    >{{ t("common.save") }}</Button
                  >
                </div>
              </FieldGroup>
              <Button
                v-else
                size="sm"
                class="self-start"
                @click="beginSecret()"
                >{{ t("automations.secrets.add") }}</Button
              >
            </template>
            <p v-else class="text-sm text-muted-foreground">
              {{ t("automations.secrets.desktopOnly") }}
            </p>
          </TabsContent>
        </Tabs>
      </ScrollArea>
    </DialogContent>
  </Dialog>
  <AlertDialog
    :open="deleting !== null"
    @update:open="!$event && (deleting = null)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("automations.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>{{
          t("automations.deleteDescription", { name: deleting?.name ?? "" })
        }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          @click="deleting && remove(deleting)"
          >{{ t("common.delete") }}</AlertDialogAction
        >
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

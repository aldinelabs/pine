<script setup lang="ts">
import {
  HistoryIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  WorkflowIcon,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
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
  EmptyMedia,
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
import { useAutomationRunSession } from "@/composables/useAutomationRunSession";
import type {
  AutomationRunSummary,
  AutomationSecretSummary,
  AutomationSummary,
} from "@/shared/automation";
import { MIN_REDACTED_SECRET_LENGTH } from "@/shared/automationRedaction";
import { useAutomationsStore } from "@/stores/automations";
import AutomationApprovalCard from "./AutomationApprovalCard.vue";
import AutomationDetailDialog from "./AutomationDetailDialog.vue";
import AutomationEditorDialog from "./AutomationEditorDialog.vue";
import { runStatusVariant, useAutomationTime } from "./automationDisplay";

const props = defineProps<{ projectId: string }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
  /** Start a conversation that creates one together with Pine. */
  createWithPine: [projectId: string];
}>();

function createWithPine(): void {
  open.value = false;
  emit("createWithPine", props.projectId);
}

/** The hand-written definition editor, over this dialog. */
const isEditorOpen = ref(false);

const { t } = useI18n();
const store = useAutomationsStore();
const runSession = useAutomationRunSession();
const time = useAutomationTime();
const tab = ref<"activity" | "automations" | "secrets">("activity");
const runs = ref<AutomationRunSummary[]>([]);
const automations = ref<AutomationSummary[]>([]);
const secrets = ref<AutomationSecretSummary[]>([]);
/** The automation open in its own dialog above this one. */
const selected = ref<{ projectId: string; id: string } | null>(null);
const showAllRuns = ref(false);
const loading = ref(false);
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
    if (target.runId) void revealRun(target.runId, target);
    else
      selected.value = { projectId: target.projectId, id: target.automationId };
    store.reveal = null;
  },
  { immediate: true },
);

/** Runs open as the ordinary conversations they are, over every dialog. */
function openRun(entry: AutomationRunSummary): void {
  if (!runSession.openRun(entry)) {
    toast.error(t("automations.run.noSession"));
    return;
  }
  selected.value = null;
  open.value = false;
}

async function revealRun(
  runId: string,
  target: { projectId: string; automationId: string },
): Promise<void> {
  try {
    openRun(
      await window.pine.automations.run({
        projectId: target.projectId,
        automationId: target.automationId,
        runId,
      }),
    );
  } catch (cause) {
    failed(cause);
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
        'flex h-[min(85vh,44rem)] flex-col sm:max-w-3xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{ t("automations.title") }}</DialogTitle>
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

      <!-- The viewport's content fills its height, so empty states can too. -->
      <ScrollArea
        class="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:flex [&>[data-slot=scroll-area-viewport]>div]:min-h-full [&>[data-slot=scroll-area-viewport]>div]:flex-col"
      >
        <!-- Lists -->
        <Tabs v-model="tab" class="flex-1 pr-3">
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
                variant="secondary"
                size="sm"
                class="ml-auto"
                :disabled="store.unread === 0"
                @click="markAllRead"
                >{{ t("automations.markAllRead") }}</Button
              >
              <Button
                variant="outline"
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
                    <Badge :variant="runStatusVariant(entry.status)">{{
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
            <Empty v-else class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><HistoryIcon /></EmptyMedia>
                <EmptyTitle>{{ t("automations.noRuns") }}</EmptyTitle>
                <EmptyDescription>{{
                  t("automations.emptyHint")
                }}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TabsContent>

          <TabsContent value="automations" class="flex flex-col gap-3">
            <div class="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="automation-create-with-pine"
                @click="createWithPine"
                ><SparklesIcon data-icon="inline-start" />{{
                  t("common.manageWithPine")
                }}</Button
              >
              <Button
                v-if="isDesktop"
                size="sm"
                data-testid="automation-create-manually"
                @click="isEditorOpen = true"
                ><PlusIcon data-icon="inline-start" />{{
                  t("automations.editor.create")
                }}</Button
              >
            </div>
            <ItemGroup v-if="automations.length">
              <Item
                v-for="automation in automations"
                :key="`${automation.projectId}/${automation.id}`"
                variant="outline"
              >
                <ItemContent
                  class="cursor-pointer"
                  @click="
                    selected = {
                      projectId: automation.projectId,
                      id: automation.id,
                    }
                  "
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
            <Empty v-else class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><WorkflowIcon /></EmptyMedia>
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
  <AutomationDetailDialog v-model:target="selected" @open-run="openRun" />
  <AutomationEditorDialog
    v-model:open="isEditorOpen"
    :project-id="projectId"
    @saved="(id) => (selected = { projectId, id })"
  />
</template>

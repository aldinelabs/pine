<script setup lang="ts">
import {
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { Badge } from "@/components/ui/badge";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { PineMcpCatalog, PineMcpScope, PineMcpServer } from "@/shared/mcp";

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

const { t } = useI18n();
const catalog = ref<PineMcpCatalog | null>(null);
const scope = ref<PineMcpScope>("project");
const editing = ref(false);
const saving = ref(false);
const loading = ref(false);
const name = ref("");
const previousName = ref<string>();
const definitionText = ref("");
const error = ref("");
const removing = ref(false);
const servers = computed(
  () =>
    catalog.value?.servers.filter((server) => server.scope === scope.value) ??
    [],
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    catalog.value = await window.pine.listMcpServers({
      projectId: props.projectId,
    });
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause));
  } finally {
    loading.value = false;
  }
}

watch(
  [open, () => props.projectId],
  ([isOpen]) => {
    if (isOpen) void load();
  },
  { immediate: true },
);

function beginAdd(): void {
  name.value = "";
  previousName.value = undefined;
  definitionText.value = JSON.stringify(
    { command: "npx", args: ["-y", "@example/mcp-server"] },
    null,
    2,
  );
  error.value = "";
  editing.value = true;
}

function beginEdit(server: PineMcpServer): void {
  scope.value = server.scope;
  name.value = server.name;
  previousName.value = server.name;
  definitionText.value = JSON.stringify(server.definition, null, 2);
  error.value = "";
  editing.value = true;
}

async function save(): Promise<void> {
  error.value = "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name.value.trim())) {
    error.value = t("mcp.invalidName");
    return;
  }
  if (
    catalog.value?.servers.some(
      (server) =>
        server.scope === scope.value &&
        server.name === name.value.trim() &&
        server.name !== previousName.value,
    )
  ) {
    error.value = t("mcp.duplicateName");
    return;
  }
  let definition: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(definitionText.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    definition = parsed as Record<string, unknown>;
    if (
      typeof definition.command !== "string" &&
      typeof definition.url !== "string"
    )
      throw new Error();
  } catch {
    error.value = t("mcp.invalidDefinition");
    return;
  }
  saving.value = true;
  try {
    catalog.value = await window.pine.saveMcpServer({
      projectId: props.projectId,
      scope: scope.value,
      name: name.value.trim(),
      ...(previousName.value ? { previousName: previousName.value } : {}),
      definition,
    });
    editing.value = false;
    toast.success(t("mcp.saved"));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}

async function remove(server: PineMcpServer): Promise<void> {
  try {
    catalog.value = await window.pine.removeMcpServer({
      projectId: props.projectId,
      scope: server.scope,
      name: server.name,
    });
    editing.value = false;
    toast.success(t("mcp.removed"));
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause));
  }
}

async function toggle(server: PineMcpServer, enabled: boolean): Promise<void> {
  try {
    catalog.value = await window.pine.saveMcpServer({
      projectId: props.projectId,
      scope: server.scope,
      name: server.name,
      definition: { ...server.definition, disabled: !enabled },
    });
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause));
  }
}

function statusFor(name: string): string {
  const status = catalog.value?.status?.servers.find(
    (server) => server.name === name,
  )?.status;
  if (!status) return t("mcp.configured");
  const labels: Record<string, string> = {
    connected: "mcp.status.connected",
    disabled: "mcp.status.disabled",
    "needs-auth": "mcp.status.needsAuth",
    failed: "mcp.status.failed",
    cached: "mcp.status.cached",
    "not-connected": "mcp.status.notConnected",
  };
  return labels[status] ? t(labels[status]) : status;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :class="[
        'flex h-[min(85vh,36rem)] flex-col sm:max-w-2xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{ t("mcp.title") }}</DialogTitle>
        <DialogDescription>{{ t("mcp.description") }}</DialogDescription>
      </DialogHeader>

      <Tabs v-model="scope" class="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="project">{{ t("mcp.project") }}</TabsTrigger>
          <TabsTrigger value="global">{{ t("mcp.global") }}</TabsTrigger>
        </TabsList>
        <TabsContent
          v-for="tab in ['project', 'global'] as const"
          :key="tab"
          :value="tab"
          class="flex min-h-0 flex-col"
        >
          <p class="mb-3 text-xs text-muted-foreground">
            {{ catalog?.paths[tab] }}
          </p>
          <DialogScrollArea
            content-class="flex min-h-full flex-1 flex-col"
            class="flex-1 [&>[data-slot=scroll-area-viewport]>div]:flex [&>[data-slot=scroll-area-viewport]>div]:min-h-full [&>[data-slot=scroll-area-viewport]>div]:flex-col"
          >
            <ItemGroup v-if="servers.length">
              <Item
                v-for="server in servers"
                :key="server.name"
                variant="outline"
              >
                <ItemContent>
                  <ItemTitle
                    >{{ server.name }}
                    <Badge variant="secondary">{{
                      statusFor(server.name)
                    }}</Badge></ItemTitle
                  >
                  <ItemDescription>{{
                    server.definition.command ?? server.definition.url
                  }}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    :model-value="server.definition.disabled !== true"
                    :aria-label="t('mcp.enabled')"
                    @update:model-value="toggle(server, $event)"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    @click="beginEdit(server)"
                    >{{ t("mcp.edit") }}</Button
                  >
                </ItemActions>
              </Item>
            </ItemGroup>
            <Empty v-else class="border border-dashed">
              <EmptyHeader
                ><EmptyMedia variant="icon"><PlugIcon /></EmptyMedia
                ><EmptyTitle>{{ t("mcp.empty") }}</EmptyTitle
                ><EmptyDescription>{{
                  t("mcp.emptyDescription")
                }}</EmptyDescription></EmptyHeader
              >
              <EmptyContent class="flex-row justify-center">
                <Button size="sm" variant="outline" @click="createWithPine"
                  ><SparklesIcon data-icon="inline-start" />{{
                    t("common.manageWithPine")
                  }}</Button
                >
                <Button size="sm" @click="beginAdd"
                  ><PlusIcon data-icon="inline-start" />{{
                    t("mcp.add")
                  }}</Button
                >
              </EmptyContent>
            </Empty>
          </DialogScrollArea>
        </TabsContent>
      </Tabs>
      <DialogFooter class="max-sm:flex-row max-sm:justify-end">
        <Button
          variant="outline"
          size="icon"
          :aria-label="t('mcp.refresh')"
          :disabled="loading"
          @click="load"
          ><RefreshCwIcon
        /></Button>
        <Button
          variant="outline"
          data-testid="mcp-create-with-pine"
          @click="createWithPine"
          ><SparklesIcon data-icon="inline-start" />{{
            t("common.manageWithPine")
          }}</Button
        >
        <Button @click="beginAdd"
          ><PlusIcon data-icon="inline-start" />{{ t("mcp.add") }}</Button
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog v-model:open="editing">
    <DialogContent
      :class="[
        'max-h-[85vh] sm:max-w-2xl max-sm:flex max-sm:flex-col',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{
          previousName ? t("mcp.editTitle") : t("mcp.add")
        }}</DialogTitle>
        <DialogDescription>{{ t("mcp.definitionHelp") }}</DialogDescription>
      </DialogHeader>
      <DialogScrollArea class="max-h-[55vh] max-sm:max-h-none max-sm:flex-1">
        <FieldGroup>
          <Field :data-invalid="!!error">
            <FieldLabel for="mcp-name">{{ t("mcp.name") }}</FieldLabel>
            <Input
              id="mcp-name"
              v-model="name"
              :aria-invalid="!!error"
              placeholder="my-server"
            />
          </Field>
          <Field :data-invalid="!!error">
            <FieldLabel for="mcp-definition">{{
              t("mcp.definition")
            }}</FieldLabel>
            <Textarea
              id="mcp-definition"
              v-model="definitionText"
              :aria-invalid="!!error"
              class="min-h-52 font-mono text-xs"
              spellcheck="false"
            />
            <FieldDescription>{{ t("mcp.definitionHelp") }}</FieldDescription>
            <FieldError v-if="error">{{ error }}</FieldError>
          </Field>
        </FieldGroup>
      </DialogScrollArea>
      <DialogFooter>
        <Button
          v-if="previousName"
          variant="destructive"
          class="sm:mr-auto"
          :disabled="saving"
          @click="removing = true"
        >
          <Trash2Icon data-icon="inline-start" />{{ t("mcp.remove") }}
        </Button>
        <Button variant="outline" @click="editing = false">{{
          t("mcp.cancel")
        }}</Button>
        <Button :disabled="saving" @click="save">{{ t("mcp.save") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <AlertDialog v-model:open="removing">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("mcp.removeTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>{{
          t("mcp.removeDescription", { name: previousName })
        }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("mcp.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          @click="
            previousName &&
            remove({ name: previousName, scope, definition: {} })
          "
          >{{ t("mcp.remove") }}</AlertDialogAction
        >
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

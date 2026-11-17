<script setup lang="ts">
import { BrainIcon, RefreshCwIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
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
  DialogFooter,
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import {
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_DESCRIPTION_MAX_LENGTH,
  type PineMemoryScope,
  type PineMemorySummary,
} from "@/shared/memory";

/**
 * The notes the agent has saved, for the given project and for all
 * projects. They can be corrected or deleted here whether or not memory is
 * on; new ones come from the agent. The switch lives in Settings › Agent.
 */
const props = defineProps<{ projectId: string }>();
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();

const memories = ref<PineMemorySummary[]>([]);
const isLoadingMemories = ref(true);
const scope = ref<PineMemoryScope>("project");
const scopes = ["project", "global"] as const;

const isEditorOpen = ref(false);
const editing = ref<PineMemorySummary | null>(null);
const draftDescription = ref("");
const draftContent = ref("");
const draftVerified = ref(false);
const isSaving = ref(false);

// The target outlives the editor: confirming closes it before the action's
// click handler runs.
const pendingDelete = ref<PineMemorySummary | null>(null);
const isDeleteConfirmOpen = ref(false);

const memoriesByScope = computed(() => ({
  project: memories.value.filter((memory) => memory.scope === "project"),
  global: memories.value.filter((memory) => memory.scope === "global"),
}));

function memoryKey(memory: PineMemorySummary): string {
  return `${memory.scope}:${memory.name}`;
}

async function loadMemories(): Promise<void> {
  isLoadingMemories.value = memories.value.length === 0;
  try {
    const result = await window.pine.listMemories({
      projectId: props.projectId,
    });
    memories.value = result.memories;
  } catch (error) {
    handleError(error, {
      id: "memory.load",
      title: t("preferences.memory.loadFailed"),
    });
  } finally {
    isLoadingMemories.value = false;
  }
}

watch(
  [open, () => props.projectId],
  ([isOpen], previous) => {
    if (!isOpen) return;
    // Another project's notes are not shown while this one's load.
    if (previous && previous[1] !== props.projectId) memories.value = [];
    void loadMemories();
  },
  { immediate: true },
);

async function openEditor(memory: PineMemorySummary): Promise<void> {
  try {
    const note = await window.pine.readMemory({
      projectId: props.projectId,
      scope: memory.scope,
      name: memory.name,
    });
    editing.value = memory;
    draftDescription.value = note.description;
    draftContent.value = note.content;
    draftVerified.value = note.verified;
    isEditorOpen.value = true;
  } catch (error) {
    handleError(error, {
      id: `memory.read.${memoryKey(memory)}`,
      title: t("preferences.memory.loadFailed"),
    });
    void loadMemories();
  }
}

async function saveEditor(): Promise<void> {
  const memory = editing.value;
  if (!memory || isSaving.value) return;
  if (!draftDescription.value.trim() || !draftContent.value.trim()) return;
  isSaving.value = true;
  try {
    await window.pine.saveMemory({
      projectId: props.projectId,
      scope: memory.scope,
      name: memory.name,
      description: draftDescription.value,
      content: draftContent.value,
      verified: draftVerified.value,
    });
    isEditorOpen.value = false;
    await loadMemories();
  } catch (error) {
    handleError(error, {
      id: `memory.save.${memoryKey(memory)}`,
      title: t("preferences.memory.saveFailed"),
      description: error instanceof Error ? error.message : undefined,
    });
  } finally {
    isSaving.value = false;
  }
}

function requestDelete(): void {
  pendingDelete.value = editing.value;
  isDeleteConfirmOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  const memory = pendingDelete.value;
  isDeleteConfirmOpen.value = false;
  if (!memory) return;
  isEditorOpen.value = false;
  try {
    await window.pine.removeMemory({
      projectId: props.projectId,
      scope: memory.scope,
      name: memory.name,
    });
  } catch (error) {
    handleError(error, {
      id: `memory.delete.${memoryKey(memory)}`,
      title: t("preferences.memory.deleteFailed"),
    });
  }
  await loadMemories();
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="memory-manager"
      :class="[
        'flex h-[min(85vh,36rem)] flex-col sm:max-w-2xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{ t("preferences.memory.managerTitle") }}</DialogTitle>
        <DialogDescription>
          {{ t("preferences.memory.managerDescription") }}
        </DialogDescription>
      </DialogHeader>

      <Tabs v-model="scope" class="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="project">
            {{ t("preferences.memory.scopeProject") }}
          </TabsTrigger>
          <TabsTrigger value="global">
            {{ t("preferences.memory.scopeGlobal") }}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          v-for="tab in scopes"
          :key="tab"
          :value="tab"
          class="flex min-h-0 flex-col"
        >
          <DialogScrollArea
            viewport-class="scroll-fade-y"
            content-class="flex min-h-full flex-1 flex-col"
            class="flex-1 [&>[data-slot=scroll-area-viewport]>div]:flex [&>[data-slot=scroll-area-viewport]>div]:min-h-full [&>[data-slot=scroll-area-viewport]>div]:flex-col"
          >
            <ItemGroup
              v-if="isLoadingMemories"
              data-testid="memory-list-skeleton"
            >
              <Skeleton
                v-for="index in 3"
                :key="index"
                class="h-[4.5rem] w-full rounded-2xl"
              />
            </ItemGroup>
            <ItemGroup v-else-if="memoriesByScope[tab].length">
              <Item
                v-for="memory in memoriesByScope[tab]"
                :key="memoryKey(memory)"
                data-slot="memory-row"
                variant="outline"
              >
                <ItemContent class="min-w-0">
                  <ItemTitle class="w-full">
                    <span class="truncate">{{ memory.name }}</span>
                    <Badge
                      v-if="!memory.verified"
                      data-slot="memory-unverified"
                      variant="outline"
                      class="shrink-0"
                    >
                      {{ t("preferences.memory.unverified") }}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>{{ memory.description }}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    data-action="edit-memory"
                    :aria-label="
                      t('preferences.memory.editNamed', { name: memory.name })
                    "
                    @click="openEditor(memory)"
                    >{{ t("common.edit") }}</Button
                  >
                </ItemActions>
              </Item>
            </ItemGroup>
            <Empty
              v-else
              data-testid="memory-list-empty"
              class="border border-dashed"
            >
              <EmptyHeader>
                <EmptyMedia variant="icon"><BrainIcon /></EmptyMedia>
                <EmptyTitle>{{
                  t("preferences.memory.emptyTitle")
                }}</EmptyTitle>
                <EmptyDescription>
                  {{ t("preferences.memory.empty") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </DialogScrollArea>
        </TabsContent>
      </Tabs>

      <DialogFooter class="max-sm:flex-row max-sm:justify-end">
        <Button
          variant="outline"
          :disabled="isLoadingMemories"
          @click="loadMemories"
        >
          <RefreshCwIcon data-icon="inline-start" />
          {{ t("preferences.memory.refresh") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="isEditorOpen">
    <DialogContent
      data-testid="memory-editor"
      :class="[
        'max-h-[85vh] sm:max-w-2xl max-sm:flex max-sm:flex-col',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{ t("preferences.memory.editTitle") }}</DialogTitle>
        <DialogDescription>{{ editing?.name }}</DialogDescription>
      </DialogHeader>
      <DialogScrollArea
        viewport-class="scroll-fade-y"
        class="max-h-[55vh] max-sm:max-h-none max-sm:flex-1"
      >
        <form
          id="pine-memory-editor-form"
          class="flex flex-col gap-4"
          @submit.prevent="saveEditor"
        >
          <FieldGroup>
            <Field>
              <FieldLabel for="pine-memory-description">
                {{ t("preferences.memory.summaryLabel") }}
              </FieldLabel>
              <Input
                id="pine-memory-description"
                v-model="draftDescription"
                :maxlength="MEMORY_DESCRIPTION_MAX_LENGTH"
                required
              />
            </Field>
            <Field>
              <FieldLabel for="pine-memory-content">
                {{ t("preferences.memory.detailsLabel") }}
              </FieldLabel>
              <Textarea
                id="pine-memory-content"
                v-model="draftContent"
                :maxlength="MEMORY_CONTENT_MAX_LENGTH"
                class="min-h-40"
                required
              />
            </Field>
            <Field orientation="horizontal">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <FieldTitle id="pine-memory-verified">
                  {{ t("preferences.memory.verifiedLabel") }}
                </FieldTitle>
                <FieldDescription>
                  {{ t("preferences.memory.verifiedDescription") }}
                </FieldDescription>
              </div>
              <Switch
                v-model="draftVerified"
                data-testid="pine-memory-verified-toggle"
                aria-labelledby="pine-memory-verified"
              />
            </Field>
          </FieldGroup>
        </form>
      </DialogScrollArea>
      <DialogFooter>
        <Button
          type="button"
          variant="destructive"
          class="sm:mr-auto"
          data-action="delete-memory"
          :disabled="isSaving"
          @click="requestDelete"
        >
          <Trash2Icon data-icon="inline-start" />{{ t("common.delete") }}
        </Button>
        <Button type="button" variant="outline" @click="isEditorOpen = false">
          {{ t("common.cancel") }}
        </Button>
        <Button
          type="submit"
          form="pine-memory-editor-form"
          data-action="save-memory"
          :disabled="
            isSaving || !draftDescription.trim() || !draftContent.trim()
          "
        >
          {{ t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="isDeleteConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{
            t("preferences.memory.deleteTitle", {
              name: pendingDelete?.name ?? "",
            })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("preferences.memory.deleteDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          data-action="confirm-delete-memory"
          variant="destructive"
          @click="confirmDelete"
        >
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

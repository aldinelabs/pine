<script setup lang="ts">
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import {
  DEFAULT_MEMORY_ENABLED,
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_DESCRIPTION_MAX_LENGTH,
  type PineMemorySummary,
} from "@/shared/memory";
import { useProjectStore } from "@/stores/project";

/**
 * The switch for long-term memory and the notes the agent has saved: the
 * global ones and those of the project in front. Notes can be corrected or
 * deleted here; new ones come from the agent.
 */
const { t } = useI18n();
const projectStore = useProjectStore();
const { activeProject, currentProjectId } = storeToRefs(projectStore);
const displayName = useProjectDisplayName();

const enabled = ref(DEFAULT_MEMORY_ENABLED);
const isLoadingEnabled = ref(true);
const isSavingEnabled = ref(false);
const memories = ref<PineMemorySummary[]>([]);
const isLoadingMemories = ref(true);

const isEditorOpen = ref(false);
const editing = ref<PineMemorySummary | null>(null);
const draftDescription = ref("");
const draftContent = ref("");
const draftVerified = ref(false);
const isSaving = ref(false);

// The target outlives the dialog: confirming closes it before the action's
// click handler runs.
const pendingDelete = ref<PineMemorySummary | null>(null);
const isDeleteConfirmOpen = ref(false);

function memoryKey(memory: PineMemorySummary): string {
  return `${memory.scope}:${memory.name}`;
}

function scopeLabel(memory: PineMemorySummary): string {
  return memory.scope === "global"
    ? t("preferences.memory.scopeGlobal")
    : displayName(activeProject.value);
}

async function loadEnabled(): Promise<void> {
  try {
    enabled.value = await window.pine.getMemoryEnabled();
  } catch (error) {
    handleError(error, {
      id: "preferences.memory.load-enabled",
      title: t("preferences.memory.loadFailed"),
    });
  } finally {
    isLoadingEnabled.value = false;
  }
}

async function loadMemories(): Promise<void> {
  try {
    const result = await window.pine.listMemories({
      projectId: currentProjectId.value,
    });
    memories.value = result.memories;
  } catch (error) {
    handleError(error, {
      id: "preferences.memory.load",
      title: t("preferences.memory.loadFailed"),
    });
  } finally {
    isLoadingMemories.value = false;
  }
}

async function updateEnabled(next: boolean): Promise<void> {
  if (isLoadingEnabled.value || isSavingEnabled.value) return;
  if (next === enabled.value) return;
  const previous = enabled.value;
  enabled.value = next;
  isSavingEnabled.value = true;
  try {
    enabled.value = (
      await window.pine.setMemoryEnabled({ enabled: next })
    ).enabled;
  } catch (error) {
    enabled.value = previous;
    handleError(error, {
      id: "preferences.memory.save-enabled",
      title: t("preferences.memory.saveFailed"),
    });
  } finally {
    isSavingEnabled.value = false;
  }
}

async function openEditor(memory: PineMemorySummary): Promise<void> {
  try {
    const note = await window.pine.readMemory({
      projectId: currentProjectId.value,
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
      id: `preferences.memory.read.${memoryKey(memory)}`,
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
      projectId: currentProjectId.value,
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
      id: `preferences.memory.save.${memoryKey(memory)}`,
      title: t("preferences.memory.saveFailed"),
      description: error instanceof Error ? error.message : undefined,
    });
  } finally {
    isSaving.value = false;
  }
}

function requestDelete(memory: PineMemorySummary): void {
  pendingDelete.value = memory;
  isDeleteConfirmOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  const memory = pendingDelete.value;
  isDeleteConfirmOpen.value = false;
  if (!memory) return;
  try {
    await window.pine.removeMemory({
      projectId: currentProjectId.value,
      scope: memory.scope,
      name: memory.name,
    });
  } catch (error) {
    handleError(error, {
      id: `preferences.memory.delete.${memoryKey(memory)}`,
      title: t("preferences.memory.deleteFailed"),
    });
  }
  await loadMemories();
}

onMounted(() => {
  void loadEnabled();
  void loadMemories();
});

watch(currentProjectId, () => void loadMemories());
</script>

<template>
  <FieldGroup data-testid="memory-settings">
    <Field orientation="horizontal">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <FieldTitle id="pine-memory-setting">
          {{ t("preferences.memory.title") }}
        </FieldTitle>
        <FieldDescription>
          {{ t("preferences.memory.description") }}
        </FieldDescription>
      </div>
      <Switch
        data-testid="pine-memory-toggle"
        :model-value="enabled"
        :disabled="isLoadingEnabled || isSavingEnabled"
        aria-labelledby="pine-memory-setting"
        @update:model-value="(value: boolean) => void updateEnabled(value)"
      />
    </Field>

    <Skeleton
      v-if="isLoadingMemories"
      data-testid="memory-list-skeleton"
      class="h-14 w-full"
    />
    <FieldDescription
      v-else-if="memories.length === 0"
      data-testid="memory-list-empty"
    >
      {{ t("preferences.memory.empty") }}
    </FieldDescription>
    <ItemGroup v-else class="gap-2">
      <Item
        v-for="memory in memories"
        :key="memoryKey(memory)"
        data-slot="memory-row"
        variant="outline"
        size="sm"
      >
        <ItemContent class="min-w-0">
          <ItemTitle class="w-full">
            <span class="truncate">{{ memory.name }}</span>
            <Badge variant="secondary" class="shrink-0">
              {{ scopeLabel(memory) }}
            </Badge>
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
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :aria-label="
                  t('preferences.memory.actions', { name: memory.name })
                "
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-40">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  data-action="edit-memory"
                  @select="openEditor(memory)"
                >
                  <PencilIcon />
                  {{ t("common.edit") }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-action="delete-memory"
                  variant="destructive"
                  @select="requestDelete(memory)"
                >
                  <Trash2Icon />
                  {{ t("common.delete") }}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </Item>
    </ItemGroup>

    <Dialog v-model:open="isEditorOpen">
      <DialogContent data-testid="memory-editor">
        <DialogHeader>
          <DialogTitle>{{ t("preferences.memory.editTitle") }}</DialogTitle>
          <DialogDescription>{{ editing?.name }}</DialogDescription>
        </DialogHeader>
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
                rows="8"
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
        <DialogFooter>
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
  </FieldGroup>
</template>

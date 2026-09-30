<script setup lang="ts">
import { FolderOpen, FolderPlus, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  PineProject,
  ProjectColorTheme,
  ProjectFolderInput,
  ProjectMutationInput,
} from "@/shared/projects";
import { PROJECT_COLOR_THEMES } from "@/shared/projects";
import { PROJECT_COLOR_THEME_OPTIONS } from "@/lib/projectColorThemes";

interface Props {
  isSaving?: boolean;
  project?: PineProject | null;
}

interface EditorProjectFolder extends ProjectFolderInput {
  isAvailable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isSaving: false,
  project: null,
});
const emit = defineEmits<{
  cancel: [];
  submit: [input: ProjectMutationInput];
}>();
const { t } = useI18n();
const name = ref("");
const projectColorTheme = ref<ProjectColorTheme>("olive");
const folders = ref<EditorProjectFolder[]>([]);
const defaultFolderId = ref("");
const originalFolderNames = new Map<string, string>();

const defaultFolder = computed(() =>
  folders.value.find((folder) => folder.id === defaultFolderId.value),
);
const selectedColorThemeOption = computed(() =>
  PROJECT_COLOR_THEME_OPTIONS.find(
    (option) => option.value === projectColorTheme.value,
  ),
);
const contextFolders = computed(() =>
  folders.value.filter((folder) => folder.id !== defaultFolderId.value),
);

const canSubmit = computed(
  () =>
    name.value.trim().length > 0 &&
    folders.value.length > 0 &&
    folders.value.some(
      (folder) =>
        folder.id === defaultFolderId.value &&
        folder.access === "read-write" &&
        folder.isAvailable !== false,
    ) &&
    folders.value.every((folder) => folder.name.trim().length > 0),
);

function reset(): void {
  originalFolderNames.clear();
  name.value = props.project?.name ?? "";
  projectColorTheme.value = props.project?.projectColorTheme ?? "olive";
  folders.value = props.project?.folders.map((folder) => ({ ...folder })) ?? [];
  defaultFolderId.value = props.project?.defaultFolderId ?? "";
  const selectedDefaultFolder = folders.value.find(
    (folder) => folder.id === defaultFolderId.value,
  );
  if (selectedDefaultFolder) selectedDefaultFolder.access = "read-write";
}

function mergeContextFolders(selectedFolders: ProjectFolderInput[]): void {
  const existingPaths = new Set(folders.value.map((folder) => folder.path));
  const additions = selectedFolders
    .filter((folder) => !existingPaths.has(folder.path))
    .map((folder) => ({ ...folder, isAvailable: true }));
  folders.value = [...folders.value, ...additions];
}

async function chooseDefaultFolder(): Promise<void> {
  const [selectedFolder] = (
    await window.pine.pickProjectFolders({ mode: "default" })
  ).folders;
  if (!selectedFolder) return;

  const existingFolder = folders.value.find(
    (folder) => folder.path === selectedFolder.path,
  );
  if (existingFolder) {
    existingFolder.access = "read-write";
    existingFolder.isAvailable = true;
    defaultFolderId.value = existingFolder.id;
    return;
  }

  folders.value = [...folders.value, { ...selectedFolder, isAvailable: true }];
  defaultFolderId.value = selectedFolder.id;
}

async function addContextFolders(): Promise<void> {
  mergeContextFolders(
    (await window.pine.pickProjectFolders({ mode: "context" })).folders,
  );
}

function removeFolder(folderId: string): void {
  folders.value = folders.value.filter((folder) => folder.id !== folderId);
  if (defaultFolderId.value === folderId) {
    defaultFolderId.value = folders.value[0]?.id ?? "";
  }
}

function updateFolderName(folder: EditorProjectFolder, name: string): void {
  folder.name = name;
}

function startRenamingFolder(folder: EditorProjectFolder): void {
  originalFolderNames.set(folder.id, folder.name);
}

function finishRenamingFolder(folder: EditorProjectFolder): void {
  folder.name =
    folder.name.trim() || originalFolderNames.get(folder.id) || folder.name;
  originalFolderNames.delete(folder.id);
}

function cancelRenamingFolder(
  folder: EditorProjectFolder,
  event: KeyboardEvent,
): void {
  folder.name = originalFolderNames.get(folder.id) ?? folder.name;
  originalFolderNames.delete(folder.id);
  (event.currentTarget as HTMLInputElement).blur();
}

function updateFolderAccess(
  folder: EditorProjectFolder,
  access: unknown,
): void {
  if (access === "read-only" || access === "read-write") {
    folder.access = access;
  }
}

function updateProjectColorTheme(value: unknown): void {
  if (
    typeof value === "string" &&
    PROJECT_COLOR_THEMES.includes(value as ProjectColorTheme)
  ) {
    projectColorTheme.value = value as ProjectColorTheme;
  }
}

function toFolderInput(folder: EditorProjectFolder): ProjectFolderInput {
  return {
    access: folder.access,
    id: folder.id,
    name: folder.name.trim(),
    path: folder.path,
  };
}

function submit(): void {
  if (!canSubmit.value || props.isSaving) return;
  emit("submit", {
    defaultFolderId: defaultFolderId.value,
    folders: folders.value.map(toFolderInput),
    name: name.value.trim(),
    projectColorTheme: projectColorTheme.value,
  });
}

watch(() => props.project, reset, { immediate: true });
</script>

<template>
  <form class="flex min-h-0 flex-col" @submit.prevent="submit">
    <ScrollArea class="min-h-0 flex-1">
      <FieldGroup class="gap-5 px-6 py-5">
        <Field>
          <FieldLabel for="project-name">
            {{ t("projects.editor.nameLabel") }}
          </FieldLabel>
          <Input
            id="project-name"
            v-model="name"
            maxlength="100"
            autocomplete="off"
            :placeholder="t('projects.editor.namePlaceholder')"
          />
        </Field>

        <Field>
          <FieldLabel id="project-color-theme-label">
            {{ t("projects.editor.colorThemeLabel") }}
          </FieldLabel>
          <Select
            :model-value="projectColorTheme"
            @update:model-value="updateProjectColorTheme"
          >
            <SelectTrigger
              class="w-full justify-start [&>*:last-child]:ml-auto"
              aria-labelledby="project-color-theme-label"
            >
              <span
                aria-hidden="true"
                class="size-3 shrink-0 rounded-full ring-1 ring-border"
                :style="{
                  backgroundColor: selectedColorThemeOption?.swatch,
                }"
              />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="option in PROJECT_COLOR_THEME_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  <span class="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      class="size-3 rounded-full ring-1 ring-border"
                      :style="{ backgroundColor: option.swatch }"
                    />
                    {{ t(`projects.editor.colorThemes.${option.value}`) }}
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldTitle id="default-folder-label" class="shrink-0">
            {{ t("projects.editor.defaultFolderLabel") }}
          </FieldTitle>

          <div
            v-if="defaultFolder"
            class="ml-auto flex min-w-0 items-center justify-end gap-3"
            data-testid="default-folder-row"
            aria-labelledby="default-folder-label"
          >
            <span class="truncate text-sm text-muted-foreground">
              {{ defaultFolder.path }}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="shrink-0"
              data-testid="change-default-folder"
              @click="chooseDefaultFolder"
            >
              <FolderOpen data-icon="inline-start" />
              {{ t("projects.editor.changeDefaultFolder") }}
            </Button>
          </div>

          <div v-else class="ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="choose-default-folder"
              @click="chooseDefaultFolder"
            >
              <FolderOpen data-icon="inline-start" />
              {{ t("projects.editor.chooseDefaultFolder") }}
            </Button>
          </div>
        </Field>

        <Field>
          <div class="flex items-center justify-between gap-4">
            <FieldTitle>
              {{ t("projects.editor.contextFoldersLabel") }}
            </FieldTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="add-context-folders"
              @click="addContextFolders"
            >
              <FolderPlus data-icon="inline-start" />
              {{ t("projects.editor.addContextFolders") }}
            </Button>
          </div>

          <div
            v-if="contextFolders.length > 0"
            data-testid="context-folder-table"
            class="overflow-hidden rounded-lg"
          >
            <Table class="table-fixed">
              <TableHeader class="bg-muted">
                <TableRow>
                  <TableHead class="w-28 px-4 py-3">
                    {{ t("projects.editor.folderName") }}
                  </TableHead>
                  <TableHead class="px-4 py-3">
                    {{ t("projects.editor.folderPath") }}
                  </TableHead>
                  <TableHead class="w-32 px-4 py-3">
                    {{ t("projects.editor.accessLabel") }}
                  </TableHead>
                  <TableHead class="w-12 px-2 py-3">
                    <span class="sr-only">
                      {{ t("projects.editor.actionsLabel") }}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="[&>tr:nth-child(even):not(:hover)]:bg-muted/30">
                <TableRow
                  v-for="folder in contextFolders"
                  :key="folder.id"
                  data-testid="context-folder-row"
                >
                  <TableCell class="px-4 py-3">
                    <Input
                      :id="`folder-name-${folder.id}`"
                      :model-value="folder.name"
                      data-testid="folder-name-input"
                      class="h-8 w-full min-w-0"
                      maxlength="100"
                      :aria-label="t('projects.editor.folderName')"
                      @update:model-value="
                        updateFolderName(folder, String($event))
                      "
                      @focus="startRenamingFolder(folder)"
                      @blur="finishRenamingFolder(folder)"
                      @keydown.enter.prevent="finishRenamingFolder(folder)"
                      @keydown.esc.prevent="
                        cancelRenamingFolder(folder, $event)
                      "
                    />
                  </TableCell>
                  <TableCell class="min-w-0 px-4 py-3">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="min-w-0 truncate text-muted-foreground">
                        {{ folder.path }}
                      </span>
                      <Badge
                        v-if="folder.isAvailable === false"
                        variant="destructive"
                      >
                        {{ t("projects.unavailable") }}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell class="px-4 py-3">
                    <Select
                      :model-value="folder.access"
                      @update:model-value="updateFolderAccess(folder, $event)"
                    >
                      <SelectTrigger
                        size="sm"
                        class="w-full"
                        :aria-label="
                          t('projects.editor.folderAccess', {
                            name: folder.name,
                          })
                        "
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="read-only">
                            {{ t("projects.access.readOnly") }}
                          </SelectItem>
                          <SelectItem value="read-write">
                            {{ t("projects.access.readWrite") }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell class="px-2 py-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="t('projects.editor.removeFolder')"
                      :title="t('projects.editor.removeFolder')"
                      @click="removeFolder(folder.id)"
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Field>
      </FieldGroup>
    </ScrollArea>

    <DialogFooter class="shrink-0 px-6 py-4">
      <Button type="button" variant="outline" @click="emit('cancel')">
        {{ t("common.cancel") }}
      </Button>
      <Button type="submit" :disabled="!canSubmit || isSaving">
        <Spinner v-if="isSaving" data-icon="inline-start" />
        {{
          isSaving
            ? t("common.saving")
            : project
              ? t("common.save")
              : t("projects.createAction")
        }}
      </Button>
    </DialogFooter>
  </form>
</template>

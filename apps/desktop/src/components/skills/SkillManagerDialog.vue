<script setup lang="ts">
import {
  ChevronLeftIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "@lucide/vue";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { useDialogPages } from "@/composables/useDialogPages";
import { usePhoneLayout } from "@/composables/usePhoneLayout";
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
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  PineSkillResource,
  PineSkillScope,
  PineSkillSummary,
} from "@/shared/skills";
import SkillToolPicker from "./SkillToolPicker.vue";
import {
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_LICENSE_PRESETS,
  SKILL_NAME_MAX_LENGTH,
  SKILL_TEMPLATES,
  formatToolList,
  normalizeSkillNameInput,
  parseToolList,
  skillNameIssue,
  type SkillTemplate,
} from "./skillForm";

interface Props {
  projectId: string;
}

const props = defineProps<Props>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
  /** Start a conversation that creates one together with Pine. */
  createWithPine: [projectId: string];
}>();

function createWithPine(): void {
  open.value = false;
  emit("createWithPine", props.projectId);
}

const LICENSE_NONE = "__none__";
const LICENSE_CUSTOM = "__custom__";

type EditorMode = "empty" | "create" | "edit";
type ValidatedField = "name" | "description" | "compatibility";

const { t } = useI18n();
const skillScopes = ["global", "project"] as const;
const activeScope = ref<PineSkillScope>("global");
const skills = ref<PineSkillSummary[]>([]);
const editorMode = ref<EditorMode>("empty");
const selectedName = ref("");
const selectedManagedBy = ref<"pine" | "pi">("pine");
const selectedReadOnly = ref(false);
const description = ref("");
const licenseChoice = ref(LICENSE_NONE);
const customLicense = ref("");
const compatibility = ref("");
const allowedTools = ref<string[]>([]);
const body = ref("");
const resources = ref<PineSkillResource[]>([]);
const frontmatter = ref<Record<string, unknown>>({});
const savedSnapshot = ref("");
const touched = ref(new Set<ValidatedField>());
const submitAttempted = ref(false);
const isLoading = ref(false);
const isSaving = ref(false);
const isDeleteConfirmOpen = ref(false);
const isRemoving = ref(false);
const deleteName = ref("");
const togglingNames = ref(new Set<string>());
// A phone shows the skill list and one skill's editor at a time.
const isPhone = usePhoneLayout();
const isEditorShown = ref(false);
const showPage = useDialogPages();

const isCreating = computed(() => editorMode.value === "create");
const isReadOnly = computed(() => !isCreating.value && selectedReadOnly.value);
const license = computed(() => {
  if (licenseChoice.value === LICENSE_NONE) return "";
  if (licenseChoice.value === LICENSE_CUSTOM) return customLicense.value.trim();
  return licenseChoice.value;
});

const nameError = computed(() => {
  const issue = skillNameIssue(selectedName.value);
  return issue
    ? t(`skills.nameErrors.${issue}`, { max: SKILL_NAME_MAX_LENGTH })
    : "";
});
const descriptionError = computed(() => {
  const length = description.value.trim().length;
  if (length === 0) return t("skills.descriptionErrors.required");
  if (length > SKILL_DESCRIPTION_MAX_LENGTH) {
    return t("skills.descriptionErrors.tooLong", {
      max: SKILL_DESCRIPTION_MAX_LENGTH,
    });
  }
  return "";
});
const compatibilityError = computed(() =>
  // Pi package Skills follow their own loader's limits.
  selectedManagedBy.value === "pine" &&
  compatibility.value.trim().length > SKILL_COMPATIBILITY_MAX_LENGTH
    ? t("skills.compatibilityTooLong", { max: SKILL_COMPATIBILITY_MAX_LENGTH })
    : "",
);
const isValid = computed(
  () =>
    !nameError.value && !descriptionError.value && !compatibilityError.value,
);

function visibleError(field: ValidatedField, message: string): string {
  return message && (submitAttempted.value || touched.value.has(field))
    ? message
    : "";
}

function touch(field: ValidatedField): void {
  if (touched.value.has(field)) return;
  touched.value = new Set(touched.value).add(field);
}

const isDirty = computed(
  () =>
    editorMode.value === "edit" &&
    !isReadOnly.value &&
    serializeSkillDocument() !== savedSnapshot.value,
);

interface ParsedSkillDocument {
  body: string;
  frontmatter: Record<string, unknown>;
}

function parseSkillDocument(rawContent: string): ParsedSkillDocument {
  const normalized = rawContent
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized.trim(), frontmatter: {} };
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex < 0) return { body: normalized.trim(), frontmatter: {} };

  try {
    const parsed = parseYaml(normalized.slice(4, endIndex));
    const metadata =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      body: normalized.slice(endIndex + 4).trim(),
      frontmatter: metadata,
    };
  } catch {
    return { body: normalized.slice(endIndex + 4).trim(), frontmatter: {} };
  }
}

function serializeSkillDocument(): string {
  const metadata: Record<string, unknown> = {
    ...frontmatter.value,
    name: selectedName.value,
    description: description.value.trim(),
  };
  if (license.value) metadata.license = license.value;
  else delete metadata.license;
  if (compatibility.value.trim()) {
    metadata.compatibility = compatibility.value.trim();
  } else delete metadata.compatibility;
  const tools = formatToolList(allowedTools.value);
  if (tools) metadata["allowed-tools"] = tools;
  else delete metadata["allowed-tools"];
  const header = stringifyYaml(metadata).trimEnd();
  const instructions = body.value.trim();
  return `---\n${header}\n---\n\n${instructions}\n`;
}

function setLicense(value: string): void {
  if (!value) {
    licenseChoice.value = LICENSE_NONE;
    customLicense.value = "";
  } else if ((SKILL_LICENSE_PRESETS as readonly string[]).includes(value)) {
    licenseChoice.value = value;
    customLicense.value = "";
  } else {
    licenseChoice.value = LICENSE_CUSTOM;
    customLicense.value = value;
  }
}

function resetValidation(): void {
  touched.value = new Set();
  submitAttempted.value = false;
}

function scopeRequest(scope = activeScope.value) {
  return { projectId: props.projectId, scope };
}

function reportError(error: unknown, operation: "load" | "save" | "remove") {
  handleError(error, {
    id: `skills.${operation}`,
    title: t("errors.skills.title"),
    description: t("errors.skills.description"),
  });
}

/** On a wide layout the editor always shows a Skill when there is one. */
async function showDefaultSelection(): Promise<void> {
  const first = skills.value[0];
  if (!first || isPhone.value) {
    editorMode.value = "empty";
    return;
  }
  await selectSkill(first.name, first.managedBy ?? "pine");
}

async function load(
  nameToSelect?: string,
  managedByToSelect: "pine" | "pi" = "pine",
): Promise<void> {
  isLoading.value = true;
  try {
    skills.value = (await window.pine.listSkills(scopeRequest())).skills;
    if (
      nameToSelect &&
      skills.value.some((skill) => skill.name === nameToSelect)
    ) {
      await selectSkill(nameToSelect, managedByToSelect);
    } else if (editorMode.value !== "create") {
      await showDefaultSelection();
    }
  } catch (error) {
    reportError(error, "load");
  } finally {
    isLoading.value = false;
  }
}

async function selectSkill(
  name: string,
  managedBy: "pine" | "pi" = "pine",
): Promise<void> {
  const result = await window.pine.readSkill({
    ...scopeRequest(),
    managedBy,
    name,
  });
  const parsed = parseSkillDocument(result.content);
  selectedName.value = result.skill.name;
  selectedManagedBy.value = result.skill.managedBy ?? managedBy;
  selectedReadOnly.value = result.skill.readOnly === true;
  description.value =
    typeof parsed.frontmatter.description === "string"
      ? parsed.frontmatter.description
      : result.skill.description;
  setLicense(
    typeof parsed.frontmatter.license === "string"
      ? parsed.frontmatter.license.trim()
      : "",
  );
  compatibility.value =
    typeof parsed.frontmatter.compatibility === "string"
      ? parsed.frontmatter.compatibility
      : "";
  allowedTools.value =
    typeof parsed.frontmatter["allowed-tools"] === "string"
      ? parseToolList(parsed.frontmatter["allowed-tools"])
      : [];
  body.value = parsed.body;
  resources.value = result.resources ?? [];
  frontmatter.value = parsed.frontmatter;
  editorMode.value = "edit";
  resetValidation();
  savedSnapshot.value = serializeSkillDocument();
}

async function selectSkillSafely(
  name: string,
  managedBy: "pine" | "pi" = "pine",
): Promise<void> {
  try {
    await selectSkill(name, managedBy);
    if (!isEditorShown.value)
      showPage("forward", () => (isEditorShown.value = true));
  } catch (error) {
    reportError(error, "load");
  }
}

function createFromList(): void {
  showPage("forward", () => {
    startCreating();
    isEditorShown.value = true;
  });
  void nextTick(() =>
    document.getElementById(`skill-${activeScope.value}-name`)?.focus(),
  );
}

function showSkillList(): void {
  showPage("back", () => (isEditorShown.value = false));
}

function startCreating(): void {
  selectedName.value = "";
  selectedManagedBy.value = "pine";
  selectedReadOnly.value = false;
  description.value = "";
  setLicense("");
  compatibility.value = "";
  allowedTools.value = [];
  body.value = "";
  resources.value = [];
  frontmatter.value = {};
  editorMode.value = "create";
  resetValidation();
  savedSnapshot.value = "";
}

async function cancelCreating(): Promise<void> {
  if (isPhone.value) {
    showSkillList();
    editorMode.value = "empty";
    return;
  }
  try {
    await showDefaultSelection();
  } catch (error) {
    reportError(error, "load");
  }
}

function onNameInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const normalized = normalizeSkillNameInput(input.value);
  // Rewrite the field in place so dropped characters never show up.
  if (input.value !== normalized) input.value = normalized;
  selectedName.value = normalized;
}

function applyTemplate(template: unknown): void {
  if (typeof template !== "string" || !template) return;
  body.value = t(`skills.templates.${template as SkillTemplate}.content`);
}

function focusFirstInvalid(): void {
  const field = nameError.value
    ? "name"
    : descriptionError.value
      ? "description"
      : "compatibility";
  void nextTick(() =>
    document.getElementById(`skill-${activeScope.value}-${field}`)?.focus(),
  );
}

async function save(): Promise<void> {
  if (isReadOnly.value || isSaving.value || editorMode.value === "empty") {
    return;
  }
  if (!isValid.value) {
    submitAttempted.value = true;
    focusFirstInvalid();
    return;
  }
  isSaving.value = true;
  try {
    const request = {
      ...scopeRequest(),
      managedBy: selectedManagedBy.value,
      name: selectedName.value,
      content: serializeSkillDocument(),
    };
    if (isCreating.value) await window.pine.createSkill(request);
    else await window.pine.editSkill(request);
    const savedName = selectedName.value;
    const savedManagedBy = selectedManagedBy.value;
    editorMode.value = "edit";
    await load(savedName, savedManagedBy);
  } catch (error) {
    reportError(error, "save");
  } finally {
    isSaving.value = false;
  }
}

function removeSelected(): void {
  if (!selectedName.value || isCreating.value || isReadOnly.value) return;
  deleteName.value = selectedName.value;
  isDeleteConfirmOpen.value = true;
}

async function confirmRemoveSelected(): Promise<void> {
  const name = deleteName.value;
  if (!name || isRemoving.value) return;
  isRemoving.value = true;
  try {
    await window.pine.removeSkill({
      ...scopeRequest(),
      managedBy: selectedManagedBy.value,
      name,
    });
    isDeleteConfirmOpen.value = false;
    editorMode.value = "empty";
    showSkillList();
    await load();
  } catch (error) {
    reportError(error, "remove");
  } finally {
    isRemoving.value = false;
  }
}

async function setGlobalSkillEnabled(
  skill: PineSkillSummary,
  enabled: boolean,
): Promise<void> {
  if (togglingNames.value.has(skill.name)) return;
  togglingNames.value = new Set(togglingNames.value).add(skill.name);
  const previous = skill.enabled !== false;
  skill.enabled = enabled;
  try {
    await window.pine.setGlobalSkillEnabled({
      enabled,
      name: skill.name,
      projectId: props.projectId,
    });
  } catch (error) {
    skill.enabled = previous;
    reportError(error, "save");
  } finally {
    const next = new Set(togglingNames.value);
    next.delete(skill.name);
    togglingNames.value = next;
  }
}

function resetForScope(): void {
  skills.value = [];
  isEditorShown.value = false;
  editorMode.value = "empty";
  void load();
}

watch(open, (value) => {
  if (value) resetForScope();
});

watch(activeScope, () => {
  if (open.value) resetForScope();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-dialog-pages
      :class="[
        'gap-0 overflow-hidden p-0 sm:max-w-3xl max-sm:flex max-sm:flex-col',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader
        v-if="isPhone && isEditorShown"
        class="flex-row items-center gap-2 px-4 pt-4 pb-2 pr-16"
      >
        <Button
          data-testid="skill-manager-back"
          variant="secondary"
          size="icon-sm"
          :aria-label="t('common.back')"
          @click="showSkillList"
        >
          <ChevronLeftIcon />
        </Button>
        <DialogTitle class="min-w-0 truncate leading-7">
          {{ isCreating ? t("skills.new") : selectedName }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("skills.description") }}
        </DialogDescription>
      </DialogHeader>
      <DialogHeader v-else class="px-6 pt-6 pb-4 pr-16">
        <DialogTitle>{{ t("skills.title") }}</DialogTitle>
        <DialogDescription>{{ t("skills.description") }}</DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeScope" class="min-h-0 gap-0 max-sm:flex-1">
        <div v-show="!isPhone || !isEditorShown" class="px-6 pb-4 max-sm:px-4">
          <TabsList class="w-full">
            <TabsTrigger value="global">
              {{ t("skills.scope.global") }}
            </TabsTrigger>
            <TabsTrigger value="project">
              {{ t("skills.scope.project") }}
            </TabsTrigger>
          </TabsList>
        </div>

        <Separator v-show="!isPhone || !isEditorShown" />

        <template v-for="scope in skillScopes" :key="scope">
          <TabsContent
            v-if="scope === activeScope"
            :value="scope"
            class="m-0 min-h-0 flex-none overflow-hidden max-sm:flex-1"
          >
            <div
              class="grid h-[min(40rem,calc(100dvh-14rem))] min-h-0 grid-cols-[15rem_auto_minmax(0,1fr)] overflow-hidden max-sm:h-full max-sm:grid-cols-1"
            >
              <aside
                v-show="!isPhone || !isEditorShown"
                class="relative min-h-0 overflow-hidden bg-muted/20 max-sm:bg-transparent"
              >
                <!-- ScrollAreaRoot sets an inline `position: relative`, so the
                  absolute positioning lives on a wrapper to keep the list out
                  of the grid row's height. -->
                <div class="absolute inset-0 flex flex-col">
                  <ItemGroup class="shrink-0 gap-2 p-3 pb-2">
                    <Item
                      as="button"
                      type="button"
                      variant="muted"
                      size="sm"
                      data-testid="skill-new"
                      class="min-h-20 justify-center hover:bg-muted active:bg-muted"
                      @click="createFromList"
                    >
                      <ItemMedia variant="icon">
                        <PlusIcon />
                      </ItemMedia>
                      <ItemContent class="flex-none">
                        <ItemTitle>{{ t("skills.new") }}</ItemTitle>
                      </ItemContent>
                    </Item>
                    <Item
                      as="button"
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="skill-create-with-pine"
                      class="justify-center hover:bg-muted active:bg-muted"
                      @click="createWithPine"
                    >
                      <ItemMedia variant="icon">
                        <SparklesIcon />
                      </ItemMedia>
                      <ItemContent class="flex-none">
                        <ItemTitle>{{ t("common.manageWithPine") }}</ItemTitle>
                      </ItemContent>
                    </Item>
                  </ItemGroup>
                  <ScrollArea
                    class="min-h-0 flex-1 overflow-hidden [&_[data-slot=scroll-area-viewport]]:scroll-fade-y"
                  >
                    <ItemGroup class="gap-1 px-3 pb-3">
                      <Item
                        v-if="isCreating && (!isPhone || isEditorShown)"
                        variant="muted"
                        size="sm"
                        role="listitem"
                        data-testid="skill-draft-item"
                      >
                        <ItemContent class="min-w-0">
                          <ItemTitle
                            class="w-full truncate"
                            :class="{ 'text-muted-foreground': !selectedName }"
                          >
                            {{ selectedName || t("skills.untitled") }}
                          </ItemTitle>
                        </ItemContent>
                        <ItemActions>
                          <Badge variant="outline">
                            {{ t("skills.draftBadge") }}
                          </Badge>
                        </ItemActions>
                      </Item>
                      <Item
                        v-for="skill in skills"
                        :key="`${skill.managedBy ?? 'pine'}:${skill.name}`"
                        :variant="
                          skill.name === selectedName && !isCreating
                            ? 'muted'
                            : 'default'
                        "
                        size="sm"
                        role="listitem"
                        class="min-w-0 hover:bg-muted active:bg-muted"
                      >
                        <ItemContent class="min-w-0">
                          <button
                            type="button"
                            class="min-w-0 text-left"
                            @click="
                              selectSkillSafely(
                                skill.name,
                                skill.managedBy ?? 'pine',
                              )
                            "
                          >
                            <ItemTitle class="w-full truncate">{{
                              skill.name
                            }}</ItemTitle>
                            <ItemDescription class="line-clamp-2">
                              {{ skill.description }}
                            </ItemDescription>
                          </button>
                        </ItemContent>
                        <ItemActions
                          v-if="scope === 'global' && skill.managedBy !== 'pi'"
                          class="shrink-0"
                        >
                          <Switch
                            :model-value="skill.enabled !== false"
                            :disabled="togglingNames.has(skill.name)"
                            :aria-label="
                              t('skills.globalEnabledLabel', {
                                name: skill.name,
                              })
                            "
                            @update:model-value="
                              setGlobalSkillEnabled(skill, $event)
                            "
                          />
                        </ItemActions>
                      </Item>
                    </ItemGroup>
                  </ScrollArea>
                </div>
              </aside>

              <Separator v-if="!isPhone" orientation="vertical" />

              <form
                v-show="!isPhone || isEditorShown"
                class="flex min-h-0 flex-col"
                novalidate
                @submit.prevent="save"
              >
                <Empty
                  v-if="editorMode === 'empty'"
                  data-testid="skill-empty"
                  class="border-0"
                >
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <WandSparklesIcon />
                    </EmptyMedia>
                    <EmptyTitle>{{ t("skills.empty") }}</EmptyTitle>
                    <EmptyDescription>
                      {{ t("skills.emptyDescription") }}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent class="flex-row justify-center">
                    <Button type="button" size="sm" @click="createFromList">
                      <PlusIcon data-icon="inline-start" />
                      {{ t("skills.new") }}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      @click="createWithPine"
                    >
                      <SparklesIcon data-icon="inline-start" />
                      {{ t("common.manageWithPine") }}
                    </Button>
                  </EmptyContent>
                </Empty>

                <template v-else>
                  <DialogScrollArea
                    edge-inset="0rem"
                    content-inset="1.25rem"
                    class="flex-1"
                    content-class="px-5 pt-5 pb-6 max-sm:px-4"
                  >
                    <p
                      v-if="isReadOnly"
                      class="mb-4 text-sm text-muted-foreground"
                    >
                      {{ t("skills.piPackageReadOnly") }}
                    </p>

                    <FieldGroup class="gap-6">
                      <Field
                        :data-invalid="
                          !!visibleError('name', nameError) || undefined
                        "
                      >
                        <FieldLabel :for="`skill-${scope}-name`">
                          {{ t("skills.nameLabel") }}
                        </FieldLabel>
                        <InputGroup :data-disabled="!isCreating || undefined">
                          <InputGroupInput
                            :id="`skill-${scope}-name`"
                            :model-value="selectedName"
                            :disabled="!isCreating"
                            :aria-invalid="
                              !!visibleError('name', nameError) || undefined
                            "
                            class="font-mono"
                            autocomplete="off"
                            spellcheck="false"
                            :placeholder="t('skills.namePlaceholder')"
                            @input="onNameInput"
                            @blur="touch('name')"
                          />
                          <InputGroupAddon v-if="isCreating" align="inline-end">
                            <InputGroupText class="tabular-nums">
                              {{ selectedName.length }}/{{
                                SKILL_NAME_MAX_LENGTH
                              }}
                            </InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                        <FieldError v-if="visibleError('name', nameError)">
                          {{ nameError }}
                        </FieldError>
                        <FieldDescription v-else-if="isCreating">
                          {{ t("skills.nameHint") }}
                        </FieldDescription>
                      </Field>

                      <Field
                        :data-invalid="
                          !!visibleError('description', descriptionError) ||
                          undefined
                        "
                      >
                        <FieldLabel :for="`skill-${scope}-description`">
                          {{ t("skills.descriptionLabel") }}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupTextarea
                            :id="`skill-${scope}-description`"
                            v-model="description"
                            :disabled="isReadOnly"
                            :aria-invalid="
                              !!visibleError('description', descriptionError) ||
                              undefined
                            "
                            rows="3"
                            class="min-h-20"
                            :placeholder="t('skills.descriptionPlaceholder')"
                            @blur="touch('description')"
                          />
                          <InputGroupAddon align="block-end">
                            <InputGroupText
                              class="ml-auto tabular-nums"
                              :class="{
                                'text-destructive':
                                  description.trim().length >
                                  SKILL_DESCRIPTION_MAX_LENGTH,
                              }"
                            >
                              {{ description.trim().length }}/{{
                                SKILL_DESCRIPTION_MAX_LENGTH
                              }}
                            </InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                        <FieldError
                          v-if="visibleError('description', descriptionError)"
                        >
                          {{ descriptionError }}
                        </FieldError>
                        <FieldDescription v-else>
                          {{ t("skills.descriptionHint") }}
                        </FieldDescription>
                      </Field>

                      <Field>
                        <div
                          class="flex flex-wrap items-center justify-between gap-2"
                        >
                          <FieldLabel :for="`skill-${scope}-body`">
                            {{ t("skills.instructionsLabel") }}
                          </FieldLabel>
                          <div
                            v-if="!isReadOnly && !body.trim()"
                            class="flex flex-wrap items-center gap-1"
                            data-testid="skill-templates"
                          >
                            <span class="text-xs text-muted-foreground">
                              {{ t("skills.templatesLabel") }}
                            </span>
                            <Button
                              v-for="template in SKILL_TEMPLATES"
                              :key="template"
                              type="button"
                              variant="outline"
                              size="xs"
                              :data-testid="`skill-template-${template}`"
                              @click="applyTemplate(template)"
                            >
                              {{ t(`skills.templates.${template}.label`) }}
                            </Button>
                          </div>
                        </div>
                        <!-- The group draws the border and fill; the fade masks only
                             the scrolling textarea inside it. -->
                        <InputGroup class="h-auto">
                          <InputGroupTextarea
                            :id="`skill-${scope}-body`"
                            v-model="body"
                            :disabled="isReadOnly"
                            class="scroll-fade-y max-h-80 min-h-40 overflow-y-auto overscroll-contain [field-sizing:content] font-mono text-[13px] leading-relaxed placeholder:font-sans"
                            spellcheck="false"
                            :placeholder="t('skills.contentPlaceholder')"
                          />
                        </InputGroup>
                        <FieldDescription>
                          {{ t("skills.instructionsHint") }}
                        </FieldDescription>
                        <div
                          v-if="!isCreating && resources.length > 0"
                          class="flex flex-wrap items-center gap-1.5"
                        >
                          <span class="text-xs text-muted-foreground">
                            {{ t("skills.resourcesLabel") }}
                          </span>
                          <Badge
                            v-for="resource in resources"
                            :key="resource.path"
                            variant="outline"
                            class="font-mono"
                          >
                            <FolderIcon v-if="resource.kind === 'directory'" />
                            <FileIcon v-else />
                            {{ resource.path }}
                          </Badge>
                        </div>
                      </Field>

                      <Field>
                        <FieldLabel :for="`skill-${scope}-license`">
                          {{ t("skills.licenseLabel") }}
                          <span class="font-normal text-muted-foreground">{{
                            t("skills.optional")
                          }}</span>
                        </FieldLabel>
                        <div class="flex gap-2 max-sm:flex-col">
                          <Select
                            v-model="licenseChoice"
                            :disabled="isReadOnly"
                          >
                            <SelectTrigger
                              :id="`skill-${scope}-license`"
                              class="w-44 max-sm:w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem :value="LICENSE_NONE">
                                  {{ t("skills.licenseNone") }}
                                </SelectItem>
                                <SelectSeparator />
                                <SelectItem
                                  v-for="preset in SKILL_LICENSE_PRESETS"
                                  :key="preset"
                                  :value="preset"
                                >
                                  {{ preset }}
                                </SelectItem>
                                <SelectSeparator />
                                <SelectItem :value="LICENSE_CUSTOM">
                                  {{ t("skills.licenseCustom") }}
                                </SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <Input
                            v-if="licenseChoice === LICENSE_CUSTOM"
                            v-model="customLicense"
                            :disabled="isReadOnly"
                            :aria-label="t('skills.licenseLabel')"
                            class="flex-1"
                            :placeholder="t('skills.licenseCustomPlaceholder')"
                          />
                        </div>
                      </Field>

                      <Field
                        :data-invalid="
                          !!visibleError('compatibility', compatibilityError) ||
                          undefined
                        "
                      >
                        <FieldLabel :for="`skill-${scope}-compatibility`">
                          {{ t("skills.compatibilityLabel") }}
                          <span class="font-normal text-muted-foreground">{{
                            t("skills.optional")
                          }}</span>
                        </FieldLabel>
                        <Input
                          :id="`skill-${scope}-compatibility`"
                          v-model="compatibility"
                          :disabled="isReadOnly"
                          :aria-invalid="
                            !!visibleError(
                              'compatibility',
                              compatibilityError,
                            ) || undefined
                          "
                          :placeholder="t('skills.compatibilityPlaceholder')"
                          @blur="touch('compatibility')"
                        />
                        <FieldError
                          v-if="
                            visibleError('compatibility', compatibilityError)
                          "
                        >
                          {{ compatibilityError }}
                        </FieldError>
                        <FieldDescription v-else>
                          {{ t("skills.compatibilityHint") }}
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel :for="`skill-${scope}-allowed-tools`">
                          {{ t("skills.allowedToolsLabel") }}
                          <span class="font-normal text-muted-foreground">{{
                            t("skills.optional")
                          }}</span>
                        </FieldLabel>
                        <SkillToolPicker
                          v-model="allowedTools"
                          :input-id="`skill-${scope}-allowed-tools`"
                          :disabled="isReadOnly"
                        />
                        <FieldDescription>
                          {{ t("skills.allowedToolsHint") }}
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </DialogScrollArea>

                  <div
                    v-if="!isReadOnly"
                    class="flex shrink-0 items-center gap-2 border-t px-5 py-3 max-sm:px-4"
                  >
                    <Button
                      v-if="!isCreating"
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="-ml-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      @click="removeSelected"
                    >
                      <Trash2Icon data-icon="inline-start" />
                      {{ t("common.delete") }}
                    </Button>
                    <span
                      v-if="isDirty"
                      class="text-xs text-muted-foreground"
                      data-testid="skill-unsaved"
                    >
                      {{ t("skills.unsaved") }}
                    </span>
                    <div class="ml-auto flex items-center gap-2">
                      <Button
                        v-if="isCreating"
                        type="button"
                        variant="ghost"
                        size="sm"
                        @click="cancelCreating"
                      >
                        {{ t("common.cancel") }}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        data-testid="skill-save"
                        :disabled="isSaving || (!isCreating && !isDirty)"
                      >
                        {{
                          isSaving
                            ? t("common.saving")
                            : isCreating
                              ? t("skills.create")
                              : t("common.save")
                        }}
                      </Button>
                    </div>
                  </div>
                </template>
              </form>
            </div>
          </TabsContent>
        </template>
      </Tabs>
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="isDeleteConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("skills.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("skills.deleteDescription", { name: deleteName }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isRemoving">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="isRemoving"
          @click="confirmRemoveSelected"
        >
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

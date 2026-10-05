<script setup lang="ts">
import type { Component } from "vue";
import {
  ArrowUpIcon,
  BrainCircuitIcon,
  ChevronDownIcon,
  CornerDownRightIcon,
  FileIcon,
  FolderIcon,
  HistoryIcon,
  PlusIcon,
  AtSignIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  SquareIcon,
  Undo2Icon,
} from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import ModelCapabilities from "@/components/models/ModelCapabilities.vue";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import ProviderIcon from "@/components/models/ProviderIcon.vue";
import ProjectApprovalCard from "@/components/project/ProjectApprovalCard.vue";
import ProjectQuestionnaireCard from "@/components/project/ProjectQuestionnaireCard.vue";
import ProjectAttachmentList from "@/components/project/ProjectAttachmentList.vue";
import SessionSearchOverlay from "@/components/sessions/SessionSearchOverlay.vue";
import ContextUsageIndicator from "@/components/project/ContextUsageIndicator.vue";
import ProjectTargetPicker from "@/components/project/ProjectTargetPicker.vue";
import ProjectNameChooserList from "@/components/project/ProjectNameChooserList.vue";
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
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useDraftProjectOpener } from "@/composables/useDraftProjectOpener";
import { useProjectDisplayName } from "@/composables/useProjectDisplayName";
import { projectIconComponent } from "@/lib/projectIcons";
import { projectNameMatches } from "@/lib/projectNameMatches";
import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import { cn } from "@/lib/utils";
import type { PineApprovalAction, PineApprovalMode } from "@/shared/agent";
import {
  attachmentMessagePreview,
  serializeAttachmentMessage,
  isPastedImageMimeType,
  shouldAttachPastedText,
  type PineAttachment,
  type PastedImageMimeType,
} from "@/shared/attachments";
import type { PineThinkingLevel } from "@/shared/models";
import type { SessionSearchResult } from "@/shared/sessions";
import type {
  PinePendingApproval,
  PinePendingQuestionnaire,
} from "@/stores/session";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import { pineModelKey, useModelsStore } from "@/stores/models";
import { useSessionStore } from "@/stores/session";

type ApprovalMode = PineApprovalMode;

const approvalModeColorClasses: Record<ApprovalMode, string> = {
  // Warning tone: manual supervision mode needs your attention, sitting
  // between the neutral Auto Approve and the destructive YOLO mode.
  "let-me-review": "text-warning",
  "auto-approve": "text-foreground",
  autonomous: "text-info",
  YOLO: "text-destructive",
};
interface ApprovalModeOption {
  value: ApprovalMode;
  label: string;
  description: string;
  icon: Component;
}

const emit = defineEmits<{
  abort: [];
  respond: [action: PineApprovalAction, guidance?: string];
  respondQuestionnaire: [submission: AskUserQuestionSubmission];
  selectProject: [projectId: string];
  submit: [message: string];
  withdrawSteering: [message: string];
}>();

const props = withDefaults(
  defineProps<{
    isRunning?: boolean;
    /** The tab's project; pasted files are stored in its Pine data. */
    projectId: string;
    /** Absent for a draft, which can still choose its project. */
    sessionId?: string;
    steeringMessages?: readonly string[];
    /** When set, the approval questionnaire replaces the message input. */
    isActive?: boolean;
    isResponding?: boolean;
    pendingApproval?: PinePendingApproval | null;
    /** When set, the structured question card replaces the message input. */
    pendingQuestionnaire?: PinePendingQuestionnaire | null;
  }>(),
  { isRunning: false, steeringMessages: () => [] },
);

const message = defineModel<string>({ default: "" });
const approvalMode = defineModel<ApprovalMode>("approvalMode", {
  default: "auto-approve",
});
const { t } = useI18n();
const modelsStore = useModelsStore();
const sessionStore = useSessionStore();
const { favoriteModels, featuredModels } = storeToRefs(modelsStore);
const selection = computed(() => modelsStore.selectionFor(props.sessionId));
const selectedModel = computed(() =>
  modelsStore.selectedModelFor(props.sessionId),
);
const messageId = useId();
const isModelPickerOpen = ref(false);
const isSessionPickerOpen = ref(false);
const isYoloConfirmationOpen = ref(false);
const attachments = defineModel<PineAttachment[]>("attachments", {
  default: () => [],
});
const hasMessage = computed(
  () => message.value.trim().length > 0 || attachments.value.length > 0,
);
const isSteering = computed(() => props.isRunning && hasMessage.value);
const canSubmit = computed(
  () =>
    props.isRunning ||
    (hasMessage.value &&
      selectedModel.value !== undefined &&
      !isMentioning.value),
);
const hasPendingInterruption = computed(() =>
  Boolean(props.pendingQuestionnaire || props.pendingApproval),
);
const approvalModes = computed<ApprovalModeOption[]>(() => [
  {
    value: "let-me-review",
    label: t("project.composer.approval.askForPermissionLabel"),
    description: t("project.composer.approval.askForPermission"),
    icon: ShieldIcon,
  },
  {
    value: "auto-approve",
    label: t("project.composer.approval.agentDecidesLabel"),
    description: t("project.composer.approval.agentDecides"),
    icon: ShieldCheckIcon,
  },
  {
    value: "autonomous",
    label: t("project.composer.approval.autonomousLabel"),
    description: t("project.composer.approval.autonomous"),
    icon: BrainCircuitIcon,
  },
  {
    value: "YOLO",
    label: t("project.composer.approval.yoloLabel"),
    description: t("project.composer.approval.yolo"),
    icon: ShieldOffIcon,
  },
]);
const selectedApprovalMode = computed(
  () =>
    approvalModes.value.find((option) => option.value === approvalMode.value) ??
    approvalModes.value[1],
);
const thinkingLevels = computed(
  () => selectedModel.value?.supportedThinkingLevels ?? [],
);
const thinkingLevelTooltips = computed<
  Partial<Record<PineThinkingLevel, string>>
>(() => ({
  max: t("models.thinkingLevelWarnings.max"),
  off: t("models.thinkingLevelWarnings.off"),
}));
const thinkingLevelSliderValue = computed<number[]>({
  get: () => {
    const selectedLevel = selection.value?.thinkingLevel;
    const selectedIndex = selectedLevel
      ? thinkingLevels.value.indexOf(selectedLevel)
      : -1;
    return [Math.max(selectedIndex, 0)];
  },
  set: (value) => updateThinkingLevel(value),
});
const activeThinkingLevel = computed(() => {
  const index = thinkingLevelSliderValue.value[0] ?? 0;
  return thinkingLevels.value[index];
});

function selectApprovalMode(value: unknown): void {
  if (value === "YOLO") {
    isYoloConfirmationOpen.value = true;
    return;
  }
  if (
    value === "let-me-review" ||
    value === "auto-approve" ||
    value === "autonomous"
  ) {
    approvalMode.value = value;
  }
}

function requestYoloConfirmation(value: ApprovalMode): void {
  if (value === "YOLO") isYoloConfirmationOpen.value = true;
}

function confirmYoloMode(): void {
  approvalMode.value = "YOLO";
  isYoloConfirmationOpen.value = false;
}

onMounted(() => void modelsStore.load());

// ⌘L / Ctrl+L jumps to the prompt from anywhere on the page.
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (
    !props.isActive ||
    event.key.toLowerCase() !== "l" ||
    !(event.metaKey || event.ctrlKey) ||
    event.shiftKey ||
    event.altKey ||
    event.defaultPrevented
  )
    return;
  const input = document.getElementById(messageId);
  if (!(input instanceof HTMLTextAreaElement)) return;
  event.preventDefault();
  input.focus();
});

/*
 * Choosing a project by name: typing "@" first in a draft's empty input
 * switches the input to a project name with live suggestions; the "@" shows
 * as the input's icon instead of as text. Choosing a project carries its
 * chip to the picker beside Send (a view transition) and returns to the
 * message input.
 */
const projectStore = useProjectStore();
const displayName = useProjectDisplayName();
const openForDraft = useDraftProjectOpener();
const isMentioning = ref(false);
const committingProject = ref<PineProject | null>(null);
const isMovingProject = ref(false);
const isInputFocused = ref(false);
const highlightedIndex = ref(0);
const chooserListId = `${messageId}-projects`;
/** Only the composer whose chip is moving carries the name, so it is unique. */
const PROJECT_MOVE_TRANSITION_NAME = "pine-draft-project";
const canMention = computed(
  () => !props.sessionId && !props.isRunning && !hasPendingInterruption.value,
);
const projectMatches = computed(() =>
  projectNameMatches(
    projectStore.projects,
    isMentioning.value ? message.value : "",
    displayName,
  ),
);
const highlightedProject = computed(
  () => projectMatches.value[highlightedIndex.value] ?? null,
);
const isChooserOpen = computed(
  () =>
    isMentioning.value &&
    !committingProject.value &&
    isInputFocused.value &&
    props.isActive,
);
const chooserInputAttrs = computed(() =>
  isMentioning.value
    ? {
        role: "combobox",
        "aria-autocomplete": "list" as const,
        "aria-expanded": isChooserOpen.value,
        "aria-controls": chooserListId,
        "aria-activedescendant": highlightedProject.value
          ? `${chooserListId}-${highlightedIndex.value}`
          : undefined,
      }
    : {},
);

// The textarea's model ignores a value that changes back within the same
// tick, so the "@" is removed one tick later, still before the next paint.
watch(message, (value) => {
  if (isMentioning.value || !canMention.value || !value.startsWith("@")) return;
  isMentioning.value = true;
  void nextTick(() => {
    if (message.value.startsWith("@")) message.value = message.value.slice(1);
  });
});

watch(canMention, (allowed) => {
  if (!allowed) isMentioning.value = false;
});

watch(projectMatches, () => {
  highlightedIndex.value = 0;
});

/** Let the browser carry the chip from the input to the picker. */
async function moveChosenProject(update: () => void): Promise<void> {
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (!document.startViewTransition || reduceMotion) {
    update();
    return;
  }
  isMovingProject.value = true;
  await nextTick();
  // Only the chip animates; the rest of the page stays live rather than
  // being snapshotted and cross-faded.
  const root = document.documentElement;
  root.dataset.movingDraftProject = "";
  const transition = document.startViewTransition(async () => {
    update();
    await nextTick();
  });
  try {
    await transition.finished;
  } finally {
    delete root.dataset.movingDraftProject;
    isMovingProject.value = false;
  }
}

/**
 * Resolve once a project switch has rendered and painted, and the window
 * has had a moment for the work it started, so the move animates smoothly.
 */
function afterProjectSwitch(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (typeof window.requestIdleCallback === "function")
          window.requestIdleCallback(() => resolve(), { timeout: 300 });
        else resolve();
      }),
    );
  });
}

async function chooseProject(project: PineProject): Promise<void> {
  if (committingProject.value) return;
  const query = message.value;
  committingProject.value = project;
  isMentioning.value = false;
  message.value = "";
  try {
    if (!(await openForDraft(project.id))) {
      message.value = query;
      isMentioning.value = true;
      return;
    }
    // Switch first, while the chip still shows the project in the input and
    // the picker stays hidden; animate only once the switch has painted.
    emit("selectProject", project.id);
    await nextTick();
    await afterProjectSwitch();
    // Even the current project moves, so choosing always lands visibly. The
    // chip leaves in the same update: two elements sharing the transition's
    // name would abort it.
    await moveChosenProject(() => {
      committingProject.value = null;
    });
  } finally {
    committingProject.value = null;
  }
}

function handleChooserKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const count = projectMatches.value.length;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!count) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlightedIndex.value = (highlightedIndex.value + step + count) % count;
    document
      .getElementById(`${chooserListId}-${highlightedIndex.value}`)
      ?.scrollIntoView({ block: "nearest" });
    return;
  }
  // A project name is one line, and is never sent as a message.
  if (event.key === "Enter") {
    event.preventDefault();
    if (!event.shiftKey && highlightedProject.value)
      void chooseProject(highlightedProject.value);
    return;
  }
  // Leaving the project name keeps what was typed as the message.
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    isMentioning.value = false;
    return;
  }
  if (event.key === "Backspace" && message.value === "") {
    event.preventDefault();
    isMentioning.value = false;
  }
}

function submitMessage(): void {
  const normalizedMessage = message.value.trim();
  if (!normalizedMessage && attachments.value.length === 0) return;

  emit(
    "submit",
    serializeAttachmentMessage(attachments.value, normalizedMessage),
  );
  attachments.value = [];
}

function handlePrimaryAction(): void {
  if (props.isRunning && !hasMessage.value) {
    emit("abort");
    return;
  }
  submitMessage();
}

function mergeAttachments(selected: readonly PineAttachment[]): void {
  const byPath = new Map(
    attachments.value.map((attachment) => [attachment.path, attachment]),
  );
  for (const attachment of selected) {
    byPath.set(attachment.path, attachment);
  }
  attachments.value = [...byPath.values()];
}

async function pickAttachments(kind: "directory" | "file"): Promise<void> {
  try {
    const result =
      kind === "directory"
        ? await window.pine.pickAttachmentFolders()
        : await window.pine.pickAttachments();
    mergeAttachments(result.attachments);
  } catch {
    toast.error(t("project.composer.attachmentPickerFailed"));
  }
}

function openSessionPicker(): void {
  window.setTimeout(() => {
    isSessionPickerOpen.value = true;
  });
}

async function attachSession(session: SessionSearchResult): Promise<void> {
  try {
    // The palette lists this project's sessions.
    const projectId = sessionStore.projectOf(session.id) ?? props.projectId;
    const result = await window.pine.attachSession({
      projectId,
      sessionId: session.id,
    });
    mergeAttachments([result.attachment]);
  } catch {
    toast.error(t("project.composer.sessionAttachmentFailed"));
  }
}

interface PastedImage {
  bytes: Uint8Array;
  mimeType: PastedImageMimeType;
  name?: string;
}

/**
 * Paste handling: clipboard files that map to a real filesystem path (files
 * copied from the shell) reuse the existing inspect flow. Pathless images and
 * large plain-text payloads are copied into the project's Pine-managed
 * attachment storage by the main process; ordinary text keeps native paste.
 */
async function handlePaste(event: ClipboardEvent): Promise<void> {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length > 0) {
    const paths: string[] = [];
    const pastedImages: PastedImage[] = [];
    for (const file of files) {
      let filePath = "";
      try {
        filePath = window.pine.getPathForFile(file);
      } catch {
        filePath = "";
      }
      if (filePath) {
        paths.push(filePath);
        continue;
      }
      if (isPastedImageMimeType(file.type)) {
        pastedImages.push({
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type,
          name: file.name || undefined,
        });
      }
    }
    // Nothing we can handle — let the browser's default paste proceed.
    if (paths.length === 0 && pastedImages.length === 0) return;
    event.preventDefault();

    try {
      const merged: PineAttachment[] = [];
      if (paths.length > 0) {
        const result = await window.pine.inspectAttachments({ paths });
        merged.push(...result.attachments);
      }
      for (const image of pastedImages) {
        const result = await window.pine.savePastedAttachment({
          ...image,
          projectId: props.projectId,
        });
        merged.push(result.attachment);
      }
      mergeAttachments(merged);
    } catch {
      toast.error(t("project.composer.attachmentPasteFailed"));
    }
    return;
  }

  const pastedText = event.clipboardData?.getData?.("text/plain") ?? "";
  if (!shouldAttachPastedText(pastedText)) return;

  const textarea = event.currentTarget as HTMLTextAreaElement | null;
  const selectionStart = textarea?.selectionStart ?? message.value.length;
  const selectionEnd = textarea?.selectionEnd ?? selectionStart;
  event.preventDefault();

  try {
    const result = await window.pine.savePastedAttachment({
      mimeType: "text/plain",
      projectId: props.projectId,
      name: "pasted-text.txt",
      text: pastedText,
    });
    mergeAttachments([result.attachment]);
  } catch {
    message.value = `${message.value.slice(0, selectionStart)}${pastedText}${message.value.slice(selectionEnd)}`;
    toast.error(t("project.composer.attachmentPasteFailed"));
  }
}

function removeAttachment(path: string): void {
  attachments.value = attachments.value.filter(
    (attachment) => attachment.path !== path,
  );
}

function handleKeydown(event: KeyboardEvent): void {
  if (isMentioning.value) {
    handleChooserKeydown(event);
    return;
  }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

  event.preventDefault();
  submitMessage();
}

function updateThinkingLevel(value: unknown): void {
  if (Array.isArray(value)) {
    const index = value[0];
    if (typeof index !== "number") return;
    value = thinkingLevels.value[index];
  }
  if (
    typeof value !== "string" ||
    !thinkingLevels.value.includes(value as PineThinkingLevel)
  ) {
    return;
  }
  void modelsStore.setThinkingLevel(
    value as PineThinkingLevel,
    props.sessionId,
  );
}

function thinkingLevelTextClass(
  level: PineThinkingLevel | undefined,
): string | undefined {
  if (level === "max") return "text-thinking-max!";
  if (level === "off") return "text-destructive!";
  return undefined;
}

function thinkingLevelTooltip(
  level: PineThinkingLevel | undefined,
): string | undefined {
  return level ? thinkingLevelTooltips.value[level] : undefined;
}

function selectFeaturedModel(value: unknown): void {
  if (typeof value !== "string") return;
  const model = featuredModels.value.find(
    (candidate) => pineModelKey(candidate) === value,
  );
  if (model) void modelsStore.select(model, undefined, props.sessionId);
}

function openModelPicker(): void {
  window.setTimeout(() => {
    isModelPickerOpen.value = true;
  });
}

function handleRootSubmit(event: Event): void {
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  submitMessage();
}
</script>

<template>
  <component
    :is="hasPendingInterruption ? 'div' : 'form'"
    :class="
      cn(
        'mx-auto w-full max-w-[var(--session-composer-max-width)] px-[var(--session-composer-gutter)]',
        hasPendingInterruption ? 'pb-4' : 'pb-3',
      )
    "
    @submit="handleRootSubmit"
  >
    <label class="sr-only" :for="messageId">
      {{ t("project.composer.label") }}
    </label>

    <ProjectQuestionnaireCard
      v-if="props.pendingQuestionnaire"
      :key="props.pendingQuestionnaire.requestId"
      :questionnaire="props.pendingQuestionnaire"
      @respond="(submission) => emit('respondQuestionnaire', submission)"
    />
    <ProjectApprovalCard
      v-else-if="props.pendingApproval"
      :key="props.pendingApproval.requestId"
      :is-active="props.isActive"
      :is-responding="props.isResponding"
      :approval="props.pendingApproval"
      @respond="(action, guidance) => emit('respond', action, guidance)"
    />
    <template v-else>
      <div
        v-if="props.steeringMessages.length > 0"
        data-slot="staged-steering-messages"
        class="scroll-fade-y no-scrollbar mb-2 flex max-h-64 flex-col items-end gap-2 overflow-y-auto overscroll-contain"
      >
        <div
          v-for="(steeringMessage, index) in props.steeringMessages"
          :key="`${steeringMessage}-${index}`"
          data-slot="staged-steering-message"
          class="flex w-full items-center justify-end gap-2"
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            :aria-label="t('project.composer.withdrawSteering')"
            @click="emit('withdrawSteering', steeringMessage)"
          >
            <Undo2Icon />
          </Button>
          <Bubble align="end" variant="outline">
            <BubbleContent class="border-dashed">
              <div
                class="scroll-fade-y max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap"
              >
                {{ attachmentMessagePreview(steeringMessage) }}
              </div>
            </BubbleContent>
          </Bubble>
        </div>
      </div>

      <Popover :open="isChooserOpen">
        <PopoverAnchor as-child>
          <InputGroup
            class="session-composer-control flex-col items-stretch min-h-[var(--session-composer-control-height)] rounded-[var(--session-composer-control-radius)] has-[textarea]:rounded-[var(--session-composer-control-radius)]"
          >
            <ProjectAttachmentList
              v-if="attachments.length > 0"
              class="session-composer-attachments shrink-0 w-full px-[var(--session-composer-control-inset)] pt-[var(--session-composer-control-inset)] pb-0"
              :attachments="attachments"
              removable
              surface="composer"
              @remove="removeAttachment"
            />

            <div class="flex w-full items-center">
              <InputGroupAddon
                class="self-end py-1.5 pl-2.5"
                align="inline-start"
              >
                <span
                  v-if="isMentioning || committingProject"
                  data-slot="project-chooser-chip"
                  class="-ml-1 flex h-[var(--session-composer-action-size)] min-w-[var(--session-composer-action-size)] max-w-48 items-center justify-center gap-2 rounded-full bg-secondary text-secondary-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                  :class="committingProject ? 'px-3' : 'px-0'"
                  :style="
                    isMovingProject
                      ? { viewTransitionName: PROJECT_MOVE_TRANSITION_NAME }
                      : undefined
                  "
                  aria-hidden="true"
                >
                  <component
                    :is="
                      committingProject
                        ? projectIconComponent(committingProject)
                        : AtSignIcon
                    "
                  />
                  <span v-if="committingProject" class="truncate text-sm">
                    {{ displayName(committingProject) }}
                  </span>
                </span>
                <DropdownMenu v-else>
                  <DropdownMenuTrigger as-child>
                    <InputGroupButton
                      data-slot="attachment-menu-trigger"
                      class="size-[var(--session-composer-action-size)] shrink-0 rounded-full"
                      size="icon-sm"
                      type="button"
                      variant="secondary"
                      :aria-label="t('project.composer.addAttachment')"
                    >
                      <PlusIcon />
                    </InputGroupButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    <DropdownMenuGroup>
                      <DropdownMenuItem @select="pickAttachments('file')">
                        <FileIcon />
                        {{ t("project.composer.addFile") }}
                      </DropdownMenuItem>
                      <DropdownMenuItem @select="pickAttachments('directory')">
                        <FolderIcon />
                        {{ t("project.composer.addFolder") }}
                      </DropdownMenuItem>
                      <DropdownMenuItem @select="openSessionPicker">
                        <HistoryIcon />
                        {{ t("project.composer.addSession") }}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </InputGroupAddon>

              <InputGroupTextarea
                :id="messageId"
                v-model="message"
                v-bind="chooserInputAttrs"
                class="session-composer-input scroll-fade-y max-h-48 min-h-[var(--session-composer-control-height)] overflow-y-auto overscroll-contain pt-3.5 pb-3.5 text-sm leading-5"
                :placeholder="
                  committingProject
                    ? ''
                    : isMentioning
                      ? t('project.composer.chooseProjectPlaceholder')
                      : props.isRunning
                        ? t('project.composer.steeringPlaceholder')
                        : props.sessionId
                          ? t('project.composer.placeholder')
                          : t('project.composer.draftPlaceholder')
                "
                @focus="isInputFocused = true"
                @blur="isInputFocused = false"
                @keydown="handleKeydown"
                @paste="handlePaste"
              />

              <InputGroupAddon
                class="max-w-[50%] self-end py-1.5 pr-2.5"
                align="inline-end"
              >
                <!-- A draft still chooses its project right beside Send. -->
                <ProjectTargetPicker
                  v-if="
                    !props.sessionId &&
                    !props.isRunning &&
                    !isMentioning &&
                    !committingProject
                  "
                  :project-id="props.projectId"
                  :transition-name="
                    isMovingProject ? PROJECT_MOVE_TRANSITION_NAME : undefined
                  "
                  @select="emit('selectProject', $event)"
                />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      class="size-[var(--session-composer-action-size)] shrink-0 rounded-full"
                      size="icon-sm"
                      variant="default"
                      :disabled="!canSubmit"
                      :aria-label="
                        isSteering
                          ? t('project.composer.steer')
                          : props.isRunning
                            ? t('project.composer.stop')
                            : t('project.composer.send')
                      "
                      @click="handlePrimaryAction"
                    >
                      <CornerDownRightIcon v-if="isSteering" />
                      <SquareIcon v-else-if="props.isRunning" />
                      <ArrowUpIcon v-else />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {{
                      isSteering
                        ? t("project.composer.steer")
                        : props.isRunning
                          ? t("project.composer.stop")
                          : t("project.composer.send")
                    }}
                  </TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </div>
          </InputGroup>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          :side-offset="8"
          class="w-72 p-1.5"
          @open-auto-focus.prevent
          @close-auto-focus.prevent
        >
          <ProjectNameChooserList
            :list-id="chooserListId"
            :matches="projectMatches"
            :highlighted="highlightedIndex"
            @highlight="highlightedIndex = $event"
            @select="chooseProject"
          />
        </PopoverContent>
      </Popover>
    </template>

    <SessionSearchOverlay
      v-model:open="isSessionPickerOpen"
      purpose="attach"
      @select="attachSession"
    />

    <!-- While a user decision is pending the card owns the composer area:
         the mode selector, context ring, and model picker are all moot
         until the decision is made. -->
    <div
      v-if="!hasPendingInterruption"
      class="flex min-w-0 items-center justify-between gap-3 pt-2"
    >
      <div class="flex min-w-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              data-slot="approval-mode-trigger"
              class="min-w-0"
              type="button"
              variant="ghost"
              size="sm"
            >
              <component
                :is="selectedApprovalMode.icon"
                :class="approvalModeColorClasses[selectedApprovalMode.value]"
                data-icon="inline-start"
              />
              <span
                :class="
                  cn(
                    'truncate',
                    approvalModeColorClasses[selectedApprovalMode.value],
                  )
                "
              >
                {{ selectedApprovalMode.label }}
              </span>
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" class="w-72">
            <DropdownMenuRadioGroup
              :model-value="approvalMode"
              @update:model-value="selectApprovalMode"
            >
              <DropdownMenuRadioItem
                v-for="option in approvalModes"
                :key="option.value"
                :value="option.value"
                @select="requestYoloConfirmation(option.value)"
              >
                <component
                  :is="option.icon"
                  :class="approvalModeColorClasses[option.value]"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span :class="approvalModeColorClasses[option.value]">
                    {{ option.label }}
                  </span>
                  <span
                    class="whitespace-normal text-xs font-normal text-muted-foreground"
                  >
                    {{ option.description }}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <ContextUsageIndicator />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            data-slot="model-selector-trigger"
            class="min-w-0"
            type="button"
            variant="ghost"
            size="sm"
          >
            <span class="truncate">
              {{ selectedModel?.name ?? t("project.composer.selectModel") }}
            </span>
            <span
              v-if="selectedModel && selection"
              data-slot="model-selector-thinking-level"
              :class="
                cn(
                  'shrink-0 text-muted-foreground',
                  thinkingLevelTextClass(selection.thinkingLevel),
                )
              "
            >
              · {{ t(`models.thinkingLevels.${selection.thinkingLevel}`) }}
            </span>
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="end" class="w-72">
          <template v-if="featuredModels.length > 0">
            <DropdownMenuLabel>
              {{
                favoriteModels.length > 0
                  ? t("models.favorites")
                  : t("models.recent")
              }}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              :model-value="selectedModel ? pineModelKey(selectedModel) : ''"
              @update:model-value="selectFeaturedModel"
            >
              <DropdownMenuRadioItem
                v-for="model in featuredModels"
                :key="pineModelKey(model)"
                data-slot="model-option"
                :value="pineModelKey(model)"
              >
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate">{{ model.name }}</span>
                  <span
                    class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
                  >
                    <ProviderIcon
                      :provider-id="model.providerId"
                      :provider-name="model.providerName"
                    />
                    <span class="truncate">{{ model.providerName }}</span>
                    <ModelCapabilities
                      class="ml-1"
                      :model="model"
                      :recommended="modelsStore.isRecommended(model)"
                    />
                  </span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </template>

          <DropdownMenuGroup>
            <DropdownMenuItem @select="openModelPicker">
              <SearchIcon />
              {{ t("models.picker.browse") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <template v-if="selectedModel && thinkingLevels.length > 1">
            <DropdownMenuSeparator />
            <div data-slot="reasoning-effort-control" class="w-full">
              <DropdownMenuLabel class="flex items-center justify-between">
                <span>{{ t("models.reasoning") }}</span>
                <span
                  v-if="activeThinkingLevel"
                  :class="thinkingLevelTextClass(activeThinkingLevel)"
                >
                  {{ t(`models.thinkingLevels.${activeThinkingLevel}`) }}
                </span>
              </DropdownMenuLabel>

              <div class="px-3 pb-4">
                <Tooltip :disabled="!thinkingLevelTooltip(activeThinkingLevel)">
                  <Slider
                    v-model="thinkingLevelSliderValue"
                    data-slot="reasoning-effort-slider"
                    class="reasoning-effort-slider"
                    :min="0"
                    :max="thinkingLevels.length - 1"
                    :step="1"
                    :aria-label="t('models.reasoning')"
                  >
                    <template #thumb>
                      <TooltipTrigger as-child>
                        <span />
                      </TooltipTrigger>
                    </template>
                  </Slider>
                  <TooltipContent
                    v-if="thinkingLevelTooltip(activeThinkingLevel)"
                    data-slot="reasoning-effort-tooltip"
                    side="top"
                    align="center"
                    :side-offset="8"
                    class="max-w-80 whitespace-normal"
                  >
                    {{ thinkingLevelTooltip(activeThinkingLevel) }}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <AlertDialog v-model:open="isYoloConfirmationOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("project.composer.approval.yoloConfirmTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {{ t("project.composer.approval.yoloConfirmDescription") }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction
            data-slot="yolo-confirm-action"
            variant="destructive"
            @click="confirmYoloMode"
          >
            {{ t("project.composer.approval.yoloConfirmAction") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <ModelPickerDialog
      v-model:open="isModelPickerOpen"
      :session-id="props.sessionId"
    />
  </component>
</template>

<style scoped>
.session-composer-control {
  /* Override the InputGroup base `h-9` fixed height. The base auto-sizes via
     `has-[>textarea]:h-auto`, but the composer's textarea is wrapped in a
     sibling div, so that direct-child selector never fires and the fixed
     height would flex-shrink the attachment row to nothing. */
  height: auto;
  --session-composer-control-height: 3rem;
  --session-composer-control-radius: calc(
    var(--session-composer-control-height) / 2
  );
  --session-composer-control-inset: 0.375rem;
  --session-composer-attachment-radius: calc(
    var(--session-composer-control-radius) -
      var(--session-composer-control-inset)
  );
  --session-composer-action-size: calc(
    var(--session-composer-control-height) - 2 *
      var(--session-composer-control-inset)
  );
}

.session-composer-input {
  padding-inline-start: var(--session-composer-control-inset);
  padding-inline-end: var(--session-input-padding-inline, 1rem);
}

.reasoning-effort-slider :deep([data-slot="slider-thumb"]),
.reasoning-effort-slider :deep([data-slot="slider-range"]) {
  transition-property: left, right;
  transition-duration: 500ms;
  transition-timing-function: var(--ease-out-expo);
}
</style>

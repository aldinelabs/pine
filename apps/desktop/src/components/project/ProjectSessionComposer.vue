<script setup lang="ts">
import { isWebClient } from "@/lib/clientRuntime";
import type { Component, Ref } from "vue";
import {
  ArrowUpIcon,
  BrainCircuitIcon,
  ChevronDownIcon,
  CircleHelpIcon,
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
} from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import ModelCapabilities from "@/components/models/ModelCapabilities.vue";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import ProviderIcon from "@/components/models/ProviderIcon.vue";
import ProjectComposerContext from "@/components/project/ProjectComposerContext.vue";
import ProjectComposerAuthoring from "@/components/project/ProjectComposerAuthoring.vue";
import ProjectComposerEasedHeight from "@/components/project/ProjectComposerEasedHeight.vue";
import ProjectComposerWorkingBorder from "@/components/project/ProjectComposerWorkingBorder.vue";
import type { PineAuthoringTarget } from "@/shared/sessionMutators";
import AutomationApprovalCard from "@/components/automations/AutomationApprovalCard.vue";
import ProjectApprovalCard from "@/components/project/ProjectApprovalCard.vue";
import ProjectQuestionnaireCard from "@/components/project/ProjectQuestionnaireCard.vue";
import ProjectAttachmentList from "@/components/project/ProjectAttachmentList.vue";
import ProjectQuoteList from "@/components/project/ProjectQuoteList.vue";
import { serializeQuoteMessage, type PineQuote } from "@/shared/quotes";
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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useCollapseTransition } from "@/composables/useCollapseTransition";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import { useModifierHold } from "@/composables/useModifierHold";
import ProjectComposerOptimizeButton from "@/components/project/ProjectComposerOptimizeButton.vue";
import ComposerKeycap from "@/components/project/ComposerKeycap.vue";
import { useShortcutHints } from "@/composables/useShortcutHints";
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
import { useAppearanceStore } from "@/stores/appearance";
import { useProjectStore } from "@/stores/project";
import { cn } from "@/lib/utils";
import type { PineApprovalAction, PineApprovalMode } from "@/shared/agent";
import type { AutomationApprovalRequest } from "@/shared/automation";
import {
  serializeAttachmentMessage,
  isPastedImageMimeType,
  shouldAttachPastedText,
  type PineAttachment,
  type PastedImageMimeType,
} from "@/shared/attachments";
import type { PineThinkingLevel } from "@/shared/models";
import {
  MAX_PROMPT_REWRITE_INPUT_LENGTH,
  PROMPT_REWRITE_LIMITS,
  PROMPT_REWRITE_PLACEHOLDER_PATTERN,
  promptRewriteConversation,
  type PromptRewriteContext,
} from "@/shared/promptRewrite";
import { withoutRelayPrefix } from "@/shared/sessions";
import { onSessionEvent } from "@/client/sessionEvents";
import { useHelpStore } from "@/stores/help";
import { useSessionStore } from "@/stores/session";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import type {
  PinePendingApproval,
  PinePendingQuestionnaire,
} from "@/stores/session";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import { pineModelKey, useModelsStore } from "@/stores/models";

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
  /** Backspace or \ in an empty message, while there is context to drop. */
  dismissContext: [];
  removeAuthoring: [target: PineAuthoringTarget];
  respond: [action: PineApprovalAction, guidance?: string];
  respondQuestionnaire: [submission: AskUserQuestionSubmission];
  selectProject: [projectId: string];
  /**
   * `holdView`: sent with Option/Alt+Enter, the transcript stays where it
   * is instead of scrolling to the new turn.
   */
  submit: [message: string, options?: { holdView?: boolean }];
}>();

const props = withDefaults(
  defineProps<{
    isRunning?: boolean;
    /**
     * Taken from the app the user was in; shown on its own and dropped with
     * Backspace or \\ in an empty message. The parent sends it.
     */
    context?: readonly PineAttachment[];
    /** False to show or drop the context at once. */
    contextAnimates?: boolean;
    /**
     * False to resize at once for the quotes, attachments and authoring
     * rows, as when a hidden panel resets.
     */
    rowsAnimate?: boolean;
    /** Authoring a "Create with Pine" draft turns on with its first message. */
    authoring?: readonly PineAuthoringTarget[];
    /**
     * Holds the mode and model controls below the input further in, clear of
     * the floating composer's rounder card; they ease out when it turns off.
     */
    edgeInset?: boolean;
    /** The tab's project; pasted files are stored in its Pine data. */
    projectId: string;
    /** Absent for a draft, which can still choose its project. */
    sessionId?: string;
    /** When set, the approval questionnaire replaces the message input. */
    isActive?: boolean;
    isResponding?: boolean;
    pendingApproval?: PinePendingApproval | null;
    /** When set, the structured question card replaces the message input. */
    pendingQuestionnaire?: PinePendingQuestionnaire | null;
    /** When set, the automation approval replaces the message input. */
    pendingAutomationApproval?: AutomationApprovalRequest | null;
  }>(),
  {
    context: () => [],
    contextAnimates: true,
    rowsAnimate: true,
    authoring: () => [],
    isRunning: false,
  },
);

const message = defineModel<string>({ default: "" });
const approvalMode = defineModel<ApprovalMode>("approvalMode", {
  default: "auto-approve",
});
const { t } = useI18n();
const showShortcutHints = useShortcutHints();
const isWeb = isWebClient();
const modelsStore = useModelsStore();
const { favoriteModels, featuredModels } = storeToRefs(modelsStore);
const selection = computed(() => modelsStore.selectionFor(props.sessionId));
const selectedModel = computed(() =>
  modelsStore.selectedModelFor(props.sessionId),
);
/**
 * The Model control's accessible name: a narrow footer hides the reasoning
 * effort and then the model name, so they stay readable here.
 */
const modelTriggerLabel = computed(() => {
  const model = selectedModel.value;
  if (!model) return t("project.composer.selectModel");
  const level = selection.value?.thinkingLevel;
  return level
    ? `${model.name} · ${t(`models.thinkingLevels.${level}`)}`
    : model.name;
});
const messageId = useId();
const isModelPickerOpen = ref(false);
const isApprovalMenuOpen = ref(false);
const isModelMenuOpen = ref(false);
const isSessionPickerOpen = ref(false);
const isYoloConfirmationOpen = ref(false);
const attachments = defineModel<PineAttachment[]>("attachments", {
  default: () => [],
});
/** Passages quoted from the conversation, sent ahead of the prompt. */
const quotes = defineModel<PineQuote[]>("quotes", {
  default: () => [],
});
const hasMessage = computed(
  () =>
    message.value.trim().length > 0 ||
    attachments.value.length > 0 ||
    quotes.value.length > 0,
);
const isSteering = computed(() => props.isRunning && hasMessage.value);
const canSubmit = computed(
  () =>
    !isRewriting.value &&
    (props.isRunning ||
      (hasMessage.value &&
        selectedModel.value !== undefined &&
        !isMentioning.value)),
);
const hasPendingInterruption = computed(() =>
  Boolean(
    props.pendingQuestionnaire ||
    props.pendingApproval ||
    props.pendingAutomationApproval,
  ),
);
/**
 * The text box's border lights up while this tab's agent works, unless
 * Working glow is off in Appearance settings; background tabs stay still.
 * Approval and questionnaire cards replace the text box, so the border goes
 * with it. Turning the setting off mid-run takes the normal exit.
 */
const appearanceStore = useAppearanceStore();
const helpStore = useHelpStore();
const isRewriting = ref(false);
const workingBorderActive = computed(() =>
  Boolean(
    (props.isRunning || isRewriting.value) &&
    props.isActive &&
    appearanceStore.composerGlow,
  ),
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

function focus(): void {
  document.getElementById(messageId)?.focus({ preventScroll: true });
}

defineExpose({ focus });

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
  if (!(document.getElementById(messageId) instanceof HTMLTextAreaElement))
    return;
  event.preventDefault();
  focus();
});

// ⌘R / Ctrl+R opens the approval mode menu and ⌘I / Ctrl+I the model menu.
// The main process keeps the menu's reload accelerator off plain ⌘R.
const menuShortcuts: Record<string, Ref<boolean>> = {
  r: isApprovalMenuOpen,
  i: isModelMenuOpen,
};
/** Text fields outside the composer keep ⌘R / ⌘I to themselves. */
function isOtherTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-slot="session-composer"]')) return false;
  if (target instanceof HTMLInputElement)
    return !["button", "checkbox", "radio", "reset", "submit"].includes(
      target.type,
    );
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
// Holding Cmd/Ctrl makes room beside each menu's chevron for its shortcut.
const modifierHeld = useModifierHold();
const menuShortcutTransition = useCollapseTransition("width");
const modifierLabel =
  (window.pine?.platform ?? "darwin") === "darwin" ? "⌘" : "Ctrl";
const altKeyLabel =
  (window.pine?.platform ?? "darwin") === "darwin" ? "⌥" : "Alt";
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  const menu = menuShortcuts[event.key.toLowerCase()];
  if (
    !menu ||
    !props.isActive ||
    !(event.metaKey || event.ctrlKey) ||
    event.shiftKey ||
    event.altKey ||
    event.defaultPrevented ||
    isOtherTextField(event.target)
  )
    return;
  if (!(document.getElementById(messageId) instanceof HTMLTextAreaElement))
    return;
  event.preventDefault();
  if (event.repeat) return;
  menu.value = true;
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

/*
 * Optimize prompt (⌘/Ctrl+Enter): the prompt rewrite model rewrites what was
 * typed, leaving [[blanks]] for what only the user knows. The input is
 * disabled meanwhile and the working border runs in colour; Escape cancels.
 */
let rewriteRun = 0;
/** What was typed before the last rewrite; Undo takes Optimize's place. */
const promptBeforeRewrite = ref<string | null>(null);
watch(message, (value) => {
  if (!value) promptBeforeRewrite.value = null;
});

function undoRewrite(): void {
  if (promptBeforeRewrite.value === null) return;
  message.value = promptBeforeRewrite.value;
  promptBeforeRewrite.value = null;
  void nextTick(focus);
}
const canRewrite = computed(
  () =>
    message.value.trim().length > 0 &&
    message.value.length <= MAX_PROMPT_REWRITE_INPUT_LENGTH &&
    !isRewriting.value &&
    !isMentioning.value &&
    !committingProject.value &&
    !hasPendingInterruption.value,
);

const messageInput = ref<{ $el?: unknown } | null>(null);

/**
 * Replace the whole message as an edit of the text box, so Cmd/Ctrl+Z in the
 * box also brings back what was typed; falls back to setting it directly.
 */
function replaceMessageUndoably(text: string): void {
  const textarea = messageInput.value?.$el;
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus({ preventScroll: true });
    textarea.select();
    try {
      document.execCommand("insertText", false, text);
    } catch {
      // Not supported here; set the value below.
    }
  }
  if (message.value !== text) message.value = text;
}

/** Select the first blank to fill in, or put the caret at the end. */
function focusFirstBlank(): void {
  const textarea = messageInput.value?.$el;
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  textarea.focus({ preventScroll: true });
  const blank = PROMPT_REWRITE_PLACEHOLDER_PATTERN.exec(textarea.value);
  if (blank) {
    textarea.setSelectionRange(blank.index, blank.index + blank[0].length);
  } else {
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }
}

function clipText(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * What the rewriter is told besides the draft: the project, the
 * conversation's opening request and latest messages (trimmed as
 * `promptRewriteConversation` decides), and what is attached or quoted.
 */
/** The project and the conversation so far, trimmed to whole turns. */
function conversationContext(): PromptRewriteContext {
  const context: PromptRewriteContext = {};
  const project = projectStore.projectById(props.projectId);
  if (project) {
    context.project = {
      name: clipText(displayName(project), PROMPT_REWRITE_LIMITS.nameLength),
      folders: project.folders
        .slice(0, PROMPT_REWRITE_LIMITS.folders)
        .map((folder) =>
          clipText(folder.path, PROMPT_REWRITE_LIMITS.pathLength),
        ),
    };
  }
  if (props.sessionId) {
    const state = useSessionStore().stateFor(props.sessionId);
    const { conversation, trimmed } = promptRewriteConversation(
      state.messages.map((item) => {
        const text = item.blocks
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
        return {
          role: item.role,
          text: item.role === "user" ? withoutRelayPrefix(text) : text,
        };
      }),
    );
    if (conversation.length > 0) {
      context.conversation = conversation;
      context.conversationTrimmed = trimmed || state.hasEarlierMessages;
    }
  }
  return context;
}

function rewriteContext(): PromptRewriteContext {
  const context = conversationContext();
  // A draft typed while the agent works steers that turn.
  if (props.isRunning) context.steering = true;
  const attached = [...props.context, ...attachments.value];
  if (attached.length > 0) {
    context.attachments = attached
      .slice(0, PROMPT_REWRITE_LIMITS.attachments)
      .map((attachment) => ({
        name: clipText(attachment.name, PROMPT_REWRITE_LIMITS.nameLength),
        path: clipText(attachment.path, PROMPT_REWRITE_LIMITS.pathLength),
        ...(attachment.kind ? { kind: attachment.kind } : {}),
      }));
  }
  if (quotes.value.length > 0) {
    context.quotes = quotes.value
      .slice(0, PROMPT_REWRITE_LIMITS.quotes)
      .map((quote) => ({
        text: clipText(quote.text, PROMPT_REWRITE_LIMITS.quoteLength),
        ...(quote.file
          ? { file: clipText(quote.file, PROMPT_REWRITE_LIMITS.pathLength) }
          : {}),
        ...(quote.lines ? { lines: quote.lines.slice(0, 32) } : {}),
      }));
  }
  return context;
}

async function rewritePrompt(): Promise<void> {
  if (!canRewrite.value) return;
  const original = message.value;
  const run = ++rewriteRun;
  promptBeforeRewrite.value = null;
  isRewriting.value = true;
  try {
    const result = await window.pine.rewritePrompt({
      prompt: original,
      context: rewriteContext(),
    });
    if (run !== rewriteRun) return;
    isRewriting.value = false;
    await nextTick();
    replaceMessageUndoably(result.prompt);
    promptBeforeRewrite.value = original;
    await nextTick();
    focusFirstBlank();
  } catch {
    if (run !== rewriteRun) return;
    isRewriting.value = false;
    toast.error(t("project.composer.optimizePromptFailed"), {
      description: t("project.composer.optimizePromptFailedDescription"),
    });
    await nextTick();
    focus();
  }
}

/*
 * Reply suggestion: once the agent finishes answering, the prompt rewrite
 * model guesses the user's next message. It takes the placeholder's place
 * while the text box is empty and nothing is being typed, and Tab or → fills
 * it in and uses it up. Typing hides it without using it up, so emptying the
 * box shows it again until the next run.
 *
 * The model offers a few alternatives in one request. They stream in: the
 * first replaces the placeholder as soon as it is complete, the others join
 * as they finish, and ↑/↓ in the empty box steps through them, stopping at
 * the first and last rather than wrapping, so the cap's ↑ and ↓ show only
 * where there is one to step to.
 *
 * Only a suggestion that arrives over a visible placeholder fades: the
 * placeholder fades out, then the suggestion fades in. When it comes back
 * after typing, the placeholder was hidden by the text, so the suggestion
 * returns at once and the placeholder never shows in between.
 */
const replySuggestions = ref<string[]>([]);
const replySuggestionIndex = ref(0);
/** False while alternatives are still streaming in. */
const replySuggestionsComplete = ref(true);
const replySuggestion = computed(
  () => replySuggestions.value[replySuggestionIndex.value] ?? "",
);
let suggestionRun = 0;
// v-model holds back the text while an input method composes it, so the
// composition itself has to hide the suggestion.
const isComposingText = ref(false);
const showsReplySuggestion = computed(
  () =>
    replySuggestion.value.length > 0 &&
    message.value === "" &&
    !isComposingText.value &&
    !props.isRunning &&
    !isRewriting.value &&
    !isMentioning.value &&
    !committingProject.value,
);
const replySuggestionId = `${messageId}-suggestion`;
const replySuggestionFades = ref(false);
watch(replySuggestion, (suggestion, previous) => {
  // Stepping to another alternative is not an arrival.
  if (previous) return;
  replySuggestionFades.value =
    suggestion.length > 0 && message.value === "" && !isComposingText.value;
});
watch(showsReplySuggestion, (shows) => {
  if (!shows) replySuggestionFades.value = false;
});
/**
 * "2/3" once every alternative is in, "2" while more may come. A lone
 * suggestion shows no count even while others may follow, so the cap starts
 * as a plain "Tab" and only widens once a second one is really there,
 * rather than widening early and shrinking back if no other comes.
 */
const replySuggestionPosition = computed(() => {
  const count = replySuggestions.value.length;
  if (count < 2) return "";
  const position = replySuggestionIndex.value + 1;
  return replySuggestionsComplete.value
    ? `${position}/${count}`
    : `${position}`;
});

/** Whether ↑/↓ have an alternative to step to; their hints follow. */
const replySuggestionHasPrevious = computed(
  () => replySuggestionIndex.value > 0,
);
const replySuggestionHasNext = computed(
  () => replySuggestionIndex.value < replySuggestions.value.length - 1,
);
/*
 * Only the reachable ↑ and ↓ take room in the cap: their room eases open or
 * shut while the glyph blurs in or out. They animate only once the
 * alternatives have mounted, so the first state shows at once.
 */
const replySuggestionArrows = ref<HTMLElement | null>(null);
watch(
  replySuggestionArrows,
  (arrows, _previous, onCleanup) => {
    if (!arrows) return;
    const frame = requestAnimationFrame(() =>
      arrows.setAttribute("data-swap-ready", ""),
    );
    onCleanup(() => cancelAnimationFrame(frame));
  },
  { flush: "post" },
);

/*
 * The count makes room beside Tab and blurs in, and eases to its new width
 * as "1" becomes "1/3", so the keycap grows rather than jumps.
 */
const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const countRoom = useCollapseTransition("width");
const replySuggestionCountTransition = {
  onEnter: (element: Element, done: () => void) =>
    prefersReducedMotion() ? done() : countRoom.onEnter(element, done),
  onLeave: (element: Element, done: () => void) =>
    prefersReducedMotion() ? done() : countRoom.onLeave(element, done),
};
const replySuggestionCount = ref<HTMLElement | null>(null);
let countWidth = 0;
let countElement: HTMLElement | null = null;
watch(
  () => replySuggestionPosition.value,
  () => {
    countElement = replySuggestionCount.value;
    countWidth = countElement?.getBoundingClientRect().width ?? 0;
  },
  { flush: "pre" },
);
watch(
  () => replySuggestionPosition.value,
  () => {
    const element = replySuggestionCount.value;
    // A newly shown cap (another conversation's set) starts as it is.
    if (
      !element ||
      element !== countElement ||
      !countWidth ||
      typeof element.animate !== "function"
    )
      return;
    const width = element.getBoundingClientRect().width;
    if (Math.abs(width - countWidth) < 0.5 || prefersReducedMotion()) return;
    element.animate([{ width: `${countWidth}px` }, { width: `${width}px` }], {
      duration: DURATION_MS,
      easing: EASE_OUT_EXPO,
    });
  },
  { flush: "post" },
);

/*
 * The unused alternatives are kept with the session, tied to the assistant
 * message they answer, so reopening the session shows them again without
 * asking the model. Sending, a newer turn, a rewind or a compaction makes
 * the kept ones stale on their own; Tab and turning suggestions off drop
 * them. Only the first kept value after the session opens is restored:
 * once this composer has asked for, used or dropped one, it decides.
 */
const keptReplySuggestion = computed(() =>
  props.sessionId && appearanceStore.replySuggestions
    ? useSessionStore().replySuggestionFor(props.sessionId)
    : undefined,
);
let replySuggestionSettled = false;
/**
 * Bumped when a kept set is restored, so its suggestion and cap show anew
 * in their final state rather than animating from the set shown before
 * (switching conversations in the same tab clears and restores at once).
 */
const replySuggestionSet = ref(0);

function showReplySuggestions(alternatives: readonly string[]): void {
  const shown = replySuggestion.value;
  replySuggestions.value = [...alternatives];
  // Stay on the shown alternative if it is still there.
  const index = shown ? alternatives.indexOf(shown) : -1;
  replySuggestionIndex.value = index < 0 ? 0 : index;
}

function restoreReplySuggestion(): void {
  const kept = keptReplySuggestion.value;
  if (
    replySuggestionSettled ||
    props.isRunning ||
    replySuggestions.value.length ||
    !kept?.alternatives.length
  )
    return;
  replySuggestionSettled = true;
  replySuggestionSet.value++;
  replySuggestionFades.value = false;
  replySuggestionsComplete.value = true;
  replySuggestions.value = [...kept.alternatives];
  replySuggestionIndex.value = Math.min(
    Math.max(kept.index, 0),
    kept.alternatives.length - 1,
  );
}

let keepIndexTimer: ReturnType<typeof setTimeout> | undefined;

function keepReplySuggestion(drop = false): void {
  clearTimeout(keepIndexTimer);
  keepIndexTimer = undefined;
  const sessionId = props.sessionId;
  if (!sessionId) return;
  const suggestion =
    drop || !replySuggestions.value.length
      ? null
      : {
          alternatives: [...replySuggestions.value],
          index: replySuggestionIndex.value,
        };
  useSessionStore()
    .setReplySuggestion(sessionId, suggestion)
    .catch(() => {
      // Keeping it is a convenience; the suggestion still shows here.
    });
}

/** The request still streaming alternatives, so it can be stopped. */
let streamingRequestId: string | undefined;

function stopReplySuggestionStream(): void {
  const requestId = streamingRequestId;
  streamingRequestId = undefined;
  if (requestId)
    window.pine.cancelReplySuggestion?.({ requestId }).catch(() => {
      // It ends on its own soon after.
    });
}

async function requestReplySuggestion(): Promise<void> {
  stopReplySuggestionStream();
  const run = ++suggestionRun;
  replySuggestionSettled = true;
  replySuggestions.value = [];
  replySuggestionIndex.value = 0;
  replySuggestionsComplete.value = true;
  const sessionId = props.sessionId;
  if (!sessionId || !appearanceStore.replySuggestions) return;
  const context = conversationContext();
  if (!context.conversation?.length || !window.pine.suggestReply) return;
  const requestId = `${Math.random().toString(36).slice(2)}-${run}`;
  const current = () => run === suggestionRun && !props.isRunning;
  streamingRequestId = requestId;
  replySuggestionsComplete.value = false;
  const stopListening = onSessionEvent((event) => {
    if (
      event.type === "reply-suggestions" &&
      event.requestId === requestId &&
      current()
    )
      showReplySuggestions(event.suggestions);
  });
  try {
    const { suggestions } = await window.pine.suggestReply({
      context,
      sessionId,
      requestId,
    });
    if (current()) showReplySuggestions(suggestions);
  } catch {
    // A suggestion is optional; whatever streamed in already stays.
  } finally {
    stopListening();
    if (streamingRequestId === requestId) streamingRequestId = undefined;
    if (run === suggestionRun) {
      replySuggestionsComplete.value = true;
      if (replySuggestions.value.length && !props.isRunning)
        keepReplySuggestion();
    }
  }
}

function clearReplySuggestion(): void {
  stopReplySuggestionStream();
  suggestionRun++;
  replySuggestions.value = [];
  replySuggestionIndex.value = 0;
  replySuggestionsComplete.value = true;
}

/**
 * Steps through the alternatives with ↑/↓, stopping at either end; false
 * when there is none that way, so the key keeps its usual meaning.
 */
function stepReplySuggestion(step: 1 | -1): boolean {
  if (!(step > 0 ? replySuggestionHasNext : replySuggestionHasPrevious).value)
    return false;
  replySuggestionIndex.value += step;
  // Only a finished set is kept; a still-streaming one is kept when done.
  if (replySuggestionsComplete.value) {
    clearTimeout(keepIndexTimer);
    keepIndexTimer = setTimeout(() => keepReplySuggestion(), 800);
  }
  return true;
}

// Typing stops the stream; what is complete stays for an emptied box.
watch(message, (text) => {
  if (text) stopReplySuggestionStream();
});
watch(
  () => props.isRunning,
  (running, wasRunning) => {
    if (running) clearReplySuggestion();
    else if (wasRunning) void requestReplySuggestion();
  },
);
watch(
  () => props.sessionId,
  () => {
    if (keepIndexTimer) keepReplySuggestion();
    clearReplySuggestion();
    replySuggestionSettled = false;
    restoreReplySuggestion();
  },
);
watch(keptReplySuggestion, restoreReplySuggestion, { immediate: true });
watch(
  () => appearanceStore.replySuggestions,
  (enabled) => {
    if (enabled) return;
    clearReplySuggestion();
    replySuggestionSettled = true;
    keepReplySuggestion(true);
  },
);
onBeforeUnmount(() => {
  if (keepIndexTimer) keepReplySuggestion();
  stopReplySuggestionStream();
});

function acceptReplySuggestion(): void {
  const suggestion = replySuggestion.value;
  clearReplySuggestion();
  keepReplySuggestion(true);
  message.value = suggestion;
  void nextTick(() => {
    const textarea = messageInput.value?.$el;
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(suggestion.length, suggestion.length);
  });
}

function cancelRewrite(): void {
  rewriteRun++;
  isRewriting.value = false;
  void nextTick(focus);
}

// The disabled input cannot hear Escape, so the window does.
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (!isRewriting.value || event.key !== "Escape" || event.defaultPrevented)
    return;
  event.preventDefault();
  cancelRewrite();
});

function submitMessage(options?: { holdView?: boolean }): void {
  if (isRewriting.value) return;
  const normalizedMessage = message.value.trim();
  if (
    !normalizedMessage &&
    attachments.value.length === 0 &&
    quotes.value.length === 0
  )
    return;

  const serialized = serializeAttachmentMessage(
    attachments.value,
    serializeQuoteMessage(quotes.value, normalizedMessage),
  );
  if (options?.holdView) emit("submit", serialized, { holdView: true });
  else emit("submit", serialized);
  attachments.value = [];
  quotes.value = [];
}

function removeQuote(index: number): void {
  quotes.value = quotes.value.filter((_, position) => position !== index);
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
    const result = isWeb
      ? await window.pine.pickAttachments(props.projectId)
      : kind === "directory"
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

async function attachSession(
  session: ProjectSessionSearchResult,
): Promise<void> {
  try {
    // The palette lists sessions of every project.
    const result = await window.pine.attachSession({
      projectId: session.projectId,
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
  if (files.length > 0 && isWeb && window.pine.uploadAttachments) {
    event.preventDefault();
    try {
      const result = await window.pine.uploadAttachments(
        files,
        props.projectId,
      );
      mergeAttachments(result.attachments);
    } catch {
      toast.error(t("project.composer.attachmentPasteFailed"));
    }
    return;
  }
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

/** Whether the caret sits at the end of the text box with nothing selected. */
function caretAtEnd(event: KeyboardEvent): boolean {
  const textarea = event.target;
  if (!(textarea instanceof HTMLTextAreaElement)) return message.value === "";
  const end = textarea.value.length;
  return textarea.selectionStart === end && textarea.selectionEnd === end;
}

function handleKeydown(event: KeyboardEvent): void {
  if (isMentioning.value) {
    handleChooserKeydown(event);
    return;
  }
  if (
    props.context.length > 0 &&
    message.value === "" &&
    (event.key === "Backspace" || event.key === "\\") &&
    !event.isComposing &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    emit("dismissContext");
    return;
  }
  // Tab or → takes the suggestion; → only from the end of the text, so it
  // never takes over moving the caret.
  if (
    (event.key === "Tab" ||
      (event.key === "ArrowRight" && caretAtEnd(event))) &&
    showsReplySuggestion.value &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    acceptReplySuggestion();
    return;
  }
  // ↑/↓ step through the alternatives only while one shows: the box is
  // empty, nothing is being composed and no project chooser is open.
  if (
    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
    showsReplySuggestion.value &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.isComposing &&
    stepReplySuggestion(event.key === "ArrowDown" ? 1 : -1)
  ) {
    event.preventDefault();
    return;
  }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

  event.preventDefault();
  // Enter sends and scrolls to the new turn; Option/Alt+Enter sends without
  // moving the transcript; Cmd/Ctrl+Enter optimizes the prompt instead.
  if (event.metaKey || event.ctrlKey) {
    if (!event.altKey) void rewritePrompt();
    return;
  }
  submitMessage({ holdView: event.altKey });
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
    data-slot="session-composer"
    :class="
      cn(
        '@container/composer relative isolate mx-auto w-full max-w-[var(--session-composer-max-width)] px-[var(--session-composer-gutter)]',
        hasPendingInterruption ? 'pb-4' : 'pb-3',
      )
    "
    @submit="handleRootSubmit"
  >
    <!-- The root is positioned and isolated so the working border's layers
         (z-index 1-2 inside the text box) stay within the composer. -->
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
    <AutomationApprovalCard
      v-else-if="props.pendingAutomationApproval"
      :key="props.pendingAutomationApproval.requestId"
      :is-active="props.isActive"
      :approval="props.pendingAutomationApproval"
    />
    <template v-else>
      <Popover :open="isChooserOpen">
        <PopoverAnchor as-child>
          <InputGroup
            class="session-composer-control flex-col items-stretch min-h-[var(--session-composer-control-height)] rounded-[var(--session-composer-control-radius)] has-[textarea]:rounded-[var(--session-composer-control-radius)]"
          >
            <ProjectComposerWorkingBorder
              :active="workingBorderActive"
              :variant="isRewriting ? 'spectrum' : 'accent'"
            />
            <!-- It opens and closes its row on the app's curve; leaving, it
                 keeps what it showed. -->
            <Transition :css="contextAnimates" name="session-composer-context">
              <div
                v-if="context.length > 0"
                data-slot="session-composer-context"
                class="session-composer-context grid w-full"
              >
                <div class="min-h-0 overflow-hidden">
                  <ProjectComposerContext
                    class="mx-[var(--session-composer-control-inset)] mt-[var(--session-composer-control-inset)]"
                    :context="context"
                  />
                </div>
              </div>
            </Transition>
            <!-- Rows that come, go or wrap ease the input along with them,
                 as the smart context does. -->
            <ProjectComposerEasedHeight :animates="rowsAnimate">
              <ProjectComposerAuthoring
                v-if="authoring.length > 0"
                class="mx-[var(--session-composer-control-inset)] mt-[var(--session-composer-control-inset)]"
                :targets="authoring"
                @remove="emit('removeAuthoring', $event)"
              />
              <ProjectAttachmentList
                v-if="attachments.length > 0"
                class="session-composer-attachments shrink-0 w-full px-[var(--session-composer-control-inset)] pt-[var(--session-composer-control-inset)] pb-0"
                :attachments="attachments"
                removable
                surface="composer"
                @remove="removeAttachment"
              />
              <ProjectQuoteList
                v-if="quotes.length > 0"
                class="session-composer-quotes shrink-0 w-full px-[var(--session-composer-control-inset)] pt-[var(--session-composer-control-inset)] pb-0"
                :quotes="quotes"
                removable
                surface="composer"
                @remove="removeQuote"
              />
            </ProjectComposerEasedHeight>

            <div class="session-composer-row flex w-full items-center">
              <!-- Addons default to an I-beam for click-to-focus, but theirs
                   focuses only an <input>, never this textarea, and a
                   disabled button lets the pointer through to it. -->
              <InputGroupAddon
                class="cursor-default self-end py-1.5 pl-2.5"
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
                      :disabled="isRewriting"
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
                      <DropdownMenuItem
                        v-if="!isWeb"
                        @select="pickAttachments('directory')"
                      >
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

              <div
                class="session-composer-input-wrap relative flex min-w-0 flex-1"
              >
                <InputGroupTextarea
                  :id="messageId"
                  ref="messageInput"
                  v-model="message"
                  v-bind="chooserInputAttrs"
                  :disabled="isRewriting"
                  :aria-busy="isRewriting || undefined"
                  :class="{
                    'session-composer-input--suggesting': showsReplySuggestion,
                    'session-composer-input--suggestion-fades':
                      showsReplySuggestion && replySuggestionFades,
                  }"
                  :aria-describedby="
                    showsReplySuggestion ? replySuggestionId : undefined
                  "
                  class="session-composer-input w-full min-w-0 scroll-fade-y max-h-48 min-h-[var(--session-composer-control-height)] overflow-y-auto overscroll-contain pt-3.5 pb-3.5 text-sm leading-5"
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
                  @compositionstart="isComposingText = true"
                  @compositionend="isComposingText = false"
                />
                <!-- Arriving over the placeholder, it fades in once the
                     placeholder has faded out; coming back after typing, it
                     shows at once. Same place, same colour. -->
                <Transition
                  name="session-composer-suggestion"
                  :css="replySuggestionFades"
                >
                  <div
                    v-if="showsReplySuggestion"
                    :key="replySuggestionSet"
                    data-slot="reply-suggestion"
                    class="session-composer-suggestion pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 pt-3.5 text-sm leading-5 text-muted-foreground"
                  >
                    <span class="min-w-0 truncate" aria-hidden="true">{{
                      replySuggestion
                    }}</span>
                    <!-- One keycap: "Tab", then, with several alternatives,
                         "2/3 ↑↓" ("2 ↑↓" while more stream in) behind a
                         hairline; ↑ and ↓ show only where there is an
                         alternative that way. → also takes the suggestion,
                         without a hint. -->
                    <ComposerKeycap data-slot="reply-suggestion-key">
                      <kbd class="font-sans">Tab</kbd>
                      <Transition
                        :css="false"
                        @enter="replySuggestionCountTransition.onEnter"
                        @leave="replySuggestionCountTransition.onLeave"
                      >
                        <span
                          v-if="replySuggestionPosition"
                          data-slot="reply-suggestion-alternatives"
                          class="inline-flex shrink-0 items-center"
                        >
                          <span class="me-1.5 h-3 w-px bg-foreground/15" />
                          <span
                            ref="replySuggestionCount"
                            data-slot="reply-suggestion-position"
                            class="inline-block overflow-hidden text-center whitespace-nowrap tabular-nums"
                            >{{ replySuggestionPosition }}</span
                          >
                          <span
                            ref="replySuggestionArrows"
                            class="session-composer-suggestion-arrows"
                            :data-hidden="
                              replySuggestionHasPrevious ||
                              replySuggestionHasNext
                                ? undefined
                                : ''
                            "
                          >
                            <span class="session-composer-suggestion-clip">
                              <kbd
                                data-slot="reply-suggestion-arrows"
                                class="inline-flex ps-1.5 font-sans"
                              >
                                <span
                                  data-slot="reply-suggestion-previous"
                                  class="session-composer-suggestion-arrow"
                                  :data-hidden="
                                    replySuggestionHasPrevious ? undefined : ''
                                  "
                                  ><span
                                    class="session-composer-suggestion-clip"
                                    ><span
                                      class="session-composer-suggestion-glyph"
                                      >↑</span
                                    ></span
                                  ></span
                                ><span
                                  data-slot="reply-suggestion-next"
                                  class="session-composer-suggestion-arrow"
                                  :data-hidden="
                                    replySuggestionHasNext ? undefined : ''
                                  "
                                  ><span
                                    class="session-composer-suggestion-clip"
                                    ><span
                                      class="session-composer-suggestion-glyph"
                                      >↓</span
                                    ></span
                                  ></span
                                >
                              </kbd>
                            </span>
                          </span>
                        </span>
                      </Transition>
                    </ComposerKeycap>
                    <span :id="replySuggestionId" class="sr-only">
                      {{ replySuggestion }} —
                      {{ t("project.composer.acceptReplySuggestion") }}
                      <template v-if="replySuggestionPosition">
                        —
                        {{
                          replySuggestionsComplete
                            ? t("project.composer.replySuggestionAlternative", {
                                position: replySuggestionIndex + 1,
                                count: replySuggestions.length,
                              })
                            : t(
                                "project.composer.replySuggestionAlternativeStreaming",
                                { position: replySuggestionIndex + 1 },
                              )
                        }}
                      </template>
                    </span>
                  </div>
                </Transition>
              </div>

              <InputGroupAddon
                class="max-w-[50%] cursor-default self-end py-1.5 pr-2.5"
                align="inline-end"
              >
                <!-- In a session, Optimize prompt sits beside Send (or Stop
                     and Steer while the agent works, for steering drafts); a
                     draft has it below, next to the approval mode. -->
                <ProjectComposerOptimizeButton
                  v-if="props.sessionId"
                  placement="inline"
                  :can-rewrite="canRewrite"
                  :is-rewriting="isRewriting"
                  :can-undo="promptBeforeRewrite !== null"
                  @optimize="rewritePrompt"
                  @undo="undoRewrite"
                />
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
                    <!-- Sending or steering also has Option/Alt+Enter, which
                         leaves the conversation where it is. -->
                    <span
                      v-if="
                        showShortcutHints && (isSteering || !props.isRunning)
                      "
                      data-slot="send-shortcut-hints"
                      class="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1"
                    >
                      <span>{{
                        isSteering
                          ? t("project.composer.steer")
                          : t("project.composer.send")
                      }}</span>
                      <Kbd class="justify-self-end" aria-hidden="true">↵</Kbd>
                      <span class="opacity-70">{{
                        isSteering
                          ? t("project.composer.steerWithoutScrolling")
                          : t("project.composer.sendWithoutScrolling")
                      }}</span>
                      <KbdGroup class="justify-self-end" aria-hidden="true">
                        <Kbd>{{ altKeyLabel }}</Kbd>
                        <Kbd>↵</Kbd>
                      </KbdGroup>
                    </span>
                    <template v-else>
                      {{
                        isSteering
                          ? t("project.composer.steer")
                          : props.isRunning
                            ? t("project.composer.stop")
                            : t("project.composer.send")
                      }}
                      <Kbd
                        v-if="
                          showShortcutHints && props.isRunning && !isSteering
                        "
                        aria-hidden="true"
                        >esc</Kbd
                      >
                    </template>
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
      data-slot="session-composer-footer"
      :class="edgeInset && 'session-composer-footer--edge-inset'"
      class="session-composer-footer @container/composer-footer flex min-w-0 items-center justify-between gap-3 pt-2"
    >
      <!-- The left group keeps its size; the Model control gives way first,
           and the container queries below compact both as the footer
           narrows. -->
      <div class="flex shrink-0 items-center gap-1">
        <DropdownMenu v-model:open="isApprovalMenuOpen">
          <DropdownMenuTrigger as-child>
            <Button
              data-slot="approval-mode-trigger"
              class="min-w-0"
              :aria-label="selectedApprovalMode.label"
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
                    'session-composer-approval-label truncate',
                    approvalModeColorClasses[selectedApprovalMode.value],
                  )
                "
              >
                {{ selectedApprovalMode.label }}
              </span>
              <Transition
                :css="false"
                @enter="menuShortcutTransition.onEnter"
                @leave="menuShortcutTransition.onLeave"
              >
                <KbdGroup
                  v-if="modifierHeld"
                  data-slot="approval-menu-shortcut"
                  class="shrink-0"
                  aria-hidden="true"
                >
                  <Kbd>{{ modifierLabel }}</Kbd>
                  <Kbd>R</Kbd>
                </KbdGroup>
              </Transition>
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
            <template v-if="appearanceStore.helpGuides">
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="approval-modes-guide"
                @select="helpStore.openTopic('approval-modes')"
              >
                <CircleHelpIcon />
                {{ t("help.approvalModesGuide") }}
              </DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- A new session has used no context yet, so it shows the
             Optimize prompt shortcut instead; it works in a session too. -->
        <ProjectComposerOptimizeButton
          v-if="!props.sessionId && !props.isRunning"
          :can-rewrite="canRewrite"
          :is-rewriting="isRewriting"
          :can-undo="promptBeforeRewrite !== null"
          @optimize="rewritePrompt"
          @undo="undoRewrite"
        />
        <ContextUsageIndicator v-else class="shrink-0" />
      </div>

      <DropdownMenu v-model:open="isModelMenuOpen">
        <DropdownMenuTrigger as-child>
          <Button
            data-slot="model-selector-trigger"
            class="min-w-0 shrink"
            :aria-label="modelTriggerLabel"
            type="button"
            variant="ghost"
            size="sm"
          >
            <ProviderIcon
              v-if="selectedModel"
              mono
              data-icon="inline-start"
              :provider-id="selectedModel.providerId"
              :provider-name="selectedModel.providerName"
            />
            <span
              data-slot="model-selector-name"
              class="session-composer-model-name min-w-0 truncate"
            >
              {{ selectedModel?.name ?? t("project.composer.selectModel") }}
            </span>
            <span
              v-if="selectedModel && selection"
              data-slot="model-selector-thinking-level"
              :class="
                cn(
                  'session-composer-thinking-level shrink-0 text-muted-foreground',
                  thinkingLevelTextClass(selection.thinkingLevel),
                )
              "
            >
              · {{ t(`models.thinkingLevels.${selection.thinkingLevel}`) }}
            </span>
            <Transition
              :css="false"
              @enter="menuShortcutTransition.onEnter"
              @leave="menuShortcutTransition.onLeave"
            >
              <KbdGroup
                v-if="modifierHeld"
                data-slot="model-menu-shortcut"
                class="shrink-0"
                aria-hidden="true"
              >
                <Kbd>{{ modifierLabel }}</Kbd>
                <Kbd>I</Kbd>
              </KbdGroup>
            </Transition>
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
          <template v-if="appearanceStore.helpGuides">
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                data-testid="models-guide"
                @select="helpStore.openTopic('models')"
              >
                <CircleHelpIcon />
                {{ t("help.modelsGuide") }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="selectedModel && thinkingLevels.length > 1"
                data-testid="reasoning-effort-guide"
                @select="helpStore.openTopic('reasoning-effort')"
              >
                <CircleHelpIcon />
                {{ t("help.reasoningEffortGuide") }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
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

.session-composer-context {
  grid-template-rows: 1fr;
}

.session-composer-context-enter-active,
.session-composer-context-leave-active {
  transition-property: grid-template-rows, opacity;
  transition-duration: 500ms;
  transition-timing-function: var(--ease-out-expo);
}

.session-composer-context-enter-from,
.session-composer-context-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.session-composer-footer {
  transition-property: padding;
  transition-duration: 500ms;
  transition-timing-function: var(--ease-out-expo);
}

/* Clear of the floating composer's rounder card corners: as wide as the
   transcript's column in a window. It sets in at once, as the composer
   shows again, and only eases out. */
.session-composer-footer--edge-inset {
  padding-inline: max(0px, calc((100% - var(--session-content-max-width)) / 2));
  transition: none;
}

.session-composer-input {
  padding-inline-start: var(--session-composer-control-inset);
  padding-inline-end: var(--session-input-padding-inline, 1rem);
}

.session-composer-input--suggestion-fades::placeholder {
  transition: color 300ms ease-out;
}

.session-composer-input--suggesting::placeholder {
  color: transparent;
}

.session-composer-suggestion {
  padding-inline-start: var(--session-composer-control-inset);
  padding-inline-end: var(--session-input-padding-inline, 1rem);
}

/* The placeholder fades out first, then the suggestion fades in. Leaving
   has no transition: any input replaces the suggestion at once. */
.session-composer-suggestion-enter-active {
  transition: opacity 300ms ease-out 300ms;
}

.session-composer-suggestion-enter-from {
  opacity: 0;
}

/* Only the reachable ↑ and ↓ take room. Each one's slot eases its width
   open or shut (0fr ↔ 1fr) on the app's expo curve while its glyph blurs
   and scales in or out in place, like Optimize prompt's keys; with neither
   reachable the whole arrow part, its leading space included, folds away.
   The cap grows and shrinks at its end, so its start never moves. Only
   once mounted, so the first state shows at once. */
.session-composer-suggestion-arrows,
.session-composer-suggestion-arrow {
  display: inline-grid;
  grid-template-columns: 1fr;
}

.session-composer-suggestion-arrows[data-hidden],
.session-composer-suggestion-arrow[data-hidden] {
  grid-template-columns: 0fr;
}

.session-composer-suggestion-clip {
  display: inline-flex;
  min-width: 0;
  overflow: hidden;
}

.session-composer-suggestion-glyph {
  display: inline-block;
  opacity: 1;
  filter: none;
  scale: 1;
}

.session-composer-suggestion-arrow[data-hidden]
  .session-composer-suggestion-glyph {
  opacity: 0;
  filter: blur(3px);
  scale: 0.9;
}

/* In: the room opens at once and the glyph sharpens into it. */
.session-composer-suggestion-arrows[data-swap-ready],
.session-composer-suggestion-arrows[data-swap-ready]
  .session-composer-suggestion-arrow {
  transition: grid-template-columns 500ms var(--ease-out-expo);
}

.session-composer-suggestion-arrows[data-swap-ready]
  .session-composer-suggestion-glyph {
  transition:
    opacity 220ms ease-out 100ms,
    filter 300ms ease-out 100ms,
    scale 500ms var(--ease-out-expo) 100ms;
}

/* Out: the glyph fades first, then its room closes. */
.session-composer-suggestion-arrows[data-swap-ready][data-hidden],
.session-composer-suggestion-arrows[data-swap-ready]
  .session-composer-suggestion-arrow[data-hidden] {
  transition: grid-template-columns 500ms var(--ease-out-expo) 60ms;
}

.session-composer-suggestion-arrows[data-swap-ready]
  .session-composer-suggestion-arrow[data-hidden]
  .session-composer-suggestion-glyph {
  transition:
    opacity 100ms ease-out,
    filter 100ms ease-out,
    scale 100ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .session-composer-suggestion-arrows[data-swap-ready],
  .session-composer-suggestion-arrows[data-swap-ready]
    .session-composer-suggestion-arrow,
  .session-composer-suggestion-arrows[data-swap-ready]
    .session-composer-suggestion-glyph,
  .session-composer-suggestion-arrows[data-swap-ready][data-hidden],
  .session-composer-suggestion-arrows[data-swap-ready]
    .session-composer-suggestion-arrow[data-hidden],
  .session-composer-suggestion-arrows[data-swap-ready]
    .session-composer-suggestion-arrow[data-hidden]
    .session-composer-suggestion-glyph,
  .session-composer-input--suggestion-fades::placeholder,
  .session-composer-suggestion-enter-active {
    transition: none;
  }
}

/* At phone width the message takes the whole first row; its actions move to
   a row below, and the approval mode shows only its icon. */
@container composer (width < 28rem) {
  .session-composer-row {
    flex-wrap: wrap;
  }

  .session-composer-row > .session-composer-input-wrap {
    order: 0;
    flex-basis: 100%;
  }

  .session-composer-input {
    padding-inline: var(--session-input-padding-inline, 1rem);
    padding-bottom: 0.25rem;
  }

  .session-composer-suggestion {
    padding-inline: var(--session-input-padding-inline, 1rem);
  }

  .session-composer-row > [data-align="inline-start"] {
    order: 1;
  }

  .session-composer-row > [data-align="inline-end"] {
    order: 2;
    max-width: none;
    margin-inline-start: auto;
  }

  .session-composer-approval-label,
  .session-composer-row :deep(.composer-optimize-label),
  .session-composer-row :deep(.composer-optimize-rest-kbd) {
    display: none;
  }

  /* With only its icon, Optimize prompt is an even icon button. */
  .session-composer-row :deep(.composer-optimize-inline),
  .session-composer-row :deep(.composer-optimize-sizer) {
    padding-inline-end: 0.625rem;
  }
}

/* A narrow footer (a phone, a split or narrow window) compacts its controls
   step by step: the session cost goes first, then the reasoning effort, then
   the context percentage, and at the narrowest the Model control keeps only
   its provider icon. In between, the model name truncates. Everything hidden
   stays in the controls' accessible names and their menus. */
@container composer-footer (width < 26rem) {
  .session-composer-footer :deep([data-slot="context-usage-cost"]) {
    display: none;
  }
}

@container composer-footer (width < 24rem) {
  .session-composer-thinking-level {
    display: none;
  }
}

@container composer-footer (width < 19rem) {
  .session-composer-footer :deep([data-slot="context-usage-percent"]) {
    display: none;
  }
}

@container composer-footer (width < 15rem) {
  [data-icon="inline-start"] + .session-composer-model-name {
    display: none;
  }
}

.reasoning-effort-slider :deep([data-slot="slider-thumb"]),
.reasoning-effort-slider :deep([data-slot="slider-range"]) {
  transition-property: left, right;
  transition-duration: 500ms;
  transition-timing-function: var(--ease-out-expo);
}
</style>

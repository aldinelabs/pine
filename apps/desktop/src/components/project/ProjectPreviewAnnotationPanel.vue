<script setup lang="ts">
import {
  MessageSquareTextIcon,
  PencilIcon,
  Plus,
  Send,
  SquareTerminal,
  Trash2Icon,
} from "@lucide/vue";
import { nextTick, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { annotationLocation } from "@/lib/annotationLocation";
import { cn } from "@/lib/utils";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";
import type { PreviewDisplayMode } from "./file-preview/previewRenderer";

/**
 * The comments on a previewed file, in document order, with what can be done
 * to each and the action that sends them all to a session. Shown in the
 * Comments card of Pine's right sidebar, under the file's details.
 */
const props = defineProps<{
  annotations: readonly PreviewAnnotation[];
  activeId: string | undefined;
  /** The view the preview shows; comments made in the other one say so. */
  mode: PreviewDisplayMode;
  /** The preview can switch between source and rendered views. */
  hasViews: boolean;
  sessionTabs: readonly { id: string; label: string }[];
  sending: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  update: [id: string, comment: string];
  remove: [id: string];
  clear: [];
  send: [tabId: string | null];
}>();
const { t } = useI18n();

const editingId = ref<string>();
const draft = ref("");
const confirmingClear = ref(false);
const list = useTemplateRef<HTMLElement>("list");

function location(annotation: PreviewAnnotation): string | undefined {
  return annotationLocation(annotation, t);
}

/** Whether a comment shows a line above its passage: location or tags. */
function hasMeta(annotation: PreviewAnnotation): boolean {
  return (
    Boolean(location(annotation)) ||
    annotation.orphaned ||
    (props.hasViews && annotation.mode !== props.mode)
  );
}

async function edit(annotation: PreviewAnnotation): Promise<void> {
  editingId.value = annotation.id;
  draft.value = annotation.comment;
  await nextTick();
  list.value
    ?.querySelector<HTMLTextAreaElement>(
      `[data-annotation-id="${annotation.id}"] textarea`,
    )
    ?.focus();
}

function commitEdit(): void {
  const id = editingId.value;
  if (id && draft.value.trim()) emit("update", id, draft.value.trim());
  editingId.value = undefined;
}

function handleEditKey(event: KeyboardEvent): void {
  // Enter saves and Shift+Enter starts a new line; Enter that confirms an
  // input method's composition belongs to the input method.
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    commitEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    editingId.value = undefined;
  }
}

// The comment chosen in the preview scrolls into the list.
watch(
  () => props.activeId,
  async (id) => {
    if (!id) return;
    await nextTick();
    list.value
      ?.querySelector(`[data-annotation-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  },
);
</script>

<template>
  <section
    data-slot="preview-annotation-panel"
    class="flex min-h-0 flex-col"
    :aria-label="t('project.preview.annotations.title')"
  >
    <Empty v-if="!annotations.length" class="flex-1 p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MessageSquareTextIcon /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.annotations.empty") }}</EmptyTitle>
        <EmptyDescription>{{
          t("project.preview.annotations.emptyDescription")
        }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <ScrollArea v-else class="min-h-0 flex-1">
      <ol ref="list" class="flex flex-col gap-1 px-2 pb-2">
        <li
          v-for="annotation in annotations"
          :key="annotation.id"
          :data-annotation-id="annotation.id"
          :class="
            cn(
              'group/annotation relative flex flex-col gap-1.5 rounded-xl px-3 py-2 text-sm transition-colors',
              annotation.id === activeId ? 'bg-muted' : 'hover:bg-muted/60',
            )
          "
        >
          <button
            v-if="editingId !== annotation.id"
            type="button"
            class="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            :aria-label="annotation.comment"
            @click="emit('select', annotation.id)"
          />
          <div
            v-if="hasMeta(annotation)"
            class="flex min-h-5 flex-wrap items-center gap-1.5 pr-14 text-xs text-muted-foreground"
          >
            <span
              v-if="location(annotation)"
              class="min-w-0 truncate tabular-nums"
              >{{ location(annotation) }}</span
            >
            <Badge
              v-if="hasViews && annotation.mode !== mode"
              variant="outline"
              class="h-4 px-1.5 font-normal"
              >{{
                t(
                  annotation.mode === "code"
                    ? "project.preview.annotations.sourceView"
                    : "project.preview.annotations.renderedView",
                )
              }}</Badge
            >
            <Badge
              v-if="annotation.orphaned"
              variant="destructive"
              class="h-4 px-1.5 font-normal"
              >{{ t("project.preview.annotations.orphaned") }}</Badge
            >
          </div>
          <!-- A time comment's passage is its span, already shown above. -->
          <blockquote
            v-if="annotation.anchor.kind !== 'time'"
            :class="
              cn(
                'line-clamp-2 border-l-2 border-annotation pl-2 text-xs whitespace-pre-line break-words text-muted-foreground',
                // The edit and delete buttons sit over the first line.
                !hasMeta(annotation) && 'mr-14',
                annotation.orphaned &&
                  'line-through decoration-muted-foreground/60',
              )
            "
          >
            {{ annotation.text }}
          </blockquote>
          <template v-if="editingId === annotation.id">
            <Textarea
              v-model="draft"
              rows="2"
              class="relative max-h-40 text-sm"
              @keydown="handleEditKey"
            />
            <div class="relative flex justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                @click="editingId = undefined"
                >{{ t("project.preview.annotations.cancel") }}</Button
              >
              <Button
                type="button"
                size="sm"
                :disabled="!draft.trim()"
                @click="commitEdit"
                >{{ t("project.preview.annotations.save") }}</Button
              >
            </div>
          </template>
          <p v-else class="whitespace-pre-wrap break-words">
            {{ annotation.comment }}
          </p>
          <div
            v-if="editingId !== annotation.id"
            class="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover/annotation:opacity-100 group-focus-within/annotation:opacity-100"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :aria-label="t('project.preview.annotations.edit')"
              :title="t('project.preview.annotations.edit')"
              @click="edit(annotation)"
            >
              <PencilIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :aria-label="t('project.preview.annotations.delete')"
              :title="t('project.preview.annotations.delete')"
              @click="emit('remove', annotation.id)"
            >
              <Trash2Icon />
            </Button>
          </div>
        </li>
      </ol>
    </ScrollArea>
    <footer
      v-if="annotations.length"
      class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="mr-auto"
        @click="confirmingClear = true"
        >{{ t("project.preview.annotations.clearAll") }}</Button
      >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button type="button" size="sm" :disabled="sending">
            <Send data-icon="inline-start" />
            {{
              t("project.preview.annotations.send", {
                count: annotations.length,
              })
            }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" class="w-64">
          <DropdownMenuGroup>
            <DropdownMenuItem
              v-for="tab in sessionTabs"
              :key="tab.id"
              @select="emit('send', tab.id)"
            >
              <SquareTerminal />
              <span class="truncate">{{ tab.label }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="!sessionTabs.length" disabled>{{
              t("project.preview.noSessionTabs")
            }}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @select="emit('send', null)">
              <Plus />{{ t("project.preview.newSession") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </footer>
    <AlertDialog v-model:open="confirmingClear">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t("project.preview.annotations.clearTitle")
          }}</AlertDialogTitle>
          <AlertDialogDescription>{{
            t("project.preview.annotations.clearDescription", {
              count: annotations.length,
            })
          }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{
            t("project.preview.annotations.cancel")
          }}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="emit('clear')">{{
            t("project.preview.annotations.clearConfirm")
          }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { FileIcon, FolderIcon, XIcon } from "@lucide/vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";
import {
  attachmentImageUrl,
  isImageAttachment,
  type PineAttachment,
} from "@/shared/attachments";

const props = withDefaults(
  defineProps<{
    attachments: readonly PineAttachment[];
    class?: HTMLAttributes["class"];
    removable?: boolean;
    surface: "composer" | "message";
  }>(),
  { removable: false },
);

const emit = defineEmits<{
  open: [path: string];
  remove: [path: string];
}>();

const { t } = useI18n();

/** Paths whose preview failed to load; they fall back to the icon variant. */
const failedImagePaths = ref(new Set<string>());

function markImageFailed(path: string): void {
  failedImagePaths.value = new Set([...failedImagePaths.value, path]);
}

/**
 * Image attachments render with the official image variant; anything that
 * cannot be previewed (or failed to load) falls back to the icon variant.
 */
function isPreviewableImage(attachment: PineAttachment): boolean {
  return (
    isImageAttachment(attachment) &&
    !failedImagePaths.value.has(attachment.path)
  );
}

function formatFileSize(size: number): string {
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  if (size < 1_000_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  return `${(size / 1_000_000_000).toFixed(1)} GB`;
}
</script>

<template>
  <AttachmentGroup
    :class="cn('project-attachment-list items-end gap-1.5', props.class)"
    role="list"
  >
    <Attachment
      v-for="attachment in attachments"
      :key="attachment.path"
      :class="
        cn(
          'project-attachment max-w-36',
          surface === 'composer' &&
            'rounded-[var(--session-composer-attachment-radius)]',
          surface === 'message' && 'hover:bg-muted/50',
        )
      "
      size="sm"
      :orientation="isPreviewableImage(attachment) ? 'vertical' : 'horizontal'"
      role="listitem"
    >
      <AttachmentMedia
        v-if="isPreviewableImage(attachment)"
        variant="image"
        :class="
          surface === 'message' ? 'w-full! rounded-2xl!' : 'w-full! rounded-lg!'
        "
      >
        <img
          :alt="attachment.name"
          :src="attachmentImageUrl(attachment.path)"
          loading="lazy"
          @error="markImageFailed(attachment.path)"
        />
      </AttachmentMedia>
      <AttachmentMedia v-else>
        <FolderIcon v-if="attachment.kind === 'directory'" />
        <FileIcon v-else />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{{ attachment.name }}</AttachmentTitle>
        <AttachmentDescription>
          {{
            attachment.selection
              ? (attachment.selection.label ??
                t("project.composer.attachmentLines", {
                  startLine: attachment.selection.startLine,
                  endLine: attachment.selection.endLine,
                }))
              : attachment.source
                ? attachment.source.app
                : attachment.kind === "directory"
                  ? t("project.composer.folderAttachment")
                  : attachment.extension
                    ? `${attachment.extension.toUpperCase()} · ${formatFileSize(attachment.size)}`
                    : formatFileSize(attachment.size)
          }}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions v-if="removable">
        <AttachmentAction
          type="button"
          :aria-label="
            t('project.composer.removeAttachment', { name: attachment.name })
          "
          @click="emit('remove', attachment.path)"
        >
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
      <AttachmentTrigger
        v-if="surface === 'message'"
        type="button"
        class="cursor-pointer"
        :aria-label="
          t('project.composer.openAttachment', { name: attachment.name })
        "
        @click="emit('open', attachment.path)"
      />
    </Attachment>
  </AttachmentGroup>
</template>

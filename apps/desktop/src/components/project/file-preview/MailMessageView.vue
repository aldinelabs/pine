<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { Paperclip } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatAddress,
  type MailAttachment,
  type MailMessage,
} from "@/lib/email";
import { formatBytes } from "@/lib/formatBytes";
import { inlineResources } from "@/lib/htmlSandbox";
import HtmlFrame from "./HtmlFrame.vue";
import NestedPreview from "./NestedPreview.vue";
import type { AnnotationPlace, AnnotationSurface } from "./previewRenderer";

const props = defineProps<{
  message: MailMessage;
  fallbackTitle: string;
  view: "body" | "headers";
  zoom: number;
  active: boolean;
  /**
   * Names this message among a mailbox's, for comments: its body gets this
   * segment and its headers the same with `:headers`. A single message's body
   * has none, and its headers are `headers`.
   */
  segment?: string;
  place?: AnnotationPlace;
}>();
const emit = defineEmits<{
  /** The body's frame loaded a document; comments are placed again. */
  annotationsChange: [];
}>();
const { t, locale } = useI18n();
const header = useTemplateRef<HTMLElement>("header");
const rawHeaders = useTemplateRef<HTMLElement>("rawHeaders");
const textBody = useTemplateRef<HTMLElement>("textBody");
const frame = useTemplateRef<InstanceType<typeof HtmlFrame>>("frame");

const opened = shallowRef<MailAttachment>();
const dialogOpen = ref(false);

const listed = computed(() =>
  props.message.attachments.filter((attachment) => !attachment.inline),
);
const html = computed(() => {
  const body = props.message.html;
  if (!body) return undefined;
  return inlineResources(
    body,
    props.message.attachments
      .filter((attachment) => attachment.contentId)
      .map((attachment) => ({
        url: `cid:${attachment.contentId}`,
        mimeType: attachment.mimeType,
        data: attachment.data,
      })),
  );
});
const fields = computed(() =>
  [
    [
      t("project.preview.mailFrom"),
      props.message.from ? formatAddress(props.message.from) : "",
    ],
    [
      t("project.preview.mailTo"),
      props.message.to.map(formatAddress).join(", "),
    ],
    [
      t("project.preview.mailCc"),
      props.message.cc.map(formatAddress).join(", "),
    ],
    [
      t("project.preview.mailDate"),
      props.message.date?.toLocaleString(locale.value, {
        dateStyle: "medium",
        timeStyle: "short",
      }) ?? "",
    ],
  ].filter(([, value]) => value),
);

/** Attachment buttons are controls, not part of the message's text. */
const ATTACHMENTS = "[data-mail-attachments]";

/**
 * The message's text as shown: its headers, and its body (the HTML body's
 * frame once loaded, or the plain text) or, in the headers view, every raw
 * header.
 */
function annotationSurfaces(): AnnotationSurface[] {
  const place = props.place ? { place: props.place } : {};
  const headerSegment = props.segment ? `${props.segment}:headers` : "headers";
  const surfaces: AnnotationSurface[] = [];
  if (header.value)
    surfaces.push({
      root: header.value,
      excluded: ATTACHMENTS,
      segment: headerSegment,
      ...place,
    });
  const body =
    props.view === "headers"
      ? undefined
      : (frame.value?.body() ?? textBody.value ?? undefined);
  if (body)
    surfaces.push({
      root: body,
      ...(props.segment ? { segment: props.segment } : {}),
      ...place,
    });
  if (props.view === "headers" && rawHeaders.value)
    surfaces.push({
      root: rawHeaders.value,
      segment: `${headerSegment}:raw`,
      ...place,
    });
  return surfaces;
}

defineExpose({ annotationSurfaces });

function open(attachment: MailAttachment): void {
  opened.value = attachment;
  dialogOpen.value = true;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      ref="header"
      class="flex shrink-0 flex-col gap-3 border-b px-6 pt-2 pb-4"
    >
      <h2 class="text-lg font-medium">
        {{ message.subject || fallbackTitle }}
      </h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <template v-for="[label, value] in fields" :key="label">
          <dt class="text-muted-foreground">{{ label }}</dt>
          <dd class="min-w-0 break-words">{{ value }}</dd>
        </template>
      </dl>
      <div
        v-if="listed.length"
        data-mail-attachments
        class="flex flex-wrap gap-2"
      >
        <Button
          v-for="(attachment, index) in listed"
          :key="index"
          variant="outline"
          size="sm"
          :title="attachment.name"
          @click="open(attachment)"
        >
          <Paperclip data-icon="inline-start" />
          <span class="max-w-48 truncate">{{ attachment.name }}</span>
          <span class="text-muted-foreground">{{
            formatBytes(attachment.data.byteLength, locale)
          }}</span>
        </Button>
      </div>
    </header>

    <ScrollArea v-if="view === 'headers'" class="min-h-0 flex-1">
      <dl
        ref="rawHeaders"
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 font-mono text-xs"
        :style="{ zoom: zoom / 100 }"
      >
        <template
          v-for="([name, value], index) in message.headers"
          :key="index"
        >
          <dt class="text-muted-foreground">{{ name }}</dt>
          <dd class="min-w-0 break-all">{{ value }}</dd>
        </template>
      </dl>
    </ScrollArea>
    <HtmlFrame
      v-else-if="html"
      ref="frame"
      class="min-h-0 flex-1"
      :html="html"
      :title="message.subject || fallbackTitle"
      :zoom="zoom"
      @load="emit('annotationsChange')"
    />
    <ScrollArea v-else class="min-h-0 flex-1">
      <!-- Text bodies zoom like HTML ones: laid out again, not scaled. -->
      <p
        ref="textBody"
        class="px-6 py-4 text-sm whitespace-pre-wrap"
        :style="{ zoom: zoom / 100 }"
      >
        {{ message.text || t("project.preview.mailEmpty") }}
      </p>
    </ScrollArea>

    <Dialog v-model:open="dialogOpen">
      <DialogContent
        :class="[
          'flex h-[80vh] max-w-5xl flex-col sm:max-w-5xl',
          PHONE_FULLSCREEN_DIALOG,
        ]"
      >
        <DialogHeader>
          <DialogTitle class="truncate">{{ opened?.name }}</DialogTitle>
          <DialogDescription v-if="opened">{{
            formatBytes(opened.data.byteLength, locale)
          }}</DialogDescription>
        </DialogHeader>
        <div v-if="opened" class="relative flex min-h-0 flex-1 flex-col">
          <NestedPreview
            :name="opened.name"
            :bytes="opened.data.slice().buffer"
            :active="active && dialogOpen"
          />
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

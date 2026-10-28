<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
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

const props = defineProps<{
  message: MailMessage;
  fallbackTitle: string;
  view: "body" | "headers";
  zoom: number;
  active: boolean;
}>();
const { t, locale } = useI18n();

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

function open(attachment: MailAttachment): void {
  opened.value = attachment;
  dialogOpen.value = true;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex shrink-0 flex-col gap-3 border-b px-6 pt-2 pb-4">
      <h2 class="text-lg font-medium">
        {{ message.subject || fallbackTitle }}
      </h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <template v-for="[label, value] in fields" :key="label">
          <dt class="text-muted-foreground">{{ label }}</dt>
          <dd class="min-w-0 break-words">{{ value }}</dd>
        </template>
      </dl>
      <div v-if="listed.length" class="flex flex-wrap gap-2">
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
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 font-mono text-xs"
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
      class="min-h-0 flex-1"
      :html="html"
      :title="message.subject || fallbackTitle"
      :zoom="zoom"
    />
    <ScrollArea v-else class="min-h-0 flex-1">
      <p class="px-6 py-4 text-sm whitespace-pre-wrap">
        {{ message.text || t("project.preview.mailEmpty") }}
      </p>
    </ScrollArea>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="flex h-[80vh] max-w-5xl flex-col sm:max-w-5xl">
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

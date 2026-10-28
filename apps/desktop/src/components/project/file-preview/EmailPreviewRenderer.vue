<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  mboxSummary,
  parseEml,
  parseMsg,
  splitMbox,
  type MailMessage,
} from "@/lib/email";
import { cn } from "@/lib/utils";
import { previewExtension } from "@/shared/previewFormats";
import MailMessageView from "./MailMessageView.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const toolbar = usePreviewToolbar(() => props.compact);

interface MailboxEntry {
  bytes: Uint8Array;
  from?: string;
  subject?: string;
  date?: Date;
}

const message = shallowRef<MailMessage>();
const mailbox = shallowRef<MailboxEntry[]>();
const selected = ref(0);
const view = ref<"body" | "headers">("body");
const loading = ref(true);
const reading = new AbortController();
let opening = 0;

const zoom = computed(() => (props.compact ? 100 : props.zoom));

async function openMailboxMessage(index: number): Promise<void> {
  const entry = mailbox.value?.[index];
  if (!entry) return;
  const current = ++opening;
  selected.value = index;
  const parsed = await parseEml(entry.bytes);
  if (current === opening) message.value = parsed;
}

async function load(): Promise<void> {
  const bytes = await readPreviewBytes(props.preview, reading.signal);
  const extension = previewExtension(props.filePath);
  if (extension === "msg") {
    message.value = await parseMsg(bytes);
    return;
  }
  if (extension === "mbox") {
    const all = new Uint8Array(bytes);
    mailbox.value = splitMbox(all).map(({ start, end }) => {
      const part = all.subarray(start, end);
      return { bytes: part, ...mboxSummary(part) };
    });
    await openMailboxMessage(0);
    return;
  }
  message.value = await parseEml(bytes);
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    zoomMin: 50,
    zoomMax: 200,
    toolbar: !props.compact,
  });
  try {
    await load();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the email.", error);
    emit("failed");
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => reading.abort());
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && message" :to="toolbar">
      <ToggleGroup
        v-model="view"
        type="single"
        variant="outline"
        size="sm"
        :aria-label="t('project.preview.mailView')"
      >
        <ToggleGroupItem value="body">{{
          t("project.preview.mailBody")
        }}</ToggleGroupItem>
        <ToggleGroupItem value="headers">{{
          t("project.preview.mailHeaders")
        }}</ToggleGroupItem>
      </ToggleGroup>
    </Teleport>

    <div v-if="loading" class="grid h-full place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>

    <ResizablePanelGroup
      v-else-if="mailbox && mailbox.length > 1 && !compact"
      direction="horizontal"
    >
      <ResizablePanel :default-size="30" :min-size="18" :max-size="50">
        <ScrollArea class="h-full">
          <ul class="flex flex-col gap-0.5 px-2 pb-2">
            <li v-for="(entry, index) in mailbox" :key="index">
              <button
                type="button"
                :class="
                  cn(
                    'flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                    selected === index && 'bg-muted',
                  )
                "
                @click="openMailboxMessage(index)"
              >
                <span class="flex items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                    entry.from || t("project.preview.mailUnknownSender")
                  }}</span>
                  <span
                    v-if="entry.date"
                    class="shrink-0 text-xs text-muted-foreground"
                    >{{
                      entry.date.toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                      })
                    }}</span
                  >
                </span>
                <span class="truncate text-sm text-muted-foreground">{{
                  entry.subject || t("project.preview.mailNoSubject")
                }}</span>
              </button>
            </li>
          </ul>
        </ScrollArea>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="70">
        <MailMessageView
          v-if="message"
          :message="message"
          :fallback-title="t('project.preview.mailNoSubject')"
          :view="view"
          :zoom="zoom"
          :active="active"
        />
      </ResizablePanel>
    </ResizablePanelGroup>

    <MailMessageView
      v-else-if="message"
      :message="message"
      :fallback-title="fileName"
      :view="view"
      :zoom="zoom"
      :active="active"
    />
  </div>
</template>

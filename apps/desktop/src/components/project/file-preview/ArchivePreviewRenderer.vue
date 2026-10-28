<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Lock,
  PackageOpen,
  Search,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  ArchivePasswordError,
  openArchive,
  type OpenedArchive,
} from "@/lib/archive";
import { archiveTree, visibleArchiveRows } from "@/lib/archiveTree";
import { formatBytes } from "@/lib/formatBytes";
import { cn } from "@/lib/utils";
import { previewExtension } from "@/shared/previewFormats";
import NestedPreview from "./NestedPreview.vue";
import PreviewPager from "./PreviewPager.vue";
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

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

const archive = shallowRef<OpenedArchive>();
const bytes = shallowRef<ArrayBuffer>();
const locked = ref<"encrypted" | "wrong">();
const password = ref("");
const opening = ref(true);
const filter = ref("");
const expanded = ref(new Set<string>());
const selected = ref<string>();
const entry = shallowRef<{ path: string; bytes: ArrayBuffer }>();
const extracting = ref(false);
const reading = new AbortController();
let extraction = 0;

const tree = computed(() => archiveTree(archive.value?.entries ?? []));
const rows = computed(() =>
  visibleArchiveRows(tree.value, expanded.value, filter.value),
);
/** Comic book archives read page by page instead of as a file list. */
const comic = computed(() => {
  const extension = previewExtension(props.filePath);
  if (extension !== "cbz" && extension !== "cbr") return undefined;
  const pages = (archive.value?.entries ?? [])
    .map((item) => item.path)
    .filter((path) => IMAGE.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return pages.length ? pages : undefined;
});
const comicPage = ref(1);

async function open(withPassword?: string): Promise<void> {
  opening.value = true;
  try {
    bytes.value ??= await readPreviewBytes(props.preview, reading.signal);
    // libarchive takes ownership of what it reads, so it gets a copy.
    archive.value = await openArchive(
      bytes.value.slice(0),
      props.fileName,
      withPassword,
    );
    locked.value = undefined;
    // Archives of one folder open with it expanded.
    const top = tree.value.filter((node) => node.folder);
    if (top.length === 1 && tree.value.length === 1)
      expanded.value = new Set([top[0].path]);
    if (comic.value) emit("capabilitiesChange", { toolbar: true });
    // A single compressed file opens straight away.
    const only = archive.value.entries;
    if (only.length === 1 && !comic.value) void show(only[0].path);
  } catch (error) {
    if (reading.signal.aborted) return;
    if (error instanceof ArchivePasswordError) {
      locked.value = error.wrongPassword ? "wrong" : "encrypted";
      return;
    }
    console.error("Failed to open the archive.", error);
    emit("failed");
  } finally {
    opening.value = false;
  }
}

async function show(path: string): Promise<void> {
  const current = ++extraction;
  selected.value = path;
  extracting.value = true;
  try {
    const data = await archive.value!.extract(path);
    if (current === extraction) entry.value = { path, bytes: data };
  } catch (error) {
    if (current !== extraction) return;
    if (error instanceof ArchivePasswordError) {
      locked.value = "wrong";
      return;
    }
    console.error("Failed to extract the archive entry.", error);
    entry.value = { path, bytes: new ArrayBuffer(0) };
  } finally {
    if (current === extraction) extracting.value = false;
  }
}

function toggle(path: string): void {
  const next = new Set(expanded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded.value = next;
}

function unlock(): void {
  if (password.value) void open(password.value);
}

watch(comicPage, (page) => {
  const path = comic.value?.[page - 1];
  if (path) void show(path);
});
watch(comic, (pages) => {
  if (pages?.[0]) void show(pages[0]);
});

onMounted(() => void open());
onBeforeUnmount(() => {
  reading.abort();
  void archive.value?.close();
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && comic" :to="toolbar">
      <PreviewPager v-model:page="comicPage" :page-count="comic.length" />
    </Teleport>

    <Empty v-if="locked" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Lock /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.archiveLocked") }}</EmptyTitle>
        <EmptyDescription v-if="locked === 'wrong'" class="text-destructive">{{
          t("project.preview.archiveWrongPassword")
        }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <form class="flex w-full max-w-xs gap-2" @submit.prevent="unlock">
          <InputGroup>
            <InputGroupInput
              v-model="password"
              type="password"
              autocomplete="off"
              :placeholder="t('project.preview.archivePassword')"
              :aria-label="t('project.preview.archivePassword')"
            />
          </InputGroup>
          <Button type="submit" :disabled="!password || opening">{{
            t("project.preview.archiveUnlock")
          }}</Button>
        </form>
      </EmptyContent>
    </Empty>

    <div
      v-else-if="opening || !archive"
      class="grid h-full place-items-center"
      role="status"
    >
      <Spinner class="size-5 text-muted-foreground" />
    </div>

    <Empty v-else-if="!archive.entries.length" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><PackageOpen /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.archiveEmpty") }}</EmptyTitle>
        <EmptyDescription>{{
          t("project.preview.archiveEmptyDescription")
        }}</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <div v-else-if="comic" class="flex h-full min-h-0 flex-col">
      <NestedPreview
        v-if="entry"
        :key="entry.path"
        :name="entry.path"
        :bytes="entry.bytes"
        :active="active"
      />
    </div>

    <ResizablePanelGroup v-else-if="!compact" direction="horizontal">
      <ResizablePanel :default-size="32" :min-size="18" :max-size="60">
        <div class="flex h-full min-h-0 flex-col">
          <div class="shrink-0 px-3 pb-2">
            <InputGroup class="h-8">
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput
                v-model="filter"
                type="search"
                :placeholder="t('project.preview.archiveFilter')"
                :aria-label="t('project.preview.archiveFilter')"
              />
            </InputGroup>
          </div>
          <ScrollArea class="min-h-0 flex-1">
            <ul role="tree" class="flex flex-col px-2 pb-2">
              <li
                v-for="row in rows"
                :key="row.path"
                role="treeitem"
                :aria-expanded="
                  row.folder ? expanded.has(row.path) || !!filter : undefined
                "
                :aria-selected="selected === row.path"
              >
                <button
                  type="button"
                  :class="
                    cn(
                      'flex h-7 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30',
                      selected === row.path && 'bg-muted',
                    )
                  "
                  :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
                  :title="row.path"
                  @click="row.folder ? toggle(row.path) : show(row.path)"
                >
                  <ChevronRight
                    v-if="row.folder"
                    :class="
                      cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        (expanded.has(row.path) || filter) && 'rotate-90',
                      )
                    "
                  />
                  <span v-else class="w-3.5 shrink-0" />
                  <FolderOpen
                    v-if="row.folder && (expanded.has(row.path) || filter)"
                    class="size-4 shrink-0 text-muted-foreground"
                  />
                  <Folder
                    v-else-if="row.folder"
                    class="size-4 shrink-0 text-muted-foreground"
                  />
                  <FileIcon
                    v-else
                    class="size-4 shrink-0 text-muted-foreground"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                  <span
                    v-if="!row.folder"
                    class="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >{{ formatBytes(row.size, locale) }}</span
                  >
                </button>
              </li>
            </ul>
          </ScrollArea>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="68">
        <div class="relative flex h-full min-h-0 flex-col">
          <NestedPreview
            v-if="entry"
            :key="entry.path"
            :name="entry.path"
            :bytes="entry.bytes"
            :active="active"
          />
          <Empty v-else-if="!extracting" class="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon"><PackageOpen /></EmptyMedia>
              <EmptyDescription>{{
                t("project.preview.archiveChoose")
              }}</EmptyDescription>
            </EmptyHeader>
          </Empty>
          <div
            v-if="extracting"
            class="absolute inset-0 grid place-items-center bg-background/60"
            role="status"
          >
            <Spinner class="size-5 text-muted-foreground" />
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

    <ScrollArea v-else class="h-full">
      <ul class="flex flex-col px-3 py-2 text-sm">
        <li
          v-for="item in archive.entries"
          :key="item.path"
          class="flex h-7 items-center gap-2"
        >
          <FileIcon class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ item.path }}</span>
        </li>
      </ul>
    </ScrollArea>
  </div>
</template>

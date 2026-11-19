<script setup lang="ts">
import {
  ArrowDownIcon,
  AudioLinesIcon,
  MicIcon,
  Volume2Icon,
} from "@lucide/vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import LiveContextSpeakerChip from "@/components/workbench/LiveContextSpeakerChip.vue";
import type {
  LiveContextSegment,
  LiveContextSource,
  LiveContextSpeakerKey,
  LiveContextSpeakers,
} from "@/shared/liveContext";
import {
  parseSpeakerKey,
  segmentTurns,
  speakerMap,
  speakersOf,
} from "@/shared/liveContextSpeakers";

/**
 * The transcript of one conversation's Live Context: who spoke and when,
 * one block per speaker turn, with the words still forming at the end. It
 * follows new text while the user is at the bottom and offers a way back
 * when they scrolled up.
 */
const props = defineProps<{
  segments: LiveContextSegment[];
  /** Volatile segments, still forming. */
  pending: LiveContextSegment[];
  speakers: LiveContextSpeakers;
  /** "listening" or "paused" while this conversation captures. */
  capture?: "listening" | "paused" | "starting";
  loading?: boolean;
}>();
const emit = defineEmits<{
  rename: [speaker: LiveContextSpeakerKey, name: string];
  merge: [from: LiveContextSpeakerKey, into: LiveContextSpeakerKey];
}>();
const { t, locale: uiLocale } = useI18n();

/** A new block starts after this much quiet, even for the same speaker. */
const GAP_MS = 2 * 60 * 1000;

/** Pine's own merges and the user's, together. */
const merges = computed(() => speakerMap(props.speakers));

function speakerLabel(speaker: LiveContextSpeakerKey): string {
  return (
    props.speakers.names[speaker] ??
    t("project.workbench.liveContext.speakers.numbered", {
      n: parseSpeakerKey(speaker).speaker,
    })
  );
}

/** Everyone heard so far, after merges, for the merge menu. */
const knownSpeakers = computed(() =>
  speakersOf([...props.segments, ...props.pending], merges.value).map(
    (speaker) => ({ speaker, label: speakerLabel(speaker) }),
  ),
);

function othersThan(speaker: LiveContextSpeakerKey) {
  return knownSpeakers.value.filter((known) => known.speaker !== speaker);
}

interface Line {
  key: string;
  text: string;
  final: boolean;
  provisional: boolean;
}

interface Block {
  key: string;
  /** Who speaks; without speaker labels the source stands in. */
  speaker?: LiveContextSpeakerKey;
  overlap?: LiveContextSpeakerKey;
  /** Labeled, but the voice is not known yet. */
  unknown: boolean;
  source: LiveContextSource;
  echo: boolean;
  start: number;
  lines: Line[];
}

/**
 * Segments as blocks: one per speaker turn, consecutive lines by the same
 * speaker together, so a long talk reads as paragraphs under one name.
 */
const blocks = computed<Block[]>(() => {
  const result: Block[] = [];
  let last: { block: Block; identity: string; end: number } | undefined;
  for (const segment of [...props.segments, ...props.pending]) {
    const labeled = Boolean(segment.turns?.length);
    segmentTurns(segment, merges.value).forEach((piece, index) => {
      const unknown = labeled && !piece.speaker;
      const echo = segment.echo === true;
      const identity = [
        piece.speaker ?? (unknown ? "?" : segment.source),
        piece.overlap ?? "",
        echo ? "echo" : "",
      ].join("|");
      const line: Line = {
        key: `${segment.id}-${index}`,
        text: piece.text,
        final: segment.final,
        provisional: !segment.final || piece.provisional === true,
      };
      if (
        last &&
        last.identity === identity &&
        segment.start - last.end < GAP_MS
      ) {
        last.block.lines.push(line);
        last.end = Math.max(last.end, segment.end);
        return;
      }
      const block: Block = {
        key: line.key,
        ...(piece.speaker ? { speaker: piece.speaker } : {}),
        ...(piece.overlap ? { overlap: piece.overlap } : {}),
        unknown,
        source: segment.source,
        echo,
        start: segment.start,
        lines: [line],
      };
      result.push(block);
      last = { block, identity, end: segment.end };
    });
  }
  return result;
});

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(uiLocale.value, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fullTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(uiLocale.value, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Follow new text while the user is at the bottom of the card.
const root = ref<HTMLElement | null>(null);
const following = ref(true);
const missed = ref(false);
let scroller: HTMLElement | null = null;

function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}

function onScroll(): void {
  if (!scroller) return;
  following.value = atBottom(scroller);
  if (following.value) missed.value = false;
}

function scrollToEnd(smooth = false): void {
  if (!scroller) return;
  scroller.scrollTo({
    top: scroller.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
  following.value = true;
  missed.value = false;
}

onMounted(() => {
  scroller = root.value?.closest<HTMLElement>(".overflow-y-auto") ?? null;
  scroller?.addEventListener("scroll", onScroll, { passive: true });
  void nextTick(() => scrollToEnd());
});
onBeforeUnmount(() => scroller?.removeEventListener("scroll", onScroll));
// The transcript grows, and its scroll region shrinks when a notice shows
// up under it: either way, stay at the end while following.
useResizeObserver(
  () => [root.value, root.value?.parentElement ?? null],
  () => {
    if (following.value) scrollToEnd();
  },
);

watch(
  () => [
    props.segments.length,
    props.pending.map(({ text }) => text).join("\n"),
  ],
  async () => {
    if (!scroller) return;
    const follow = following.value && atBottom(scroller);
    await nextTick();
    if (follow) scrollToEnd();
    else missed.value = true;
  },
);
// A transcript that just loaded opens at its end.
watch(
  () => props.loading,
  async (loading, wasLoading) => {
    if (loading || !wasLoading) return;
    await nextTick();
    scrollToEnd();
  },
);

const isEmpty = computed(
  () => props.segments.length === 0 && props.pending.length === 0,
);
</script>

<template>
  <div ref="root" class="flex flex-1 flex-col">
    <div
      v-if="loading && isEmpty"
      class="flex flex-col gap-4 px-(--live-context-text-inset) pt-1"
      aria-hidden="true"
      data-testid="live-context-transcript-loading"
    >
      <div v-for="row in 3" :key="row" class="flex flex-col gap-2">
        <Skeleton class="h-5 w-20 rounded-full" />
        <Skeleton class="h-3.5 w-full" />
        <Skeleton class="h-3.5" :class="row === 2 ? 'w-2/5' : 'w-3/4'" />
      </div>
    </div>
    <Empty
      v-else-if="isEmpty"
      class="flex-1 border-0"
      :data-testid="capture ? 'live-context-waiting' : 'live-context-empty'"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AudioLinesIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>
          {{
            capture === "paused"
              ? t("project.workbench.liveContext.waitingPaused")
              : capture
                ? t("project.workbench.liveContext.waiting")
                : t("project.workbench.liveContext.empty")
          }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <ol
      v-else
      class="flex flex-col gap-4 px-(--live-context-text-inset) pt-1 pb-2 text-sm"
      :aria-label="t('project.workbench.liveContext.transcript')"
      data-testid="live-context-transcript"
    >
      <li
        v-for="block in blocks"
        :key="block.key"
        class="flex flex-col gap-1"
        :data-echo="block.echo || undefined"
      >
        <div class="flex min-w-0 items-center gap-1 text-xs">
          <template v-if="block.speaker">
            <LiveContextSpeakerChip
              :speaker="block.speaker"
              :label="speakerLabel(block.speaker)"
              :others="othersThan(block.speaker)"
              :provisional="block.lines.every((line) => line.provisional)"
              @rename="
                (name) => block.speaker && emit('rename', block.speaker, name)
              "
              @merge="
                (into) => block.speaker && emit('merge', block.speaker, into)
              "
            />
            <template v-if="block.overlap">
              <span class="text-muted-foreground" aria-hidden="true">+</span>
              <LiveContextSpeakerChip
                :speaker="block.overlap"
                :label="speakerLabel(block.overlap)"
                :others="othersThan(block.overlap)"
                :provisional="block.lines.every((line) => line.provisional)"
                @rename="
                  (name) => block.overlap && emit('rename', block.overlap, name)
                "
                @merge="
                  (into) => block.overlap && emit('merge', block.overlap, into)
                "
              />
            </template>
          </template>
          <span
            v-else-if="block.unknown"
            class="bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-medium"
            :title="t('project.workbench.liveContext.speakers.unknown')"
            data-testid="live-context-speaker-unknown"
            >?</span
          >
          <span
            v-else
            class="inline-flex h-5 items-center gap-1 rounded-full px-2 font-medium"
            :class="
              block.source === 'mic'
                ? 'bg-foreground/8 text-foreground'
                : 'bg-muted text-muted-foreground'
            "
            data-testid="live-context-source-label"
          >
            <component
              :is="block.source === 'mic' ? MicIcon : Volume2Icon"
              class="size-3 shrink-0 opacity-70"
              aria-hidden="true"
            />
            {{ t(`project.workbench.liveContext.speaker.${block.source}`) }}
          </span>
          <span
            v-if="block.echo"
            class="text-muted-foreground truncate"
            data-testid="live-context-echo"
            >· {{ t("project.workbench.liveContext.speakers.echo") }}</span
          >
          <time
            class="text-muted-foreground/80 ml-auto shrink-0 pl-2 tabular-nums"
            :datetime="new Date(block.start).toISOString()"
            :title="fullTime(block.start)"
            >{{ time(block.start) }}</time
          >
        </div>
        <p
          v-for="line in block.lines"
          :key="line.key"
          :data-final="line.final || undefined"
          class="leading-relaxed break-words whitespace-pre-wrap select-text"
          :class="
            !line.final
              ? 'text-muted-foreground'
              : block.echo
                ? 'text-muted-foreground/80'
                : 'text-foreground'
          "
        >
          {{ line.text
          }}<span
            v-if="!line.final"
            class="live-context-caret bg-muted-foreground/70 ml-0.5 inline-block h-[1em] w-0.5 translate-y-0.5 rounded-full align-baseline"
            aria-hidden="true"
          />
        </p>
      </li>
    </ol>
    <div
      v-if="missed && !following"
      class="pointer-events-none sticky bottom-2 mt-auto flex justify-center"
    >
      <Button
        size="xs"
        variant="secondary"
        class="pointer-events-auto shadow-md"
        data-testid="live-context-jump"
        @click="scrollToEnd(true)"
      >
        <ArrowDownIcon data-icon="inline-start" aria-hidden="true" />
        {{ t("project.workbench.liveContext.jumpToLatest") }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.live-context-caret {
  animation: live-context-caret 1s steps(2, start) infinite;
}

@keyframes live-context-caret {
  to {
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-context-caret {
    animation: none;
  }
}
</style>

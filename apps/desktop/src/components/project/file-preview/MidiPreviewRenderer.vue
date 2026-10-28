<script setup lang="ts">
import type { Midi } from "@tonejs/midi";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { Eye, EyeOff } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration } from "@/lib/formatDuration";
import { cn } from "@/lib/utils";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();

/** Piano roll scale at 100% zoom. */
const PIXELS_PER_SECOND = 80;
const PITCH_HEIGHT = 6;

const midi = shallowRef<Midi>();
const hidden = ref(new Set<number>());
const reading = new AbortController();

const tracks = computed(() =>
  (midi.value?.tracks ?? [])
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.notes.length),
);
const range = computed(() => {
  const pitches = tracks.value.flatMap(({ track }) =>
    track.notes.map((note) => note.midi),
  );
  if (!pitches.length) return { low: 60, high: 72 };
  return { low: Math.min(...pitches) - 1, high: Math.max(...pitches) + 1 };
});
const pixelsPerSecond = computed(
  () => (PIXELS_PER_SECOND * (props.compact ? 100 : props.zoom)) / 100,
);
const roll = computed(() => ({
  width: Math.max(1, (midi.value?.duration ?? 0) * pixelsPerSecond.value),
  height: (range.value.high - range.value.low + 1) * PITCH_HEIGHT,
}));
const summary = computed(() => {
  const file = midi.value;
  if (!file) return [];
  const tempo = file.header.tempos[0]?.bpm;
  const signature = file.header.timeSignatures[0]?.timeSignature;
  return [
    formatDuration(file.duration),
    tempo && t("project.preview.midiTempo", { bpm: Math.round(tempo) }),
    signature && signature.join("/"),
    t("project.preview.midiTracks", { count: tracks.value.length }),
    t("project.preview.midiNotes", {
      count: tracks.value
        .reduce((sum, { track }) => sum + track.notes.length, 0)
        .toLocaleString(locale.value),
    }),
  ].filter(Boolean);
});
/** Octave lines, labeled at each C. */
const octaves = computed(() => {
  const lines: { y: number; label: string }[] = [];
  for (let pitch = range.value.low; pitch <= range.value.high; pitch++)
    if (pitch % 12 === 0)
      lines.push({
        y: (range.value.high - pitch + 1) * PITCH_HEIGHT,
        label: `C${pitch / 12 - 1}`,
      });
  return lines;
});

/** Tracks take evenly spread hues at a calm chroma, readable in both themes. */
function color(index: number): string {
  return `oklch(0.64 0.12 ${(250 + index * 137.5) % 360})`;
}

function toggle(index: number): void {
  const next = new Set(hidden.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  hidden.value = next;
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    zoomMin: 10,
    zoomMax: 800,
  });
  try {
    const [{ Midi }, bytes] = await Promise.all([
      import("@tonejs/midi"),
      readPreviewBytes(props.preview, reading.signal),
    ]);
    midi.value = new Midi(bytes);
    emit("metadataChange", { duration: midi.value.duration });
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the MIDI file.", error);
    emit("failed");
  }
});
onBeforeUnmount(() => reading.abort());
</script>

<template>
  <div v-if="midi" class="flex h-full min-h-0 flex-col">
    <header class="flex flex-col gap-1 px-6 pt-4 pb-3">
      <h2 class="truncate font-medium">{{ midi.name || fileName }}</h2>
      <p class="text-sm text-muted-foreground">{{ summary.join(" · ") }}</p>
    </header>
    <div
      class="scroll-fade relative min-h-0 flex-1 overflow-auto border-y bg-muted/30"
      :aria-label="t('project.preview.pianoRoll')"
      role="img"
    >
      <svg :width="roll.width + 48" :height="roll.height" class="block">
        <g v-for="line in octaves" :key="line.label">
          <line
            x1="0"
            :x2="roll.width + 48"
            :y1="line.y"
            :y2="line.y"
            class="stroke-border"
          />
          <text x="6" :y="line.y - 2" class="fill-muted-foreground text-[10px]">
            {{ line.label }}
          </text>
        </g>
        <g transform="translate(40 0)">
          <template v-for="{ track, index } in tracks" :key="index">
            <g v-if="!hidden.has(index)" :style="{ fill: color(index) }">
              <rect
                v-for="(note, position) in track.notes"
                :key="position"
                :x="note.time * pixelsPerSecond"
                :y="(range.high - note.midi) * PITCH_HEIGHT"
                :width="Math.max(1.5, note.duration * pixelsPerSecond)"
                :height="PITCH_HEIGHT - 1"
                rx="1"
                :fill-opacity="0.45 + note.velocity * 0.55"
              />
            </g>
          </template>
        </g>
      </svg>
    </div>
    <div v-if="!compact" class="max-h-[40%] shrink-0 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-10" />
            <TableHead>{{ t("project.preview.midiTrack") }}</TableHead>
            <TableHead>{{ t("project.preview.midiInstrument") }}</TableHead>
            <TableHead class="text-right">{{
              t("project.preview.midiChannel")
            }}</TableHead>
            <TableHead class="text-right">{{
              t("project.preview.midiNoteCount")
            }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="{ track, index } in tracks"
            :key="index"
            :class="cn(hidden.has(index) && 'text-muted-foreground')"
          >
            <TableCell>
              <Button
                variant="ghost"
                size="icon-xs"
                :aria-pressed="!hidden.has(index)"
                :aria-label="
                  t('project.preview.toggleTrack', {
                    name: track.name || index + 1,
                  })
                "
                @click="toggle(index)"
              >
                <Eye
                  v-if="!hidden.has(index)"
                  :style="{ color: color(index) }"
                />
                <EyeOff v-else />
              </Button>
            </TableCell>
            <TableCell class="max-w-56 truncate">{{
              track.name ||
              t("project.preview.midiUntitled", { index: index + 1 })
            }}</TableCell>
            <TableCell class="max-w-56 truncate capitalize">{{
              track.instrument.percussion
                ? t("project.preview.midiPercussion")
                : track.instrument.name
            }}</TableCell>
            <TableCell class="text-right tabular-nums">{{
              track.channel + 1
            }}</TableCell>
            <TableCell class="text-right tabular-nums">{{
              track.notes.length.toLocaleString(locale)
            }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
  <div v-else class="grid h-full place-items-center" role="status">
    <Spinner class="size-5 text-muted-foreground" />
  </div>
</template>

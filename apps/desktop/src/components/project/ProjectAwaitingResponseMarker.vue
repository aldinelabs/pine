<script lang="ts">
/** How long a sent message waits without any reply before the note shows. */
export const AWAITING_RESPONSE_DELAY_MS = 3000;
</script>

<script setup lang="ts">
import { HourglassIcon } from "@lucide/vue";
import { computed, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { MessageScrollerItem } from "@/components/ui/message-scroller";

/**
 * A temporary note, where the reply will appear, that the model provider has
 * not answered yet. It shows once the run has waited three seconds for the
 * first content after the user's message, and goes as soon as any content
 * arrives or the run ends. It is only ever derived from the live run, never
 * stored. One timer at most, and none while the tab is in the background;
 * coming back after the delay shows it at once.
 */
const props = defineProps<{
  /** The live run has no reply content yet after the user's message. */
  waiting: boolean;
  /** The session's tab is the active one. */
  active: boolean;
}>();

const { t } = useI18n();

/**
 * The hint's clauses, each kept whole, so the line breaks between clauses
 * (after a comma) rather than mid-phrase. A clause wider than the line
 * still wraps inside itself. `space` is the gap a Latin script needs.
 */
function clauses(text: string): { text: string; space: boolean }[] {
  return (text.match(/[^，、,;；]+[，、,;；]?\s*/g) ?? [text]).map((part) => ({
    text: part.trim(),
    space: /\s$/.test(part),
  }));
}

const hintClauses = computed(() =>
  clauses(t("project.transcript.awaitingResponse.hint")),
);

const shown = ref(false);
let waitStartedAt: number | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function clearTimer() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
}

function sync() {
  clearTimer();
  if (!props.waiting) {
    shown.value = false;
    waitStartedAt = undefined;
    return;
  }
  if (!props.active || shown.value) return;
  const remaining =
    AWAITING_RESPONSE_DELAY_MS - (Date.now() - (waitStartedAt ?? Date.now()));
  if (remaining <= 0) {
    shown.value = true;
    return;
  }
  timer = setTimeout(() => {
    timer = undefined;
    shown.value = true;
  }, remaining);
}

watch(
  () => props.waiting,
  (waiting) => {
    if (waiting) waitStartedAt ??= Date.now();
    sync();
  },
  { immediate: true },
);
watch(() => props.active, sync);

onScopeDispose(clearTimer);
</script>

<template>
  <!-- Its -mt-8 cancels the transcript's gap-8, so it takes no room while
       hidden; the marker's own pt-8 brings the gap back. No message id and
       no scroll anchor: the reply's item lands before it. -->
  <MessageScrollerItem data-slot="awaiting-response-item" class="-mt-8">
    <!-- A plain fade: the note is small, so it does not grow open. -->
    <Transition name="awaiting-response-fade">
      <div v-if="shown" data-testid="awaiting-response-marker">
        <div class="pt-8">
          <Marker role="status" aria-live="polite">
            <MarkerIcon>
              <HourglassIcon />
            </MarkerIcon>
            <!-- One sentence per line: what is happening, then what to do. -->
            <MarkerContent class="flex flex-col">
              <span data-slot="awaiting-response-status">{{
                t("project.transcript.awaitingResponse.status")
              }}</span>
              <span data-slot="awaiting-response-hint"
                ><template v-for="(clause, index) in hintClauses" :key="index"
                  ><span class="inline-block max-w-full">{{ clause.text }}</span
                  >{{ clause.space ? " " : "" }}</template
                ></span
              >
            </MarkerContent>
          </Marker>
        </div>
      </div>
    </Transition>
  </MessageScrollerItem>
</template>

<style scoped>
.awaiting-response-fade-enter-active {
  transition: opacity 300ms ease-out;
}

.awaiting-response-fade-leave-active {
  transition: opacity 200ms ease-out;
}

.awaiting-response-fade-enter-from,
.awaiting-response-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .awaiting-response-fade-enter-active,
  .awaiting-response-fade-leave-active {
    transition: none;
  }
}
</style>

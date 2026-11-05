<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { TextQuoteIcon, XIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PineQuote } from "@/shared/quotes";

/**
 * Passages quoted from the conversation. In the composer each can be
 * removed; in a sent message they sit above its bubble.
 */
const props = withDefaults(
  defineProps<{
    quotes: readonly PineQuote[];
    class?: HTMLAttributes["class"];
    removable?: boolean;
    surface: "composer" | "message";
  }>(),
  { removable: false },
);

const emit = defineEmits<{ remove: [index: number] }>();
const { t } = useI18n();
</script>

<template>
  <ul
    data-slot="quote-list"
    :aria-label="t('project.quote.listLabel')"
    :class="
      cn(
        'flex min-w-0 flex-col gap-1.5',
        surface === 'message' && 'items-end',
        props.class,
      )
    "
  >
    <li
      v-for="(quote, index) in quotes"
      :key="index"
      data-slot="quote"
      :class="
        cn(
          'group/quote relative flex min-w-0 items-start gap-2 rounded-lg border-s-2 border-primary/60 bg-muted/60 py-1.5 ps-2.5 pe-2 text-xs text-muted-foreground',
          surface === 'composer' ? 'w-full' : 'max-w-full',
        )
      "
    >
      <TextQuoteIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span
        class="line-clamp-3 min-w-0 flex-1 break-words whitespace-pre-wrap"
        :title="quote.text"
      >
        {{ quote.text }}
      </span>
      <Button
        v-if="removable"
        type="button"
        variant="ghost"
        size="icon-xs"
        class="-my-0.5 shrink-0"
        :aria-label="t('project.quote.remove')"
        @click="emit('remove', index)"
      >
        <XIcon />
      </Button>
    </li>
  </ul>
</template>

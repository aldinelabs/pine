<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { MessageSquareQuoteIcon, XIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PineQuote } from "@/shared/quotes";

/**
 * Passages quoted from the conversation, as chips like the composer's
 * authoring ones: a line of the passage behind a quote mark. In the
 * composer each can be removed; in a sent message they sit above its
 * bubble. A surface with its own corner passes it through `itemClass`.
 */
const props = withDefaults(
  defineProps<{
    quotes: readonly PineQuote[];
    class?: HTMLAttributes["class"];
    itemClass?: HTMLAttributes["class"];
    removable?: boolean;
    surface: "composer" | "message";
  }>(),
  { removable: false },
);

const emit = defineEmits<{ remove: [index: number] }>();
const { t } = useI18n();
</script>

<template>
  <div
    data-slot="quote-list"
    role="list"
    :aria-label="t('project.quote.listLabel')"
    :class="
      cn(
        'flex flex-wrap gap-1.5',
        surface === 'message' && 'justify-end',
        props.class,
      )
    "
  >
    <!-- The chip keeps the height of one with a remove button, so quotes
         with and without one line up. -->
    <div
      v-for="(quote, index) in quotes"
      :key="index"
      data-slot="quote"
      role="listitem"
      :class="
        cn(
          'flex min-h-7 min-w-0 max-w-full items-center gap-2 bg-muted/60 py-1 pl-2.5 text-xs',
          removable ? 'pr-1' : 'pr-2.5',
          surface === 'composer'
            ? 'rounded-[var(--session-composer-attachment-radius)]'
            : 'rounded-2xl',
          props.itemClass,
        )
      "
      :title="quote.text"
    >
      <MessageSquareQuoteIcon
        class="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span class="min-w-0 truncate">
        <span class="sr-only">{{ t("project.quote.label") }}: </span>
        {{ quote.text }}
      </span>
      <Button
        v-if="removable"
        type="button"
        variant="ghost"
        size="icon-xs"
        class="size-5 shrink-0"
        :aria-label="t('project.quote.remove')"
        @click="emit('remove', index)"
      >
        <XIcon />
      </Button>
    </div>
  </div>
</template>

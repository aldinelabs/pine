<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { QuoteIcon, XIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import type { PineQuote } from "@/shared/quotes";

/**
 * Passages quoted from the conversation, each read as an excerpt behind a
 * quotation mark: in the composer each can be removed; in a sent message
 * they sit above its bubble. A surface with its own corner passes it
 * through `itemClass`; the remove button keeps to the item's inset, so its
 * corner stays concentric with the quote's.
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
  <ItemGroup
    data-slot="quote-list"
    :aria-label="t('project.quote.listLabel')"
    :class="
      cn(
        'gap-1.5 has-data-[size=xs]:gap-1.5',
        surface === 'message' ? 'items-end' : 'items-start',
        props.class,
      )
    "
  >
    <Item
      v-for="(quote, index) in quotes"
      :key="index"
      data-slot="quote"
      variant="muted"
      size="xs"
      role="listitem"
      :class="
        cn(
          'w-fit max-w-full flex-nowrap py-1.5 pl-2.5',
          removable ? 'pr-1.5' : 'pr-3',
          surface === 'composer' &&
            'rounded-[var(--session-composer-attachment-radius)]',
          props.itemClass,
        )
      "
      :title="quote.text"
    >
      <ItemMedia
        variant="icon"
        class="self-start text-muted-foreground [&_svg:not([class*=size-])]:size-3.5"
      >
        <!-- Centred on the first line of the excerpt. -->
        <span class="flex h-6 items-center">
          <QuoteIcon aria-hidden="true" />
        </span>
      </ItemMedia>
      <ItemContent class="min-w-0">
        <ItemDescription class="py-0.5 leading-5">
          <span class="sr-only">{{ t("project.quote.label") }}: </span>
          {{ quote.text }}
        </ItemDescription>
      </ItemContent>
      <ItemActions v-if="removable" class="self-start">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="rounded-full"
          :aria-label="t('project.quote.remove')"
          @click="emit('remove', index)"
        >
          <XIcon />
        </Button>
      </ItemActions>
    </Item>
  </ItemGroup>
</template>

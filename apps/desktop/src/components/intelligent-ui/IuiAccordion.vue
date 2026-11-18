<script setup lang="ts">
import type { ElementNode } from "@openuidev/lang-core";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FieldGroup } from "@/components/ui/field";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { childList } from "./layout";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Accordion">>>();

/** AccordionItems are read here; anything else in the list is skipped. */
const items = computed(() =>
  childList(props.props.items).flatMap((item, index) => {
    const element = item as ElementNode | null;
    if (element?.type !== "element" || element.typeName !== "AccordionItem")
      return [];
    const itemProps = element.props as IntelligentUiProps<"AccordionItem">;
    return [
      {
        value: String(index),
        title: itemProps.title,
        children: itemProps.children,
      },
    ];
  }),
);
</script>

<template>
  <Accordion
    v-if="items.length > 0"
    data-iui="accordion"
    :type="props.props.multiple ? 'multiple' : 'single'"
    collapsible
    class="min-w-0"
  >
    <AccordionItem v-for="item in items" :key="item.value" :value="item.value">
      <AccordionTrigger>{{ item.title }}</AccordionTrigger>
      <AccordionContent>
        <FieldGroup class="gap-4">
          <IuiNodes :value="item.children" />
        </FieldGroup>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>

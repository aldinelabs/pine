<script setup lang="ts">
import type { ElementNode } from "@openuidev/lang-core";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { FieldGroup } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Tabs">>>();

/** Tab panels are read here; a Tab outside Tabs renders nothing. */
const tabs = computed(() =>
  (props.props.tabs ?? []).flatMap((tab: unknown, index: number) => {
    const element = tab as ElementNode | null;
    if (element?.type !== "element" || element.typeName !== "Tab") return [];
    const tabProps = element.props as IntelligentUiProps<"Tab">;
    return [
      {
        value: String(index),
        label: tabProps.label,
        children: tabProps.children,
      },
    ];
  }),
);
</script>

<template>
  <Tabs v-if="tabs.length > 0" data-iui="tabs" default-value="0">
    <TabsList>
      <TabsTrigger v-for="tab in tabs" :key="tab.value" :value="tab.value">
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="tab in tabs" :key="tab.value" :value="tab.value">
      <FieldGroup class="gap-5">
        <IuiNodes :value="tab.children" />
      </FieldGroup>
    </TabsContent>
  </Tabs>
</template>

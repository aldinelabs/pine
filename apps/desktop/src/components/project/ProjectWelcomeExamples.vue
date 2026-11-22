<script setup lang="ts">
import {
  FileTextIcon,
  FolderTreeIcon,
  RocketIcon,
  TelescopeIcon,
} from "@lucide/vue";
import { useI18n } from "vue-i18n";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

const emit = defineEmits<{
  /** The example's prompt, to put in the text box; nothing is sent. */
  pick: [prompt: string];
}>();

const { t } = useI18n();

/**
 * From looking around to building something new, so a first conversation
 * shows how far Pine can go. Blanks in `[[…]]` are left for the user.
 */
const EXAMPLES = [
  { id: "explore", icon: TelescopeIcon },
  { id: "research", icon: FileTextIcon },
  { id: "organize", icon: FolderTreeIcon },
  { id: "build", icon: RocketIcon },
] as const;
</script>

<template>
  <ItemGroup
    data-slot="welcome-examples"
    class="grid @lg/welcome:grid-cols-2"
    :aria-label="t('project.transcript.examples.label')"
  >
    <Item
      v-for="example in EXAMPLES"
      :key="example.id"
      as="button"
      type="button"
      variant="outline"
      size="sm"
      class="hover:bg-muted focus-visible:bg-muted cursor-default items-start text-start"
      :data-example="example.id"
      @click="
        emit('pick', t(`project.transcript.examples.${example.id}.prompt`))
      "
    >
      <ItemMedia variant="icon" class="text-muted-foreground">
        <component :is="example.icon" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {{ t(`project.transcript.examples.${example.id}.title`) }}
        </ItemTitle>
        <ItemDescription class="text-pretty">
          {{ t(`project.transcript.examples.${example.id}.prompt`) }}
        </ItemDescription>
      </ItemContent>
    </Item>
  </ItemGroup>
</template>

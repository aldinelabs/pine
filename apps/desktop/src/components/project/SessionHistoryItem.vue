<script setup lang="ts">
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import SessionContextMenu from "@/components/sessions/SessionContextMenu.vue";
import type { PineSessionGroup } from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";

/** One session row of the sidebar tree, at any folder depth. */
defineProps<{
  groups: PineSessionGroup[];
  isActive: boolean;
  session: ProjectSessionSearchResult;
  title: string;
}>();

const emit = defineEmits<{
  open: [];
  rename: [];
  export: [];
  move: [groupId: string | null];
  delete: [];
  dragstart: [event: DragEvent];
}>();
</script>

<template>
  <SidebarMenuSubItem @dragstart="emit('dragstart', $event)">
    <SessionContextMenu
      :groups="groups"
      :session="session"
      @rename="emit('rename')"
      @export="emit('export')"
      @move="emit('move', $event)"
      @delete="emit('delete')"
    >
      <SidebarMenuSubButton
        as="button"
        class="w-full translate-x-0"
        :data-session-id="session.id"
        :data-project-id="session.projectId"
        :draggable="true"
        :is-active="isActive"
        :title="title"
        @click="emit('open')"
      >
        <span>{{ title }}</span>
      </SidebarMenuSubButton>
    </SessionContextMenu>
  </SidebarMenuSubItem>
</template>

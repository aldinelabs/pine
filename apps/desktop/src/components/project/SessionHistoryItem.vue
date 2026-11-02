<script setup lang="ts">
import { computed } from "vue";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import SessionContextMenu from "@/components/sessions/SessionContextMenu.vue";
import { useSessionStore } from "@/stores/session";
import type { PineSessionGroup } from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";

/** One session row of the sidebar tree, at any folder depth. */
const props = defineProps<{
  groups: PineSessionGroup[];
  isActive: boolean;
  session: ProjectSessionSearchResult;
  title: string;
}>();

const sessionStore = useSessionStore();
const isRunning = computed(() =>
  sessionStore.isSessionRunning(props.session.id),
);

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
        <span
          data-slot="session-title"
          :data-running="isRunning || undefined"
          :class="isRunning ? 'shimmer' : undefined"
          >{{ title }}</span
        >
        <span
          v-if="isRunning"
          aria-hidden="true"
          data-slot="session-running-dot"
          class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
        />
      </SidebarMenuSubButton>
    </SessionContextMenu>
  </SidebarMenuSubItem>
</template>

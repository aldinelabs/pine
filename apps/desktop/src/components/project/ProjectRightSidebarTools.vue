<script setup lang="ts">
import { BlocksIcon, LibraryIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import McpManagerDialog from "@/components/mcp/McpManagerDialog.vue";
import SkillManagerDialog from "@/components/skills/SkillManagerDialog.vue";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useProjectStore } from "@/stores/project";

const { t } = useI18n();
const { activeProject } = storeToRefs(useProjectStore());
const isSkillManagerOpen = ref(false);
const isMcpManagerOpen = ref(false);
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid="project-skills-button"
        @click="isSkillManagerOpen = true"
      >
        <LibraryIcon aria-hidden="true" />
        <span>{{ t("project.skills") }}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid="project-mcp-button"
        @click="isMcpManagerOpen = true"
      >
        <BlocksIcon aria-hidden="true" />
        <span>{{ t("mcp.title") }}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>

  <SkillManagerDialog
    v-if="activeProject"
    v-model:open="isSkillManagerOpen"
    :project-id="activeProject.id"
  />
  <McpManagerDialog
    v-if="activeProject"
    v-model:open="isMcpManagerOpen"
    :project-id="activeProject.id"
  />
</template>

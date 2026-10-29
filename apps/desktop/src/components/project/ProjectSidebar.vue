<script setup lang="ts">
import { GitCommitHorizontal, Info } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useUpdaterStore } from "@/stores/updater";
import { PINE_RELEASES_URL } from "@/shared/window";
import AllProjectsSessionList from "./AllProjectsSessionList.vue";

const { t } = useI18n();
const emit = defineEmits<{
  manageProjects: [];
  searchSessions: [];
  showUpdate: [];
}>();
const { isAvailable } = storeToRefs(useUpdaterStore());
// A failed version lookup simply hides the version item.
const pineVersion = ref<string | null>(null);
onMounted(() => {
  window.pine
    .getAppVersion()
    .then((version) => {
      pineVersion.value = version;
    })
    .catch(() => undefined);
});

function openReleases(): void {
  void window.pine.openExternalUrl(PINE_RELEASES_URL);
}
</script>

<template>
  <Sidebar collapsible="offcanvas">
    <div
      aria-hidden="true"
      class="window-drag h-[var(--window-titlebar-height)] shrink-0"
    />
    <!-- Project history stays available across conversation tabs. -->
    <SidebarContent class="overflow-hidden">
      <AllProjectsSessionList
        @search="emit('searchSessions')"
        @manage-projects="emit('manageProjects')"
      />
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem v-if="isAvailable">
          <SidebarMenuButton
            class="text-info hover:text-info"
            @click="emit('showUpdate')"
          >
            <Info aria-hidden="true" />
            <span>{{ t("updater.sidebar") }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem v-else-if="pineVersion">
          <SidebarMenuButton data-testid="pine-version" @click="openReleases">
            <GitCommitHorizontal aria-hidden="true" />
            <span>{{ t("project.version", { version: pineVersion }) }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>

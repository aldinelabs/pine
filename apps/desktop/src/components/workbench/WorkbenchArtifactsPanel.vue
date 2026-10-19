<script setup lang="ts">
import { FilesIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { fileIcon } from "@/lib/fileIcon";
import { fileName } from "@/lib/filePreviewTarget";
import { UI_PRESENT_FILE_TOOL_NAME } from "@/shared/agent";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";

interface Artifact {
  toolCallId: string;
  path: string;
}

const { t } = useI18n();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const contentTabs = useContentTabsStore();
const workbench = useWorkbenchStore();
const { messages, activeSession } = storeToRefs(sessionStore);

function presentedPath(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("path" in input))
    return null;
  return typeof input.path === "string" && input.path.trim()
    ? input.path.trim()
    : null;
}

/** Files the session presented, newest first, each path once. */
const artifacts = computed<Artifact[]>(() => {
  const byPath = new Map<string, Artifact>();
  for (const message of messages.value) {
    for (const block of message.blocks) {
      if (block.type !== "toolCall") continue;
      const { toolCall } = block;
      if (
        toolCall.name !== UI_PRESENT_FILE_TOOL_NAME ||
        toolCall.status === "error"
      )
        continue;
      const path = presentedPath(toolCall.input);
      if (!path) continue;
      byPath.delete(path);
      byPath.set(path, { toolCallId: toolCall.id, path });
    }
  }
  return [...byPath.values()].reverse();
});

const previewedToolCallId = computed(
  () => workbench.activeLayout.preview?.toolCallId,
);

async function show(artifact: Artifact): Promise<void> {
  const sessionId = activeSession.value?.id;
  const projectId = sessionId
    ? (sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId)
    : projectStore.currentProjectId;
  try {
    // Files presented in this window were resolved already; older ones are
    // resolved again from the tool call, which re-grants read access.
    const target =
      contentTabs.presentedTargetFor(artifact.toolCallId) ??
      (sessionId
        ? await window.pine.reopenPresentedToolFile({
            projectId,
            sessionId,
            toolCallId: artifact.toolCallId,
          })
        : null);
    if (!target) throw new Error(artifact.path);
    contentTabs.rememberPresentedTarget(artifact.toolCallId, target);
    workbench.preview({ target, toolCallId: artifact.toolCallId });
  } catch {
    toast.error(t("project.workbench.artifacts.openFailed"), {
      description: artifact.path,
    });
  }
}
</script>

<template>
  <div data-testid="workbench-artifacts" class="flex h-full min-h-0 flex-col">
    <Empty v-if="artifacts.length === 0" class="flex-1 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FilesIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>
          {{ t("project.workbench.artifacts.empty") }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <SidebarMenu v-else class="px-(--workbench-inset) pb-(--workbench-inset)">
      <SidebarMenuItem
        v-for="artifact in artifacts"
        :key="artifact.path"
        data-testid="workbench-artifact"
      >
        <SidebarMenuButton
          :is-active="artifact.toolCallId === previewedToolCallId"
          :title="artifact.path"
          @click="show(artifact)"
        >
          <component :is="fileIcon(artifact.path)" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{
            fileName(artifact.path)
          }}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </div>
</template>

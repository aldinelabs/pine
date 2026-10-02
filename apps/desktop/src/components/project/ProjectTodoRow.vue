<script setup lang="ts">
import { CircleCheckIcon, CircleDotIcon, CircleIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { sanitizeTaskText, type Task } from "@pine/rpiv-todo";
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const props = defineProps<{
  task: Task;
  /** `#id` prefixes only help while some task points at another. */
  showId: boolean;
  /** The in-progress task spins only while the agent is working. */
  isRunning: boolean;
}>();
const emit = defineEmits<{ select: [] }>();
const { t } = useI18n();

const subject = computed(() => sanitizeTaskText(props.task.subject));
const activeForm = computed(() =>
  props.task.status === "in_progress" && props.task.activeForm
    ? sanitizeTaskText(props.task.activeForm)
    : undefined,
);
const blockedBy = computed(() =>
  props.task.blockedBy?.length
    ? t("project.todos.blockedBy", {
        ids: props.task.blockedBy.map((id) => `#${id}`).join(","),
      })
    : undefined,
);
const statusLabel = computed(() =>
  t(`project.todos.statuses.${props.task.status}`),
);
</script>

<template>
  <SidebarMenuItem data-testid="project-todo-row" :data-status="task.status">
    <SidebarMenuButton
      size="sm"
      :class="cn(blockedBy && 'pr-16')"
      :title="task.description ? sanitizeTaskText(task.description) : subject"
      @click="emit('select')"
    >
      <Spinner
        v-if="task.status === 'in_progress' && isRunning"
        class="text-primary"
      />
      <CircleDotIcon
        v-else-if="task.status === 'in_progress'"
        class="text-primary"
      />
      <CircleCheckIcon
        v-else-if="task.status === 'completed'"
        class="text-muted-foreground"
      />
      <CircleIcon v-else class="text-muted-foreground" />
      <span class="sr-only">{{ statusLabel }}</span>
      <span v-if="showId" class="text-muted-foreground tabular-nums">
        #{{ task.id }}
      </span>
      <span
        :class="
          cn(
            task.status === 'in_progress' && 'text-primary font-medium',
            task.status === 'completed' && 'text-muted-foreground line-through',
          )
        "
      >
        {{ subject }}
      </span>
    </SidebarMenuButton>
    <SidebarMenuBadge
      v-if="blockedBy"
      class="text-muted-foreground font-normal"
    >
      {{ blockedBy }}
    </SidebarMenuBadge>
    <SidebarMenuSub v-if="activeForm">
      <SidebarMenuSubItem>
        <SidebarMenuSubButton as="div" size="sm" class="text-muted-foreground">
          <span>{{ activeForm }}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  </SidebarMenuItem>
</template>

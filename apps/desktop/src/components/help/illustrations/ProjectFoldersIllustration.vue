<script setup lang="ts">
import { FolderIcon, LockIcon, PencilIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

/** The default folder can be changed; the context folders here are read only. */
const folders = [
  { width: "w-20", writable: true },
  { width: "w-24", writable: false },
  { width: "w-16", writable: false },
];
</script>

<!-- A project is a set of folders, each read only or read and write. -->
<template>
  <div
    class="bg-background ring-foreground/10 flex w-full max-w-xs flex-col gap-1 rounded-3xl p-2 shadow-sm ring-1"
  >
    <div
      v-for="(folder, index) in folders"
      :key="index"
      class="help-folder flex items-center gap-2 rounded-2xl px-3 py-2"
      :style="{ animationDelay: `${index * 0.5}s` }"
    >
      <FolderIcon class="text-info size-4 shrink-0" />
      <span :class="['bg-foreground/50 h-2 rounded-full', folder.width]" />
      <span
        :class="[
          'ms-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
          folder.writable
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        ]"
      >
        <component
          :is="folder.writable ? PencilIcon : LockIcon"
          class="size-3"
        />
        {{
          folder.writable
            ? t("projects.access.readWrite")
            : t("projects.access.readOnly")
        }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.help-folder {
  animation: help-folder 5s cubic-bezier(0.16, 1, 0.3, 1) infinite both;
}

@keyframes help-folder {
  0% {
    opacity: 0;
    transform: translateY(-0.5rem);
  }
  12%,
  90% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .help-folder {
    animation: none;
  }
}
</style>

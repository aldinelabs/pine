<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

const props = defineProps<{ page: number; pageCount: number }>();
const emit = defineEmits<{ "update:page": [page: number] }>();
const { t } = useI18n();

function go(target: number): void {
  const next = Math.min(props.pageCount, Math.max(1, Math.round(target)));
  if (next !== props.page) emit("update:page", next);
}

function commit(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (Number.isFinite(value)) go(value);
  input.value = String(props.page);
}
</script>

<template>
  <div class="flex items-center gap-1 text-sm text-muted-foreground">
    <Button
      variant="ghost"
      size="icon-sm"
      :aria-label="t('project.preview.previousPage')"
      :disabled="page <= 1"
      @click="go(page - 1)"
    >
      <ChevronLeft />
    </Button>
    <InputGroup class="h-7 w-auto">
      <InputGroupInput
        :key="page"
        class="w-10 text-center tabular-nums"
        inputmode="numeric"
        :model-value="String(page)"
        :aria-label="t('project.preview.page')"
        @change="commit"
        @keydown.enter.prevent="commit"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText class="tabular-nums">/ {{ pageCount }}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
    <Button
      variant="ghost"
      size="icon-sm"
      :aria-label="t('project.preview.nextPage')"
      :disabled="page >= pageCount"
      @click="go(page + 1)"
    >
      <ChevronRight />
    </Button>
  </div>
</template>

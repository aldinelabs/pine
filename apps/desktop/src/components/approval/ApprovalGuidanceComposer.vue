<script setup lang="ts">
import { ArrowUpIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";

const props = defineProps<{ disabled?: boolean }>();
const guidance = defineModel<string>({ required: true });
const emit = defineEmits<{
  submit: [guidance: string];
  cancel: [];
}>();

const { t } = useI18n();
const input = ref<{ $el: HTMLTextAreaElement } | null>(null);
const composing = ref(false);
const canSubmit = computed(() => !props.disabled && !!guidance.value.trim());

function submit(): void {
  if (canSubmit.value) emit("submit", guidance.value.trim());
}

function handleKeydown(event: KeyboardEvent): void {
  // Let the IME accept or dismiss candidates before handling composer keys.
  // Some IMEs report the accepting key with keyCode 229, not isComposing.
  if (
    event.defaultPrevented ||
    composing.value ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  ) {
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) submit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (!props.disabled) emit("cancel");
  }
}

onMounted(() => input.value?.$el.focus());
</script>

<template>
  <form class="flex w-full min-w-0 items-end gap-2" @submit.prevent="submit">
    <InputGroup
      class="h-auto min-h-8 flex-1 rounded-2xl border-0 bg-muted shadow-none has-[textarea]:rounded-2xl dark:bg-muted"
    >
      <InputGroupTextarea
        ref="input"
        v-model="guidance"
        rows="1"
        class="scroll-fade-y max-h-32 min-h-8 overflow-y-auto overscroll-contain px-3 py-1.5 text-sm leading-5"
        :placeholder="t('project.approvalRequest.guide')"
        :aria-label="t('project.approvalRequest.guide')"
        :disabled="props.disabled"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="handleKeydown"
      />
    </InputGroup>
    <Button
      type="submit"
      size="icon"
      :disabled="!canSubmit"
      :aria-label="t('project.approvalRequest.guide')"
      :title="t('project.approvalRequest.guide')"
    >
      <ArrowUpIcon />
    </Button>
  </form>
</template>

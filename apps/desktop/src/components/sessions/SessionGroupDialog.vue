<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PineSessionGroup } from "@/shared/projects";

const props = withDefaults(
  defineProps<{
    group?: PineSessionGroup | null;
    isSaving?: boolean;
    mode: "create" | "rename";
  }>(),
  {
    group: null,
    isSaving: false,
  },
);
const emit = defineEmits<{
  submit: [name: string];
}>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18n();
const name = ref("");

const title = computed(() =>
  props.mode === "create"
    ? t("sessions.createGroupTitle")
    : t("sessions.renameGroupTitle"),
);
const description = computed(() =>
  props.mode === "create"
    ? t("sessions.createGroupDescription")
    : t("sessions.renameGroupDescription"),
);
const canSubmit = computed(
  () => name.value.trim().length > 0 && !props.isSaving,
);

function reset(): void {
  name.value = props.mode === "rename" ? (props.group?.name ?? "") : "";
}

function submit(): void {
  const value = name.value.trim();
  if (!value || props.isSaving) return;
  emit("submit", value);
}

watch([open, () => props.group, () => props.mode], ([isOpen]) => {
  if (isOpen) reset();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <form class="flex flex-col gap-6" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
          <DialogDescription>{{ description }}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel for="session-group-name">
              {{ t("sessions.groupNameLabel") }}
            </FieldLabel>
            <Input
              id="session-group-name"
              v-model="name"
              maxlength="100"
              autocomplete="off"
              :placeholder="t('sessions.groupNamePlaceholder')"
              required
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="isSaving"
            @click="open = false"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="!canSubmit">
            {{ t("common.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

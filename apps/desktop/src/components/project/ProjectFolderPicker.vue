<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isWebClient } from "@/lib/clientRuntime";
import type { ProjectFolderInput } from "@/shared/projects";

/**
 * Chooses project folders on the computer running Pine. The desktop window
 * opens the native picker; a browser cannot browse the host, so it asks for
 * an absolute path instead.
 */
const props = defineProps<{ mode: "default" | "context" }>();
const emit = defineEmits<{ picked: [folders: ProjectFolderInput[]] }>();

const { t } = useI18n();
const isWeb = isWebClient();
const open = ref(false);
const path = ref("");
const touched = ref(false);

const trimmedPath = computed(() => path.value.trim());
const isAbsolute = computed(
  () =>
    trimmedPath.value.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(trimmedPath.value) ||
    trimmedPath.value.startsWith("\\\\"),
);
const pathError = computed(() =>
  touched.value && trimmedPath.value && !isAbsolute.value
    ? t("projects.editor.hostFolder.absoluteRequired")
    : "",
);

async function pickNative(): Promise<void> {
  const { folders } = await window.pine.pickProjectFolders({
    mode: props.mode,
  });
  if (folders.length > 0) emit("picked", folders);
}

function setOpen(value: boolean): void {
  open.value = value;
  if (!value) {
    path.value = "";
    touched.value = false;
  }
}

function submit(): void {
  touched.value = true;
  if (!trimmedPath.value || !isAbsolute.value) return;
  const folderPath = trimmedPath.value.replace(/[\\/]+$/, "") || "/";
  emit("picked", [
    {
      id: crypto.randomUUID(),
      access: "read-write",
      name: folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? folderPath,
      path: folderPath,
    },
  ]);
  setOpen(false);
}
</script>

<template>
  <span v-if="!isWeb" class="contents" @click="pickNative">
    <slot />
  </span>
  <Popover v-else :open="open" @update:open="setOpen">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverContent align="end" class="w-96">
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <PopoverHeader>
          <PopoverTitle>{{
            t("projects.editor.hostFolder.title")
          }}</PopoverTitle>
          <PopoverDescription>
            {{ t("projects.editor.hostFolder.description") }}
          </PopoverDescription>
        </PopoverHeader>
        <Field :data-invalid="pathError ? true : undefined">
          <InputGroup>
            <InputGroupInput
              v-model="path"
              data-testid="host-folder-path"
              autocomplete="off"
              spellcheck="false"
              class="font-mono text-xs"
              :placeholder="t('projects.editor.hostFolder.placeholder')"
              :aria-label="t('projects.editor.hostFolder.title')"
              :aria-invalid="pathError ? true : undefined"
              @blur="touched = true"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="submit"
                variant="secondary"
                :disabled="!trimmedPath"
              >
                {{ t("projects.editor.hostFolder.confirm") }}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError v-if="pathError">{{ pathError }}</FieldError>
          <FieldDescription v-else>
            {{ t("projects.editor.hostFolder.hint") }}
          </FieldDescription>
        </Field>
      </form>
    </PopoverContent>
  </Popover>
</template>

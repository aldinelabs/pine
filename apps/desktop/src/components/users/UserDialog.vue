<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PineColorSwatches } from "@/components/pine";
import UserAvatar from "@/components/users/UserAvatar.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { USER_COLOR_CLASSES } from "@/lib/userColors";
import {
  MAX_USER_NAME_LENGTH,
  USER_AVATARS,
  USER_COLORS,
  type PineUser,
  type PineUserAvatar,
  type PineUserColor,
} from "@/shared/users";
import { userErrorCode, useUsersStore } from "@/stores/users";

/**
 * Adds a user, or edits one's name, avatar and colour. Copying model
 * connections is offered only when adding from a running Pine.
 */
const props = withDefaults(
  defineProps<{
    /** The user to edit; null adds one. */
    user: PineUser | null;
    offerCopy?: boolean;
  }>(),
  { offerCopy: false },
);
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [user: PineUser] }>();

const { t } = useI18n();
const usersStore = useUsersStore();
const id = useId();
const name = ref("");
const avatar = ref<PineUserAvatar | null>(null);
const color = ref<PineUserColor>("blue");
const copyModelConnections = ref(true);
const isSaving = ref(false);
const error = ref<string>();

/** A colour nobody uses yet, so new users are told apart at a glance. */
function freshColor(): PineUserColor {
  const taken = new Set(usersStore.users.map((user) => user.color));
  return USER_COLORS.find((option) => !taken.has(option)) ?? "blue";
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    name.value = props.user?.name ?? "";
    avatar.value = props.user?.avatar ?? null;
    color.value = props.user?.color ?? freshColor();
    copyModelConnections.value = true;
    error.value = undefined;
  },
  { immediate: true },
);

const colorOptions = computed(() =>
  USER_COLORS.map((option) => ({
    value: option,
    label: t(`users.colors.${option}`),
    class: USER_COLOR_CLASSES[option].swatch,
  })),
);

const trimmed = computed(() => name.value.trim());
const canSave = computed(() => trimmed.value.length > 0 && !isSaving.value);

async function save(): Promise<void> {
  if (!canSave.value) return;
  isSaving.value = true;
  error.value = undefined;
  try {
    const fields = {
      name: trimmed.value,
      avatar: avatar.value,
      color: color.value,
    };
    const next = props.user
      ? await usersStore.update({ id: props.user.id, ...fields })
      : await usersStore.create({
          ...fields,
          copyModelConnections: props.offerCopy && copyModelConnections.value,
        });
    const saved = props.user
      ? next.users.find((user) => user.id === props.user?.id)
      : next.users.at(-1);
    open.value = false;
    if (saved) emit("saved", saved);
  } catch (caught) {
    error.value = t(`users.errors.${userErrorCode(caught)}`);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md" data-testid="user-dialog">
      <form class="flex flex-col gap-5" @submit.prevent="save">
        <DialogHeader>
          <DialogTitle>
            {{ props.user ? t("users.editTitle") : t("users.addTitle") }}
          </DialogTitle>
          <DialogDescription v-if="!props.user">
            {{ t("users.addDescription") }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex justify-center">
          <UserAvatar
            :name="trimmed"
            :avatar="avatar"
            :color="color"
            size="xl"
          />
        </div>

        <FieldGroup class="gap-5">
          <Field :data-invalid="error ? true : undefined">
            <FieldLabel :for="`${id}-name`">{{ t("users.name") }}</FieldLabel>
            <Input
              :id="`${id}-name`"
              v-model="name"
              data-testid="user-dialog-name"
              :maxlength="MAX_USER_NAME_LENGTH"
              autocomplete="off"
              autofocus
              :aria-invalid="error ? true : undefined"
              @input="error = undefined"
            />
            <FieldError v-if="error" data-testid="user-dialog-error">
              {{ error }}
            </FieldError>
          </Field>

          <Field>
            <FieldTitle :id="`${id}-avatar`">{{
              t("users.avatar")
            }}</FieldTitle>
            <div
              role="radiogroup"
              :aria-labelledby="`${id}-avatar`"
              class="grid grid-cols-9 gap-1"
            >
              <Button
                type="button"
                role="radio"
                size="icon-sm"
                data-slot="user-avatar-option"
                class="text-sm font-medium"
                :variant="avatar === null ? 'secondary' : 'ghost'"
                :aria-checked="avatar === null"
                :aria-label="t('users.initial')"
                :title="t('users.initial')"
                @click="avatar = null"
              >
                {{
                  trimmed ? Array.from(trimmed)[0]?.toLocaleUpperCase() : "A"
                }}
              </Button>
              <Button
                v-for="option in USER_AVATARS"
                :key="option"
                type="button"
                role="radio"
                size="icon-sm"
                data-slot="user-avatar-option"
                class="text-base"
                :variant="avatar === option ? 'secondary' : 'ghost'"
                :aria-checked="avatar === option"
                :aria-label="option"
                @click="avatar = option"
              >
                {{ option }}
              </Button>
            </div>
          </Field>

          <Field>
            <FieldTitle :id="`${id}-color`">{{ t("users.color") }}</FieldTitle>
            <PineColorSwatches
              v-model="color"
              :options="colorOptions"
              :labelledby="`${id}-color`"
              item-slot="user-color-option"
            />
          </Field>

          <Field v-if="props.offerCopy && !props.user" orientation="horizontal">
            <Checkbox
              :id="`${id}-copy`"
              v-model="copyModelConnections"
              data-testid="user-dialog-copy"
            />
            <FieldContent>
              <FieldLabel :for="`${id}-copy`">
                {{ t("users.copyConnections") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("users.copyConnectionsHint") }}
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">
            {{ t("common.cancel") }}
          </Button>
          <Button
            type="submit"
            data-testid="user-dialog-save"
            :disabled="!canSave"
          >
            <Spinner v-if="isSaving" data-icon="inline-start" />
            {{ props.user ? t("users.save") : t("users.create") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

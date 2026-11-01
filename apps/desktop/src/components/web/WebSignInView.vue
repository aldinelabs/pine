<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { signInBrowser } from "@/client/webSignIn";
import { PineLogo } from "@/components/pine";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const emit = defineEmits<{ signedIn: [] }>();

const { t } = useI18n();
const password = ref("");
const isSigningIn = ref(false);
const error = ref<"wrong-password" | "unavailable">();
const lockedFor = ref(0);
const input = ref<InstanceType<typeof Input>>();

const { pause, resume } = useIntervalFn(
  () => {
    lockedFor.value = Math.max(0, lockedFor.value - 1);
    if (lockedFor.value === 0) pause();
  },
  1000,
  { immediate: false },
);

const message = computed(() => {
  if (lockedFor.value > 0)
    return t("webSignIn.locked", { seconds: lockedFor.value });
  return error.value ? t(`webSignIn.${error.value}`) : undefined;
});

async function submit(): Promise<void> {
  if (!password.value || isSigningIn.value || lockedFor.value > 0) return;
  isSigningIn.value = true;
  error.value = undefined;
  const result = await signInBrowser(password.value);
  isSigningIn.value = false;
  if (result.status === "signed-in") {
    emit("signedIn");
    return;
  }
  if (result.status === "locked") {
    lockedFor.value = result.retryAfter;
    resume();
  } else error.value = result.status;
  const element = (input.value?.$el as HTMLInputElement | undefined) ?? null;
  element?.focus();
  element?.select();
}
</script>

<template>
  <main
    class="flex min-h-dvh items-center justify-center bg-background p-4"
    data-testid="web-sign-in"
  >
    <Card class="w-full max-w-sm">
      <CardHeader>
        <PineLogo class="mb-2 size-8 text-primary" aria-hidden="true" />
        <CardTitle>{{ t("webSignIn.title") }}</CardTitle>
        <CardDescription>{{ t("webSignIn.description") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <Field :data-invalid="message ? true : undefined">
            <FieldLabel for="web-sign-in-password">
              {{ t("webSignIn.password") }}
            </FieldLabel>
            <Input
              id="web-sign-in-password"
              ref="input"
              v-model="password"
              data-testid="web-sign-in-password"
              type="password"
              autocomplete="current-password"
              autofocus
              :aria-invalid="message ? true : undefined"
              @input="error = undefined"
            />
            <FieldError v-if="message" data-testid="web-sign-in-error">
              {{ message }}
            </FieldError>
          </Field>
          <Button
            type="submit"
            class="w-full"
            data-testid="web-sign-in-submit"
            :disabled="!password || isSigningIn || lockedFor > 0"
          >
            <Spinner v-if="isSigningIn" data-icon="inline-start" />
            {{ isSigningIn ? t("webSignIn.signingIn") : t("webSignIn.submit") }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </main>
</template>

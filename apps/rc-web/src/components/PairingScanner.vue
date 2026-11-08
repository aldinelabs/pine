<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { QrCamera } from "@/qrCamera";

const emit = defineEmits<{ scanned: [url: string]; cancel: [] }>();
const { t } = useI18n();
const video = useTemplateRef<HTMLVideoElement>("video");
const failed = ref(false);
const camera = new QrCamera();
onMounted(async () => {
  try {
    await camera.start(video.value!, (url) => emit("scanned", url));
  } catch {
    failed.value = true;
  }
});
onUnmounted(() => camera.stop());
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <p class="text-sm text-muted-foreground" role="status">
      {{ t(failed ? "cameraFailed" : "scanDescription") }}
    </p>
    <video
      v-show="!failed"
      ref="video"
      autoplay
      muted
      playsinline
      class="aspect-square w-full rounded-md bg-muted object-cover"
      :aria-label="t('scanCode')"
    />
    <Button type="button" variant="outline" @click="emit('cancel')">
      {{ t("back") }}
    </Button>
  </div>
</template>

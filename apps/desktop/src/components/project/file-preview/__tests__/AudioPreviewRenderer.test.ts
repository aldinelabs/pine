import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, provide, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import AudioPreviewRenderer from "../AudioPreviewRenderer.vue";
import { previewAnnotationsKey } from "../previewRenderer";

const props = {
  preview: {
    kind: "audio" as const,
    url: "pine-project-media://preview/?song",
    size: 10,
    modifiedAt: "",
  },
  fileName: "song.mp3",
  filePath: "/music/song.mp3",
  active: true,
  mode: "rendered" as const,
  zoom: 100,
  inverted: false,
  selectionLabel: "",
};

function render() {
  return mount(AudioPreviewRenderer, {
    props,
    global: { plugins: [createAppI18n("en-US")] },
  });
}

describe("AudioPreviewRenderer", () => {
  it("plays, seeks and reports the duration", async () => {
    const wrapper = render();
    const audio = wrapper.get("audio").element;
    Object.defineProperty(audio, "duration", { value: 125 });
    const play = vi.spyOn(audio, "play").mockResolvedValue();
    await wrapper.get("audio").trigger("loadedmetadata");
    expect(wrapper.emitted("metadataChange")?.[0]).toEqual([{ duration: 125 }]);
    expect(wrapper.emitted("capabilitiesChange")).toBeUndefined();
    expect(wrapper.text()).toContain("0:00 / 2:05");

    await wrapper.get('button[aria-label="Play"]').trigger("click");
    expect(play).toHaveBeenCalled();
    Object.defineProperty(audio, "paused", { value: false });
    await wrapper.get("audio").trigger("play");
    expect(wrapper.find('button[aria-label="Pause"]').exists()).toBe(true);
  });

  it("pauses when its tab is hidden", async () => {
    const wrapper = render();
    const pause = vi.spyOn(wrapper.get("audio").element, "pause");
    await wrapper.setProps({ active: false });
    expect(pause).toHaveBeenCalled();
  });

  it("offers time comments and reveals them paused at their start", async () => {
    const Host = defineComponent({
      setup() {
        provide(previewAnnotationsKey, {
          annotations: ref([]),
          activeId: ref(undefined),
          enabled: computed(() => true),
          draft: ref(undefined),
          select: vi.fn(),
          compose: vi.fn(),
        });
        return () => h(AudioPreviewRenderer, props);
      },
    });
    const host = mount(Host, {
      global: { plugins: [createAppI18n("en-US")] },
    });
    const wrapper = host.findComponent(AudioPreviewRenderer);
    const audio = wrapper.get("audio").element;
    Object.defineProperty(audio, "duration", { value: 60 });
    const pause = vi.spyOn(audio, "pause");
    await wrapper.get("audio").trigger("loadedmetadata");
    expect(wrapper.emitted("capabilitiesChange")?.[0]).toEqual([
      { annotateTime: true },
    ]);

    (
      wrapper.vm as unknown as {
        revealAnnotation: (request: object) => void;
      }
    ).revealAnnotation({ shape: { kind: "time", start: 12, end: 20 } });
    expect(pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(12);
  });
});

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import AudioPreviewRenderer from "../AudioPreviewRenderer.vue";

function render() {
  return mount(AudioPreviewRenderer, {
    props: {
      preview: {
        kind: "audio",
        url: "pine-project-media://preview/?song",
        size: 10,
        modifiedAt: "",
      },
      fileName: "song.mp3",
      filePath: "/music/song.mp3",
      active: true,
      mode: "rendered",
      zoom: 100,
      inverted: false,
      selectionLabel: "",
    },
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
    expect(wrapper.text()).toContain("0:00 / 2:05");

    await wrapper.get('button[aria-label="Play"]').trigger("click");
    expect(play).toHaveBeenCalled();
    await wrapper.get("audio").trigger("play");
    expect(wrapper.find('button[aria-label="Pause"]').exists()).toBe(true);
  });

  it("pauses when its tab is hidden", async () => {
    const wrapper = render();
    const pause = vi.spyOn(wrapper.get("audio").element, "pause");
    await wrapper.setProps({ active: false });
    expect(pause).toHaveBeenCalled();
  });
});

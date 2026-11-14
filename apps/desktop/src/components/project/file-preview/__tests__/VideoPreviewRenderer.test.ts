import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import VideoPreviewRenderer from "../VideoPreviewRenderer.vue";

function render() {
  return mount(VideoPreviewRenderer, {
    props: {
      preview: {
        kind: "video",
        url: "pine-project-media://preview/?clip",
        size: 10,
        modifiedAt: "",
      },
      fileName: "clip.mp4",
      filePath: "/movies/clip.mp4",
      active: true,
      mode: "rendered",
      zoom: 100,
      inverted: false,
      selectionLabel: "",
    },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

describe("VideoPreviewRenderer", () => {
  it("uses Pine's controls instead of the browser's and reports metadata", async () => {
    const wrapper = render();
    const video = wrapper.get("video");
    expect(video.attributes("controls")).toBeUndefined();
    Object.defineProperty(video.element, "duration", { value: 90 });
    Object.defineProperty(video.element, "videoWidth", { value: 1920 });
    Object.defineProperty(video.element, "videoHeight", { value: 1080 });
    await video.trigger("loadedmetadata");
    expect(wrapper.emitted("metadataChange")?.[0]).toEqual([
      { width: 1920, height: 1080, duration: 90 },
    ]);
    expect(wrapper.text()).toContain("0:00 / 1:30");

    const play = vi.spyOn(video.element, "play").mockResolvedValue();
    await video.trigger("click");
    expect(play).toHaveBeenCalled();
  });

  it("pauses when its tab is hidden", async () => {
    const wrapper = render();
    const pause = vi.spyOn(wrapper.get("video").element, "pause");
    await wrapper.setProps({ active: false });
    expect(pause).toHaveBeenCalled();
  });

  it("reveals a time comment paused at its start", () => {
    const wrapper = render();
    const video = wrapper.get("video").element;
    const pause = vi.spyOn(video, "pause");
    (
      wrapper.vm as unknown as {
        revealAnnotation: (request: object) => void;
      }
    ).revealAnnotation({ shape: { kind: "time", start: 33, end: 40 } });
    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(33);
  });
});

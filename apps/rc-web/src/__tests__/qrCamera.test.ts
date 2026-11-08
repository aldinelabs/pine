import { afterEach, expect, it, vi } from "vitest";
import { QrCamera } from "../qrCamera";
vi.mock("jsqr", () => ({ default: vi.fn(() => null) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("stops a camera granted after leaving the scanner", async () => {
  let grant!: (value: MediaStream) => void;
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve;
        }),
    },
  });
  const video = { play: vi.fn() } as unknown as HTMLVideoElement;
  const camera = new QrCamera();
  const starting = camera.start(video, vi.fn());
  camera.stop();
  grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await starting;
  expect(stop).toHaveBeenCalledOnce();
  expect(video.play).not.toHaveBeenCalled();
});

it("releases the stream if video playback fails", async () => {
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    },
  });
  const camera = new QrCamera();
  await expect(
    camera.start(
      {
        play: vi.fn().mockRejectedValue(new Error("blocked")),
      } as unknown as HTMLVideoElement,
      vi.fn(),
    ),
  ).rejects.toThrow("blocked");
  expect(stop).toHaveBeenCalledOnce();
});

it("decodes a code once, then releases the camera and stops polling", async () => {
  vi.useFakeTimers();
  const { default: decode } = await import("jsqr");
  vi.mocked(decode).mockReturnValueOnce({ data: "pairing-url" } as ReturnType<
    typeof decode
  >);
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    },
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({
          data: new Uint8ClampedArray(4),
          width: 1,
          height: 1,
        }),
      }),
    }),
  });
  const found = vi.fn();
  await new QrCamera().start(
    {
      play: vi.fn().mockResolvedValue(undefined),
      readyState: 2,
      videoWidth: 100,
      videoHeight: 100,
    } as unknown as HTMLVideoElement,
    found,
  );
  expect(found).toHaveBeenCalledExactlyOnceWith("pairing-url");
  expect(stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

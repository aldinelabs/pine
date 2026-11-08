import jsQR from "jsqr";

/** Owns one camera request, including permission prompts that outlive the view. */
export class QrCamera {
  private stopped = false;
  private stream?: MediaStream;
  private timer?: ReturnType<typeof setTimeout>;

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  async start(
    video: HTMLVideoElement,
    onCode: (value: string) => void,
  ): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    });
    this.stream = stream;
    if (this.stopped) {
      this.stop();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
      if (this.stopped) return;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      const scan = () => {
        if (this.stopped) return;
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 960 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const code = jsQR(pixels.data, pixels.width, pixels.height);
          if (code) {
            this.stop();
            onCode(code.data);
            return;
          }
        }
        this.timer = setTimeout(scan, 150);
      };
      scan();
    } catch (error) {
      this.stop();
      throw error;
    }
  }
}

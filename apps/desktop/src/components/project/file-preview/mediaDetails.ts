import { onBeforeUnmount } from "vue";
import {
  mediaProperties,
  readMediaInfo,
  urlByteSource,
  type MediaInfo,
} from "@/lib/previewProperties/mediaInfo";
import type { PreviewProperty } from "./previewRenderer";

/**
 * Reads a media file's container headers once, by byte range, and reports
 * them as Details properties. Call the returned function after the element
 * has its metadata (so playback is never held up), again when the duration
 * changes; failures report nothing.
 */
export function useMediaDetails(
  kind: "audio" | "video",
  url: () => string,
  report: (properties: PreviewProperty[]) => void,
): (duration?: number) => Promise<void> {
  const reading = new AbortController();
  let header: Promise<{ info: MediaInfo; size?: number } | undefined>;
  onBeforeUnmount(() => reading.abort());

  return async (duration) => {
    header ??= (async () => {
      const source = urlByteSource(url(), reading.signal);
      try {
        return { info: await readMediaInfo(source), size: source.size };
      } catch {
        return undefined;
      }
    })();
    const result = await header;
    if (!result || reading.signal.aborted) return;
    const properties = mediaProperties(result.info, kind, {
      duration,
      size: result.size,
    });
    if (properties.length) report(properties);
  };
}

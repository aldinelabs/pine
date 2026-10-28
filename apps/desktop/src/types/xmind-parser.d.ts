declare module "@ljheee/xmind-parser" {
  export function parseXmind2020Json(
    json: string,
    options?: { resources?: Record<string, Uint8Array> | null },
  ): unknown[];
  export function parseXmind8Xml(
    xml: string,
    options?: {
      resources?: Record<string, Uint8Array> | null;
      commentsXml?: string;
    },
  ): unknown[];
}

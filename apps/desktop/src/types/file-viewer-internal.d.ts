declare module "@file-viewer-internal/umd-parser" {
  export interface UmdImage {
    bytes: Uint8Array;
    extension: string;
    id: string;
    mimeType: string;
  }
  export interface UmdChapter {
    content: string;
    id: string;
    images: UmdImage[];
    title: string;
  }
  export interface UmdBook {
    author: string;
    chapters: UmdChapter[];
    cover?: UmdImage;
    title: string;
    warnings: string[];
  }
  export function parseUmdBook(buffer: ArrayBuffer): UmdBook;
}

declare module "@file-viewer-internal/ofd" {
  export function parseOfdDocument(options: {
    ofd: ArrayBuffer;
    success?: (documents: unknown[]) => void;
    fail?: (reason: unknown) => void;
  }): void;
  /** Renders every page of a document at the given width, in pixels. */
  export function renderOfd(width: number, document: unknown): HTMLElement[];
}

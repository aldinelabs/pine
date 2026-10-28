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

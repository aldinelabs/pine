declare module "utif" {
  /** An image file directory: one page and its tags, keyed like `t256`. */
  export interface IFD {
    width: number;
    height: number;
    [tag: string]: unknown;
  }
  export function decode(buffer: ArrayBuffer): IFD[];
  export function decodeImage(buffer: ArrayBuffer, ifd: IFD): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
  const UTIF: {
    decode: typeof decode;
    decodeImage: typeof decodeImage;
    toRGBA8: typeof toRGBA8;
  };
  export default UTIF;
}

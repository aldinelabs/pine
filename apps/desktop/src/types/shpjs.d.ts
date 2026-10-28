declare module "shpjs" {
  /** Geometries of a `.shp` file, in its own coordinates. */
  export function parseShp(shp: ArrayBuffer, prj?: string | false): never[];
}

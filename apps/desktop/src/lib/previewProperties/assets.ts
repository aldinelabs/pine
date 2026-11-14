/**
 * Details properties for design and engineering files, built from what each
 * renderer has already parsed: Photoshop documents, swatch files, fonts, 3D
 * models, CAD drawings, chip layouts and geodata.
 */
import type { Psd } from "ag-psd";
import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import type { FontInfo } from "@/lib/fontInfo";
import type { GeoFeature } from "@/lib/geo";
import type { SwatchGroup } from "@/lib/palettes";
import { readXmp, type ImageFacts } from "./image";
import { PropertyList } from "./propertyList";

/** ag-psd's `ColorMode` values (a const enum, so not importable here). */
const PSD_COLOR_MODES: Record<number, string> = {
  0: "Bitmap",
  1: "Grayscale",
  2: "Indexed",
  3: "RGB",
  4: "CMYK",
  7: "Multichannel",
  8: "Duotone",
  9: "Lab",
};

function countLayers(layers: Psd["children"]): number {
  return (layers ?? []).reduce(
    (sum, layer) => sum + (layer.children ? countLayers(layer.children) : 1),
    0,
  );
}

export function psdProperties(psd: Psd): PreviewProperty[] {
  const resources = psd.imageResources;
  const xmp: ImageFacts = {};
  if (resources?.xmpMetadata) readXmp(resources.xmpMetadata, xmp);
  const info = resources?.resolutionInfo;
  let resolution: string | undefined;
  if (info?.horizontalResolution) {
    const scale = (unit: string) => (unit === "PPCM" ? 2.54 : 1);
    const x = Math.round(
      info.horizontalResolution * scale(info.horizontalResolutionUnit),
    );
    const y = Math.round(
      (info.verticalResolution || info.horizontalResolution) *
        scale(info.verticalResolutionUnit),
    );
    resolution = x === y ? `${x} dpi` : `${x} × ${y} dpi`;
  }
  return new PropertyList()
    .text("title", xmp.title)
    .text("author", xmp.author)
    .number("layers", countLayers(psd.children) || undefined)
    .text(
      "colorMode",
      psd.colorMode === undefined ? undefined : PSD_COLOR_MODES[psd.colorMode],
    )
    .number("bitDepth", psd.bitsPerChannel)
    .text("resolution", resolution)
    .date("documentCreated", xmp.taken)
    .text("application", xmp.application ?? resources?.versionInfo?.writerName)
    .items;
}

export function paletteProperties(groups: SwatchGroup[]): PreviewProperty[] {
  const colors = groups.reduce((sum, group) => sum + group.swatches.length, 0);
  return new PropertyList().number("colors", colors).items;
}

export function fontProperties(info: FontInfo): PreviewProperty[] {
  return new PropertyList()
    .text("fontFamily", info.family ?? info.fullName)
    .text("fontStyle", info.style)
    .number("glyphs", info.glyphCount)
    .text("version", info.version)
    .text("author", info.designer).items;
}

export interface ModelStats {
  vertices: number;
  meshes: number;
  materials: number;
}

export function modelProperties(stats: ModelStats): PreviewProperty[] {
  return new PropertyList()
    .number("vertices", stats.vertices || undefined)
    .number("meshes", stats.meshes || undefined)
    .number("materials", stats.materials || undefined).items;
}

/** AutoCAD release names by `$ACADVER` code. */
const ACAD_VERSIONS: Record<string, string> = {
  AC1006: "AutoCAD R10",
  AC1009: "AutoCAD R11/R12",
  AC1012: "AutoCAD R13",
  AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000",
  AC1018: "AutoCAD 2004",
  AC1021: "AutoCAD 2007",
  AC1024: "AutoCAD 2010",
  AC1027: "AutoCAD 2013",
  AC1032: "AutoCAD 2018",
};

/** `$INSUNITS` codes as unit symbols, which read the same in every language. */
const INSERT_UNITS: Record<number, string> = {
  1: "in",
  2: "ft",
  3: "mi",
  4: "mm",
  5: "cm",
  6: "m",
  7: "km",
  8: "µin",
  9: "mil",
  10: "yd",
  11: "Å",
  12: "nm",
  13: "µm",
  14: "dm",
  15: "dam",
  16: "hm",
  17: "Gm",
  18: "AU",
  19: "ly",
  20: "pc",
};

export interface CadFacts {
  entityCount: number;
  layerCount: number;
  header?: Record<string, unknown>;
  units?: string;
}

function headerValue(
  header: Record<string, unknown> | undefined,
  name: string,
): unknown {
  return header?.[`$${name}`] ?? header?.[name];
}

export function cadProperties(facts: CadFacts): PreviewProperty[] {
  const header = facts.header;
  const version = headerValue(header, "ACADVER") ?? header?.dwgVersion;
  const code = typeof version === "string" ? version.trim() : undefined;
  const units = Number(headerValue(header, "INSUNITS"));
  return new PropertyList()
    .number("layers", facts.layerCount || undefined)
    .number("entities", facts.entityCount || undefined)
    .text("units", INSERT_UNITS[units] ?? facts.units)
    .text("version", code && (ACAD_VERSIONS[code] ?? code)).items;
}

export interface LayoutFacts {
  libraryName?: string;
  /** GDSII UNITS: a database unit in user units, and in metres. */
  userUnit?: number;
  databaseUnit?: number;
  layers: number;
  elements: number;
}

const METRIC_PREFIXES: [number, string][] = [
  [1, "m"],
  [1e-3, "mm"],
  [1e-6, "µm"],
  [1e-9, "nm"],
  [1e-12, "pm"],
];

/** A length in metres as "1 µm" or "0.5 nm". */
export function lengthUnit(metres: number | undefined): string | undefined {
  if (!metres || metres <= 0 || !Number.isFinite(metres)) return undefined;
  const [scale, symbol] =
    METRIC_PREFIXES.find(([scale]) => metres >= scale * 0.999) ??
    METRIC_PREFIXES[METRIC_PREFIXES.length - 1];
  return `${Number((metres / scale).toPrecision(4))} ${symbol}`;
}

export function layoutProperties(facts: LayoutFacts): PreviewProperty[] {
  return new PropertyList()
    .text("title", facts.libraryName)
    .number("layers", facts.layers || undefined)
    .number("entities", facts.elements || undefined)
    .text(
      "units",
      facts.databaseUnit && facts.userUnit
        ? lengthUnit(facts.databaseUnit / facts.userUnit)
        : undefined,
    ).items;
}

export function orcadProperties(streams: number): PreviewProperty[] {
  return new PropertyList().number("entries", streams || undefined).items;
}

export function geoProperties(features: GeoFeature[]): PreviewProperty[] {
  return new PropertyList()
    .number("features", features.length)
    .text(
      "geometry",
      countedKinds(
        features.flatMap((feature) =>
          feature.geometry ? [feature.geometry.type] : [],
        ),
      ),
    ).items;
}

/** Kinds and how often each occurs, most frequent first: "Point (3), Polygon". */
export function countedKinds(kinds: Iterable<string>): string | undefined {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  if (!counts.size) return undefined;
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => (counts.size > 1 ? `${kind} (${count})` : kind))
    .join(", ");
}

import type { Psd } from "ag-psd";
import { describe, expect, it } from "vitest";
import type { GeoFeature } from "@/lib/geo";
import {
  cadProperties,
  fontProperties,
  geoProperties,
  layoutProperties,
  lengthUnit,
  modelProperties,
  orcadProperties,
  paletteProperties,
  psdProperties,
  countedKinds,
} from "../assets";

describe("psdProperties", () => {
  it("counts layers inside groups and reads resolution and XMP", () => {
    const psd = {
      width: 10,
      height: 10,
      colorMode: 4,
      bitsPerChannel: 16,
      children: [{}, { children: [{}, {}] }],
      imageResources: {
        resolutionInfo: {
          horizontalResolution: 118.11,
          horizontalResolutionUnit: "PPCM",
          widthUnit: "Inches",
          verticalResolution: 118.11,
          verticalResolutionUnit: "PPCM",
          heightUnit: "Inches",
        },
        xmpMetadata:
          '<x xmp:CreatorTool="Adobe Photoshop 25.0" xmp:CreateDate="2024-02-03T04:05:06"/>',
      },
    } as unknown as Psd;
    expect(psdProperties(psd)).toEqual([
      { key: "layers", type: "number", value: 3 },
      { key: "colorMode", value: "CMYK" },
      { key: "bitDepth", type: "number", value: 16 },
      { key: "resolution", value: "300 dpi" },
      {
        key: "documentCreated",
        type: "date",
        value: new Date("2024-02-03T04:05:06").toISOString(),
      },
      { key: "application", value: "Adobe Photoshop 25.0" },
    ]);
  });
});

describe("paletteProperties", () => {
  it("counts swatches across groups", () => {
    const swatch = { css: "red", hex: "#ff0000", source: "RGB" };
    expect(
      paletteProperties([
        { swatches: [swatch, swatch] },
        { name: "B", swatches: [swatch] },
      ]),
    ).toEqual([{ key: "colors", type: "number", value: 3 }]);
  });
});

describe("fontProperties", () => {
  it("lists family, style, glyphs and version", () => {
    expect(
      fontProperties({
        family: "Pine Sans",
        style: "Bold",
        glyphCount: 812,
        version: "1.20",
        coversCjk: false,
      }),
    ).toEqual([
      { key: "fontFamily", value: "Pine Sans" },
      { key: "fontStyle", value: "Bold" },
      { key: "glyphs", type: "number", value: 812 },
      { key: "version", value: "1.20" },
    ]);
  });
});

describe("modelProperties", () => {
  it("leaves out zero counts", () => {
    expect(modelProperties({ vertices: 24, meshes: 1, materials: 0 })).toEqual([
      { key: "vertices", type: "number", value: 24 },
      { key: "meshes", type: "number", value: 1 },
    ]);
  });
});

describe("cadProperties", () => {
  it("reads DXF header variables", () => {
    expect(
      cadProperties({
        entityCount: 40,
        layerCount: 3,
        header: { $ACADVER: "AC1032", $INSUNITS: 4 },
      }),
    ).toEqual([
      { key: "layers", type: "number", value: 3 },
      { key: "entities", type: "number", value: 40 },
      { key: "units", value: "mm" },
      { key: "version", value: "AutoCAD 2018" },
    ]);
  });

  it("falls back to DWG header names and the document's units", () => {
    expect(
      cadProperties({
        entityCount: 0,
        layerCount: 1,
        header: { dwgVersion: "R2000", INSUNITS: 0 },
        units: "pt",
      }),
    ).toEqual([
      { key: "layers", type: "number", value: 1 },
      { key: "units", value: "pt" },
      { key: "version", value: "R2000" },
    ]);
  });
});

describe("layoutProperties", () => {
  it("shows the user unit of a GDSII library", () => {
    expect(
      layoutProperties({
        libraryName: "TOP",
        userUnit: 0.001,
        databaseUnit: 1e-9,
        layers: 4,
        elements: 120,
      }),
    ).toEqual([
      { key: "title", value: "TOP" },
      { key: "layers", type: "number", value: 4 },
      { key: "entities", type: "number", value: 120 },
      { key: "units", value: "1 µm" },
    ]);
  });

  it("formats lengths with metric prefixes", () => {
    expect(lengthUnit(1e-9)).toBe("1 nm");
    expect(lengthUnit(2.5e-4)).toBe("250 µm");
    expect(lengthUnit(0)).toBeUndefined();
  });

  it("counts OrCAD streams", () => {
    expect(orcadProperties(5)).toEqual([
      { key: "entries", type: "number", value: 5 },
    ]);
    expect(orcadProperties(0)).toEqual([]);
  });
});

describe("geoProperties", () => {
  it("counts features and their geometry types", () => {
    const feature = (type: string | undefined): GeoFeature => ({
      type: "Feature",
      geometry: type
        ? ({ type, coordinates: [0, 0] } as unknown as GeoFeature["geometry"])
        : null,
      properties: null,
    });
    expect(
      geoProperties([
        feature("Point"),
        feature("Polygon"),
        feature("Point"),
        feature(undefined),
      ]),
    ).toEqual([
      { key: "features", type: "number", value: 4 },
      { key: "geometry", value: "Point (2), Polygon (1)" },
    ]);
  });

  it("names a single geometry type without a count", () => {
    expect(countedKinds(["LineString", "LineString"])).toBe("LineString");
    expect(countedKinds([])).toBeUndefined();
  });
});

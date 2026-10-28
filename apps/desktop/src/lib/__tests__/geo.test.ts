import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { featureName, readGeo, renderGeoMap } from "../geo";

const encode = (text: string) => new TextEncoder().encode(text).buffer;
const palette = {
  background: "#fff",
  grid: "#eee",
  stroke: "#111",
  fill: "#888",
  highlight: "#00f",
  label: "#666",
  font: "sans-serif",
};
const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Pier</name><Point><coordinates>121.5,31.2</coordinates></Point></Placemark></Document></kml>`;

describe("readGeo", () => {
  it("reads GeoJSON collections, features and bare geometries", async () => {
    const features = await readGeo(
      encode(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { name: "A" },
              geometry: { type: "Point", coordinates: [1, 2] },
            },
          ],
        }),
      ),
      "geojson",
    );
    expect(features).toHaveLength(1);
    expect(featureName(features[0], 0)).toBe("A");
    const bare = await readGeo(
      encode('{"type":"LineString","coordinates":[[0,0],[1,1]]}'),
      "geojson",
    );
    expect(bare[0].geometry?.type).toBe("LineString");
    expect(featureName(bare[0], 4)).toBe("#5");
  });

  it("reads KML and the KML inside a KMZ", async () => {
    expect((await readGeo(encode(kml), "kml"))[0]?.properties?.name).toBe(
      "Pier",
    );
    const zip = new JSZip();
    zip.file("doc.kml", kml);
    const kmz = await zip.generateAsync({ type: "arraybuffer" });
    expect((await readGeo(kmz, "kmz"))[0]?.geometry?.type).toBe("Point");
  });
});

describe("renderGeoMap", () => {
  it("draws every geometry and highlights the selected feature", async () => {
    const features = await readGeo(
      encode(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [116.4, 39.9] },
            },
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [116, 39],
                    [117, 39],
                    [117, 40],
                    [116, 39],
                  ],
                ],
              },
            },
          ],
        }),
      ),
      "geojson",
    );
    const svg = new DOMParser().parseFromString(
      renderGeoMap(features, palette, 1),
      "image/svg+xml",
    ).documentElement;
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    const polygon = Array.from(svg.querySelectorAll("path")).find((path) =>
      path.getAttribute("d")?.endsWith("Z"),
    );
    expect(polygon?.getAttribute("stroke")).toBe("#00f");
  });

  it("rejects data without coordinates", () => {
    expect(() =>
      renderGeoMap(
        [{ type: "Feature", geometry: null, properties: null }],
        palette,
      ),
    ).toThrow();
  });
});

/**
 * Reads geodata into GeoJSON features and draws them as an SVG map. There
 * is no basemap (previews work offline); a graticule gives orientation.
 * Longitude/latitude data is shown in Web Mercator, projected data as is.
 */

type Position = number[];
type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint" | "LineString"; coordinates: Position[] }
  | { type: "MultiLineString" | "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

export interface GeoFeature {
  type: "Feature";
  geometry: Geometry | null;
  properties: Record<string, unknown> | null;
}

export async function readGeo(
  bytes: ArrayBuffer,
  extension: string,
): Promise<GeoFeature[]> {
  const text = () => new TextDecoder().decode(bytes);
  const xml = (source: string) => {
    const document = new DOMParser().parseFromString(source, "text/xml");
    if (document.querySelector("parsererror"))
      throw new Error("The file is not valid XML.");
    return document;
  };
  let collection: unknown;
  if (extension === "kml" || extension === "gpx") {
    const { kml, gpx } = await import("@tmcw/togeojson");
    collection = (extension === "kml" ? kml : gpx)(xml(text()));
  } else if (extension === "kmz") {
    const [{ default: JSZip }, { kml }] = await Promise.all([
      import("jszip"),
      import("@tmcw/togeojson"),
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const entry =
      zip.file("doc.kml") ??
      Object.values(zip.files).find((file) => file.name.endsWith(".kml"));
    if (!entry) throw new Error("The KMZ file has no KML document.");
    collection = kml(xml(await entry.async("string")));
  } else if (extension === "shp") {
    const { parseShp } = await import("shpjs");
    collection = {
      features: parseShp(bytes).map((geometry: Geometry) => ({
        type: "Feature",
        geometry,
        properties: null,
      })),
    };
  } else collection = JSON.parse(text()) as unknown;
  return features(collection);
}

function features(value: unknown): GeoFeature[] {
  if (!value || typeof value !== "object") return [];
  const record = value as {
    type?: string;
    features?: unknown[];
    geometry?: unknown;
  };
  if (Array.isArray(record.features))
    return record.features.flatMap((feature) => features(feature));
  if (record.type === "Feature")
    return [
      {
        type: "Feature",
        geometry: (record.geometry as Geometry | null) ?? null,
        properties:
          (record as { properties?: Record<string, unknown> }).properties ??
          null,
      },
    ];
  if (typeof record.type === "string")
    return [{ type: "Feature", geometry: value as Geometry, properties: null }];
  return [];
}

function positions(geometry: Geometry | null): Position[] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(positions);
  }
}

export function geometryKind(feature: GeoFeature): string {
  return feature.geometry?.type ?? "None";
}

/** A feature's display name from common property names. */
export function featureName(feature: GeoFeature, index: number): string {
  const properties = feature.properties ?? {};
  for (const key of ["name", "Name", "NAME", "title", "label", "id"]) {
    const value = properties[key];
    if (typeof value === "string" || typeof value === "number")
      return String(value);
  }
  return `#${index + 1}`;
}

export interface GeoPalette {
  background: string;
  grid: string;
  stroke: string;
  fill: string;
  highlight: string;
  label: string;
  font: string;
}

const SIZE = 1000;

export function renderGeoMap(
  list: GeoFeature[],
  palette: GeoPalette,
  selected?: number,
): string {
  const all = list.flatMap((feature) => positions(feature.geometry));
  if (!all.length) throw new Error("The file has no coordinates.");
  const geographic = all.every(
    ([x = 0, y = 0]) => Math.abs(x) <= 180 && Math.abs(y) <= 90,
  );
  const project = ([x = 0, y = 0]: Position): [number, number] => {
    if (!geographic) return [x, -y];
    const lat = Math.max(-85, Math.min(85, y));
    return [
      x,
      (-Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) /
        Math.PI,
    ];
  };
  const projected = all.map(project);
  let minX = Math.min(...projected.map(([x]) => x));
  let maxX = Math.max(...projected.map(([x]) => x));
  let minY = Math.min(...projected.map(([, y]) => y));
  let maxY = Math.max(...projected.map(([, y]) => y));
  // Points alone have no extent; give them room.
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  minX -= spanX * 0.08;
  maxX += spanX * 0.08;
  minY -= spanY * 0.08;
  maxY += spanY * 0.08;
  const scale = SIZE / Math.max(maxX - minX, maxY - minY);
  const width = Math.ceil((maxX - minX) * scale);
  const height = Math.ceil((maxY - minY) * scale);
  const point = (position: Position) => {
    const [x, y] = project(position);
    return `${((x - minX) * scale).toFixed(2)},${((y - minY) * scale).toFixed(2)}`;
  };
  const ring = (coordinates: Position[]) =>
    `M${coordinates.map(point).join("L")}Z`;
  const line = (coordinates: Position[]) =>
    `M${coordinates.map(point).join("L")}`;

  const parts: string[] = [];
  // A graticule at a round step for the extent, for orientation.
  if (geographic) {
    const extent = Math.max(maxX - minX, 1e-6);
    const step =
      [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30].find(
        (candidate) => extent / candidate <= 12,
      ) ?? 30;
    const lines: string[] = [];
    for (let lon = Math.ceil(minX / step) * step; lon <= maxX; lon += step)
      lines.push(`M${((lon - minX) * scale).toFixed(1)},0V${height}`);
    for (let lat = -85; lat <= 85; lat += step) {
      const [, y] = project([0, lat]);
      if (y < minY || y > maxY) continue;
      lines.push(`M0,${((y - minY) * scale).toFixed(1)}H${width}`);
    }
    parts.push(
      `<path d="${lines.join("")}" stroke="${palette.grid}" stroke-width="1" fill="none"/>`,
    );
  }

  list.forEach((feature, index) => {
    const active = index === selected;
    const stroke = active ? palette.highlight : palette.stroke;
    const draw = (geometry: Geometry | null): void => {
      if (!geometry) return;
      switch (geometry.type) {
        case "Point": {
          const [cx, cy] = point(geometry.coordinates).split(",");
          parts.push(
            `<circle cx="${cx}" cy="${cy}" r="${active ? 11 : 8}" fill="${stroke}" stroke="${palette.background}" stroke-width="3"/>`,
          );
          break;
        }
        case "MultiPoint":
          geometry.coordinates.forEach((coordinates) =>
            draw({ type: "Point", coordinates }),
          );
          break;
        case "LineString":
          parts.push(
            `<path d="${line(geometry.coordinates)}" fill="none" stroke="${stroke}" stroke-width="${active ? 6 : 4}" stroke-linejoin="round" stroke-linecap="round"/>`,
          );
          break;
        case "MultiLineString":
          geometry.coordinates.forEach((coordinates) =>
            draw({ type: "LineString", coordinates }),
          );
          break;
        case "Polygon":
          parts.push(
            `<path d="${geometry.coordinates.map(ring).join("")}" fill="${active ? palette.highlight : palette.fill}" fill-opacity="${active ? 0.35 : 0.22}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${active ? 4 : 2.5}" stroke-linejoin="round"/>`,
          );
          break;
        case "MultiPolygon":
          geometry.coordinates.forEach((coordinates) =>
            draw({ type: "Polygon", coordinates }),
          );
          break;
        case "GeometryCollection":
          geometry.geometries.forEach(draw);
      }
    };
    draw(feature.geometry);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${palette.background}"/>${parts.join("")}</svg>`;
}

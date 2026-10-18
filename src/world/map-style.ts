// Our own MapLibre style over OpenFreeMap's OpenMapTiles vector tiles (no key). Pikmin-Bloom-ish pastel diorama:
// paper ground, soft green parks, sky water, cream blocks, pale road bands. Deliberately NO symbol layers (no street
// names, POIs or shields) and no boundary layers. Every colour is a literal from src/pixel/tokens.css.
// Widths are CSS px at MapLibre zoom 16 (= the old Leaflet z17 follow scale, 512-px tiles); stops thin them out below.
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

export const TILE_JSON = "https://tiles.openfreemap.org/planet";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const ZONE_SOURCE = "zone";

const PAPER = "#FFF4D6";
const CREAM = "#FFE8B8";
const PATH = "#E9C38A";
const GRASS = "#7BC96F";
const SKY = "#8FD3FF";
const INK = "#2B2140";

const SRC = "openmaptiles";
const isLine: ExpressionSpecification = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const notTunnel: ExpressionSpecification = ["!=", ["get", "brunnel"], "tunnel"];
const cls = (...c: string[]): ExpressionSpecification => ["match", ["get", "class"], c, true, false];

/** Width at zoom 16 -> thinner stops below it (never under 1 px). */
function widthAt16(w: number, thin = 4): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 6, Math.max(1, w / thin / 2), 10, Math.max(1, w / thin), 13, Math.max(1, w / 2), 16, w];
}

const GREEN_CLASSES = ["grass", "wood", "forest", "scrub", "wetland"];
const GREEN_LANDUSE = ["park", "cemetery", "pitch", "playground", "garden", "golf_course", "grass", "village_green", "recreation_ground"];

export const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    [SRC]: { type: "vector", url: TILE_JSON },
    [ZONE_SOURCE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": PAPER } },

    // greens
    { id: "landcover-green", type: "fill", source: SRC, "source-layer": "landcover", filter: cls(...GREEN_CLASSES), paint: { "fill-color": GRASS, "fill-opacity": 0.55, "fill-antialias": false } },
    { id: "landuse-green", type: "fill", source: SRC, "source-layer": "landuse", filter: cls(...GREEN_LANDUSE), paint: { "fill-color": GRASS, "fill-opacity": 0.55, "fill-antialias": false } },
    { id: "park", type: "fill", source: SRC, "source-layer": "park", paint: { "fill-color": GRASS, "fill-opacity": 0.55, "fill-antialias": false } },

    // water
    { id: "water", type: "fill", source: SRC, "source-layer": "water", filter: ["all", ["!=", ["get", "brunnel"], "tunnel"]], paint: { "fill-color": SKY, "fill-antialias": false } },
    { id: "waterway", type: "line", source: SRC, "source-layer": "waterway", filter: isLine, paint: { "line-color": SKY, "line-width": widthAt16(4) } },

    // buildings: flat cream blocks with a 1-px path outline
    {
      id: "building",
      type: "fill",
      source: SRC,
      "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": CREAM, "fill-outline-color": PATH, "fill-antialias": false },
    },

    // rail: dashed pale line
    {
      id: "railway",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", isLine, cls("rail", "transit"), notTunnel],
      paint: { "line-color": PATH, "line-width": widthAt16(2), "line-dasharray": [3, 3] },
    },

    // roads: paths, then minor/service, then major (casing under inner), then motorway/trunk
    { id: "road-path", type: "line", source: SRC, "source-layer": "transportation", minzoom: 14, filter: ["all", isLine, cls("path", "pedestrian"), notTunnel], paint: { "line-color": CREAM, "line-width": widthAt16(2) } },
    {
      id: "road-minor",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", isLine, cls("minor", "service", "track", "busway", "raceway"), notTunnel],
      layout: { "line-cap": "butt", "line-join": "miter" },
      paint: { "line-color": PATH, "line-width": widthAt16(4) },
    },
    {
      id: "road-major-casing",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 8,
      filter: ["all", isLine, cls("primary", "secondary", "tertiary"), notTunnel],
      layout: { "line-cap": "butt", "line-join": "miter" },
      paint: { "line-color": CREAM, "line-width": widthAt16(10) },
    },
    {
      id: "road-major",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      minzoom: 8,
      filter: ["all", isLine, cls("primary", "secondary", "tertiary"), notTunnel],
      layout: { "line-cap": "butt", "line-join": "miter" },
      paint: { "line-color": PATH, "line-width": widthAt16(6) },
    },
    {
      id: "road-motorway-casing",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      filter: ["all", isLine, cls("motorway", "trunk"), notTunnel],
      layout: { "line-cap": "butt", "line-join": "miter" },
      paint: { "line-color": CREAM, "line-width": widthAt16(12) },
    },
    {
      id: "road-motorway",
      type: "line",
      source: SRC,
      "source-layer": "transportation",
      filter: ["all", isLine, cls("motorway", "trunk"), notTunnel],
      layout: { "line-cap": "butt", "line-join": "miter" },
      paint: { "line-color": PATH, "line-width": widthAt16(8) },
    },

    // my zone (City of Los Angeles): 4-px ink dashes over a faint grass wash; empty data unless zone view
    { id: "zone-fill", type: "fill", source: ZONE_SOURCE, paint: { "fill-color": GRASS, "fill-opacity": 0.25, "fill-antialias": false } },
    { id: "zone-line", type: "line", source: ZONE_SOURCE, layout: { "line-cap": "butt", "line-join": "miter" }, paint: { "line-color": INK, "line-width": 4, "line-dasharray": [2, 2] } },
  ],
};

// MapLibre's self-contained tile worker as raw source text (the project has no vite/client types).
declare module "maplibre-gl/dist/maplibre-gl-worker.mjs?raw" {
  const source: string;
  export default source;
}

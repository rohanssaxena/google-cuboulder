// MapLibre v6 resolves its worker relative to the bundle, which Next rewrites; serve it from /public instead.
import { copyFileSync } from "node:fs";
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");

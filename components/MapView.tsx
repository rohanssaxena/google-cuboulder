"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GridStats, Microgrid, NeighborhoodFeature, World } from "@/lib/sim";
import { colorExpr, fmtKw, pct, type Metric } from "@/lib/scale";

const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

// keep the city framed between the floating side columns; on narrow screens they stack below the map instead
const padding = () => {
  if (window.innerWidth < 1024) return 24;
  const left = document.querySelector(".col-left")?.getBoundingClientRect().right ?? 360;
  const right = document.querySelector(".col-right")?.getBoundingClientRect().left ?? window.innerWidth - 380;
  const bottom = document.querySelector(".bottom")?.getBoundingClientRect().top ?? window.innerHeight - 140;
  return { top: 110, bottom: window.innerHeight - bottom + 30, left: left + 40, right: window.innerWidth - right + 60 };
};

export type Theme = "dark" | "light";

interface Props {
  features: NeighborhoodFeature[];
  world: World;
  stats: Map<number, GridStats>;
  metric: Metric;
  theme: Theme;
  selectedId: number | null;
  hoverId: number | null;
  onSelect: (id: number | null) => void;
  onHover: (id: number | null, point?: { x: number; y: number }) => void;
}

function gridData(features: NeighborhoodFeature[], stats: Map<number, GridStats>, metric: Metric): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => {
      const s = stats.get(f.id);
      const v = s ? (metric === "flow" ? s.flowIdx : s.reserve) : 0;
      return { ...f, properties: { ...f.properties, v } } as GeoJSON.Feature;
    }),
  };
}

function batteryData(world: World): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: world.batteries.map((b, i) => ({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [b.lng, b.lat] },
      properties: { i, soc: b.soc, cap: b.capacity, kind: b.kind, offline: b.status === "offline" ? 1 : 0 },
    })),
  };
}

function labelData(grids: Microgrid[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: grids.map((g) => ({ type: "Feature", geometry: { type: "Point", coordinates: g.centroid }, properties: { name: g.name } })),
  };
}

export default function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const prevState = useRef<{ hover: number | null; selected: number | null }>({ hover: null, selected: null });
  const calloutRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // ---------- init ----------
  useEffect(() => {
    // resolved against the page so it also works when hosted under a subpath
    maplibregl.setWorkerUrl(new URL("maplibre-gl-worker.mjs", document.baseURI).href);
    const { features, theme } = latest.current;
    const all = new maplibregl.LngLatBounds();
    latest.current.world.grids.forEach((g) => all.extend(g.bounds[0]).extend(g.bounds[1]));

    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLES[theme],
      bounds: all,
      fitBoundsOptions: { padding: padding() },
      attributionControl: { compact: true },
      pitchWithRotate: false,
      maxPitch: 0,
    });
    mapRef.current = map;

    map.on("style.load", () => {
      const p = latest.current;
      const dark = p.theme === "dark";
      const beforeId = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;

      map.addSource("grids", { type: "geojson", data: gridData(features, p.stats, p.metric) });
      map.addSource("batteries", { type: "geojson", data: batteryData(p.world) });
      map.addSource("labels", { type: "geojson", data: labelData(p.world.grids) });

      map.addLayer(
        {
          id: "grid-fill",
          type: "fill",
          source: "grids",
          paint: {
            "fill-color": colorExpr("v"),
            // intensity tracks the value, and fades as you zoom in to the battery level
            "fill-opacity": [
              "interpolate", ["linear"], ["zoom"],
              10, ["+", dark ? 0.4 : 0.32, ["*", dark ? 0.4 : 0.42, ["get", "v"]]],
              13, ["+", 0.2, ["*", 0.25, ["get", "v"]]],
              15, 0.08,
            ],
            "fill-opacity-transition": { duration: 600 },
            "fill-color-transition": { duration: 600 },
          },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: "grid-line",
          type: "line",
          source: "grids",
          paint: { "line-color": dark ? "rgba(255,255,255,0.22)" : "rgba(20,24,30,0.28)", "line-width": 0.8 },
        },
        beforeId,
      );
      map.addLayer({
        id: "grid-glow",
        type: "line",
        source: "grids",
        paint: {
          "line-color": "#ff6a3d",
          "line-blur": 6,
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 10, 0],
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "grid-highlight",
        type: "line",
        source: "grids",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ff6a3d", dark ? "#ffffff" : "#111418"],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false], 2.4,
            ["boolean", ["feature-state", "hover"], false], 1.6,
            0,
          ],
        },
      });
      map.addLayer({
        id: "battery-dots",
        type: "circle",
        source: "batteries",
        minzoom: 12,
        paint: {
          "circle-color": ["case", ["==", ["get", "offline"], 1], dark ? "#5b6270" : "#a3a9b3", colorExpr("soc")],
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            12, ["case", ["==", ["get", "kind"], "commercial"], 3.5, 2],
            16, ["case", ["==", ["get", "kind"], "commercial"], 11, 6],
          ],
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 1.5],
          "circle-stroke-color": dark ? "rgba(10,12,16,0.9)" : "rgba(255,255,255,0.95)",
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 12.8, 1],
          "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 12.8, 1],
        },
      });
      map.addLayer({
        id: "grid-labels",
        type: "symbol",
        source: "labels",
        minzoom: 11.3,
        maxzoom: 13.5,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Montserrat Medium", "Open Sans Regular", "Noto Sans Regular"],
          "text-size": 11,
          "text-max-width": 8,
          "text-letter-spacing": 0.02,
        },
        paint: {
          "text-color": dark ? "rgba(255,255,255,0.8)" : "rgba(20,24,30,0.8)",
          "text-halo-color": dark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
          "text-halo-width": 1.2,
        },
      });

      // feature-state is wiped by setStyle; restore it
      prevState.current = { hover: null, selected: null };
      applyFeatureState(map, p.hoverId, p.selectedId);
    });

    map.on("mousemove", "grid-fill", (e) => {
      const id = e.features?.[0]?.id as number | undefined;
      latest.current.onHover(id ?? null, { x: e.point.x, y: e.point.y });
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "grid-fill", () => {
      latest.current.onHover(null);
      map.getCanvas().style.cursor = "";
    });

    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: ["battery-dots", "grid-fill"].filter((l) => map.getLayer(l)) });
      const dot = hits.find((h) => h.layer.id === "battery-dots");
      if (dot) {
        showBatteryPopup(dot.properties.i as number, e.lngLat);
        return;
      }
      const grid = hits.find((h) => h.layer.id === "grid-fill");
      latest.current.onSelect(grid ? (grid.id as number) : null);
    });

    function showBatteryPopup(i: number, at: maplibregl.LngLat) {
      const b = latest.current.world.batteries[i];
      popupRef.current?.remove();
      const el = document.createElement("div");
      el.className = "bpop";
      const status = b.status === "offline" ? "Offline" : b.status[0].toUpperCase() + b.status.slice(1);
      el.innerHTML = `
        <div class="bpop-kind">${b.kind === "commercial" ? "Business" : "Homeowner"} · ${b.id}</div>
        <div class="bpop-name"></div>
        <div class="bpop-row"><span class="bpop-big">${b.status === "offline" ? "—" : pct(b.soc)}</span><span class="bpop-unit">charged</span></div>
        <div class="bpop-bar"><i style="width:${Math.round(b.soc * 100)}%"></i></div>
        <div class="bpop-grid">
          <span>Capacity</span><b>${b.capacity} kWh</b>
          <span>Status</span><b>${status}</b>
          <span>Power</span><b>${b.power >= 0 ? "+" : "−"}${fmtKw(Math.abs(b.power))}</b>
        </div>`;
      el.querySelector(".bpop-name")!.textContent = b.owner;
      popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 12, className: "bpop-wrap", maxWidth: "260px" })
        .setLngLat(at)
        .setDOMContent(el)
        .addTo(map);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- theme ----------
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    mapRef.current?.setStyle(STYLES[props.theme], { diff: false });
  }, [props.theme]);

  // ---------- data ----------
  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("grids") as maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    src.setData(gridData(props.features, props.stats, props.metric));
    (map.getSource("batteries") as maplibregl.GeoJSONSource | undefined)?.setData(batteryData(props.world));
  }, [props.stats, props.metric, props.features, props.world]);

  // ---------- hover / selection ----------
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getSource("grids")) applyFeatureState(map, props.hoverId, props.selectedId);
  }, [props.hoverId, props.selectedId]);

  function applyFeatureState(map: maplibregl.Map, hover: number | null, selected: number | null) {
    const prev = prevState.current;
    if (prev.hover !== null && prev.hover !== hover) map.setFeatureState({ source: "grids", id: prev.hover }, { hover: false });
    if (prev.selected !== null && prev.selected !== selected) map.setFeatureState({ source: "grids", id: prev.selected }, { selected: false });
    if (hover !== null) map.setFeatureState({ source: "grids", id: hover }, { hover: true });
    if (selected !== null) map.setFeatureState({ source: "grids", id: selected }, { selected: true });
    prevState.current = { hover, selected };
  }

  // fly to the selected microgrid, or back out to the city
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { world } = latest.current;
    const grid = world.grids.find((g) => g.id === props.selectedId);
    if (grid) {
      map.fitBounds(grid.bounds, { padding: padding(), maxZoom: 14.2, duration: 1100 });
    } else {
      const all = new maplibregl.LngLatBounds();
      world.grids.forEach((g) => all.extend(g.bounds[0]).extend(g.bounds[1]));
      map.fitBounds(all, { padding: padding(), duration: 1100 });
    }
  }, [props.selectedId]);

  // dashed-underline callouts beside the selected microgrid, echoing the HUD style
  useEffect(() => {
    const map = mapRef.current;
    calloutRef.current?.remove();
    calloutRef.current = null;
    if (!map || props.selectedId === null) return;
    const grid = props.world.grids.find((g) => g.id === props.selectedId);
    const s = props.stats.get(props.selectedId);
    if (!grid || !s) return;
    const el = document.createElement("div");
    el.className = "callout";
    el.innerHTML = `
      <div class="callout-line"><span>Reserve</span><b>${pct(s.reserve)}</b></div>
      <div class="callout-line"><span>Circulating</span><b>${fmtKw(s.flowKw)}</b></div>
      <div class="callout-line"><span>Online</span><b>${s.batteries - s.offline} / ${s.batteries}</b></div>`;
    calloutRef.current = new maplibregl.Marker({ element: el, anchor: "left", offset: [24, 0] }).setLngLat([grid.bounds[1][0], grid.centroid[1]]).addTo(map);
  }, [props.selectedId, props.stats, props.world]);

  return <div ref={container} className="map" />;
}

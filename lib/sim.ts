// Mock telemetry engine: generates batteries inside each Denver neighborhood
// (one microgrid per neighborhood) and steps them through a simulated day.

export type BatteryKind = "residential" | "commercial";
export type BatteryStatus = "charging" | "discharging" | "idle" | "offline";

export interface Battery {
  id: string;
  gridId: number;
  lng: number;
  lat: number;
  kind: BatteryKind;
  owner: string;
  capacity: number; // kWh
  hasSolar: boolean; // batteries without rooftop solar only top up from the shared pool
  soc: number; // 0..1
  power: number; // kW, + charging, - discharging
  status: BatteryStatus;
}

export interface Microgrid {
  id: number;
  name: string;
  centroid: [number, number];
  bounds: [[number, number], [number, number]];
  solar: number; // relative solar penetration
  demand: number; // relative load
  batteryIdx: number[];
}

export interface GridStats {
  id: number;
  name: string;
  batteries: number;
  offline: number;
  low: number; // batteries under 15%
  residential: number;
  commercial: number;
  capacityKwh: number;
  storedKwh: number;
  reserve: number; // stored / capacity, 0..1
  chargingKw: number;
  dischargingKw: number;
  flowKw: number; // energy in circulation: total |power|
  flowIdx: number; // flow normalised against capacity, 0..1
}

export interface HistoryPoint {
  t: number; // sim epoch ms
  reserve: number;
  flowKw: number;
}

export interface Alert {
  id: string;
  gridId: number;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

type Ring = number[][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
export interface NeighborhoodFeature {
  type: "Feature";
  id: number;
  properties: { id: number; name: string };
  geometry: Geometry;
}

// ---------- helpers ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const polygons = (g: Geometry): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inGeometry(x: number, y: number, g: Geometry) {
  return polygons(g).some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)));
}

function ringArea(ring: Ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

// km² at Denver's latitude
const DEG2_TO_KM2 = 111.32 * 111.32 * Math.cos((39.74 * Math.PI) / 180);

const BIZ_A = ["Summit", "Platte", "Mile High", "Front Range", "Cherry Creek", "Aspen", "Red Rocks", "Union", "Colfax", "Sloan", "Larimer", "Federal"];
const BIZ_B = ["Market", "Clinic", "Brewing", "Logistics", "Library", "Elementary", "Studios", "Fitness", "Grocers", "Labs", "Fire Station", "Rec Center"];

export const SOC_LOW = 0.15;

// ---------- world ----------

export interface World {
  grids: Microgrid[];
  batteries: Battery[];
  rng: () => number;
  simTime: number;
  history: Map<number, HistoryPoint[]>;
  cityHistory: HistoryPoint[];
}

const HISTORY_STEP_MS = 30 * 60 * 1000;
const HISTORY_LEN = 48;

export function createWorld(features: NeighborhoodFeature[], now = Date.now()): World {
  const rng = mulberry32(20261021);
  const grids: Microgrid[] = [];
  const batteries: Battery[] = [];

  for (const f of features) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let area = 0, cx = 0, cy = 0;
    for (const [outer] of polygons(f.geometry)) {
      const a = ringArea(outer);
      area += a;
      let sx = 0, sy = 0;
      for (const [x, y] of outer) {
        sx += x; sy += y;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      cx += (sx / outer.length) * a;
      cy += (sy / outer.length) * a;
    }
    const km2 = area * DEG2_TO_KM2;
    const grid: Microgrid = {
      id: f.properties.id,
      name: f.properties.name,
      centroid: [cx / area, cy / area],
      bounds: [[minX, minY], [maxX, maxY]],
      // a few neighborhoods are deliberately stressed so the map has range
      solar: 0.35 + rng() * 0.9,
      demand: 0.6 + rng() * 0.8,
      batteryIdx: [],
    };
    const count = Math.round(Math.min(160, Math.max(24, km2 * 22 * (0.6 + rng() * 0.8))));
    const bizShare = 0.08 + rng() * 0.22;
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 60) {
      tries++;
      const x = minX + rng() * (maxX - minX);
      const y = minY + rng() * (maxY - minY);
      if (!inGeometry(x, y, f.geometry)) continue;
      const commercial = rng() < bizShare;
      const idx = batteries.length;
      batteries.push({
        id: `${grid.id}-${String(placed + 1).padStart(3, "0")}`,
        gridId: grid.id,
        lng: x,
        lat: y,
        kind: commercial ? "commercial" : "residential",
        owner: commercial
          ? `${BIZ_A[Math.floor(rng() * BIZ_A.length)]} ${BIZ_B[Math.floor(rng() * BIZ_B.length)]}`
          : `Residence ${String(Math.floor(rng() * 9000) + 1000)}`,
        capacity: commercial ? Math.round(60 + rng() * 440) : Math.round((10 + rng() * 17) * 2) / 2,
        hasSolar: rng() > 0.35,
        soc: Math.min(0.95, Math.max(0.05, 0.25 + rng() * 0.5)),
        power: 0,
        status: rng() < 0.015 ? "offline" : "idle",
      });
      grid.batteryIdx.push(idx);
      placed++;
    }
    grids.push(grid);
  }

  const world: World = { grids, batteries, rng, simTime: now - HISTORY_LEN * HISTORY_STEP_MS, history: new Map(), cityHistory: [] };

  // Warm up: run the previous 24h so the history charts and current state agree.
  const warmStep = 10 * 60 * 1000;
  let nextRecord = world.simTime;
  while (world.simTime < now) {
    stepWorld(world, warmStep);
    if (world.simTime >= nextRecord) {
      record(world, computeStats(world));
      nextRecord += HISTORY_STEP_MS;
    }
  }
  return world;
}

function hourOf(t: number) {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
}

const bump = (h: number, center: number, width: number) => Math.exp(-((h - center) ** 2) / (2 * width * width));

export function stepWorld(world: World, dtMs: number) {
  world.simTime += dtMs;
  const h = hourOf(world.simTime);
  const dtH = dtMs / 3_600_000;
  const sun = Math.max(0, Math.sin((Math.PI * (h - 6)) / 13));
  const load = 0.18 + 0.55 * bump(h, 19, 2.2) + 0.25 * bump(h, 7.5, 1.4);
  const { rng } = world;

  for (const grid of world.grids) {
    for (const i of grid.batteryIdx) {
      const b = world.batteries[i];
      if (b.status === "offline") {
        if (rng() < 0.08 * dtH) b.status = "idle"; // ~12h mean repair time
        b.power = 0;
        continue;
      }
      if (rng() < 0.001 * dtH) {
        b.status = "offline";
        b.power = 0;
        continue;
      }
      const kindLoad = b.kind === "commercial" ? (h > 8 && h < 18 ? 1.3 : 0.5) : 1;
      let frac = sun * grid.solar * (b.hasSolar ? 0.32 : 0.14) - load * grid.demand * kindLoad * 0.26 + (rng() - 0.5) * 0.08;
      if (b.soc >= 0.97 && frac > 0) frac = 0;
      if (b.soc <= 0.06 && frac < 0) frac = 0;
      b.power = frac * b.capacity;
      b.soc = Math.min(1, Math.max(0.03, b.soc + (b.power * dtH) / b.capacity));
      b.status = Math.abs(frac) < 0.015 ? "idle" : frac > 0 ? "charging" : "discharging";
    }
  }
}

export function computeStats(world: World): Map<number, GridStats> {
  const out = new Map<number, GridStats>();
  for (const g of world.grids) {
    const s: GridStats = {
      id: g.id, name: g.name, batteries: g.batteryIdx.length, offline: 0, low: 0, residential: 0, commercial: 0,
      capacityKwh: 0, storedKwh: 0, reserve: 0, chargingKw: 0, dischargingKw: 0, flowKw: 0, flowIdx: 0,
    };
    for (const i of g.batteryIdx) {
      const b = world.batteries[i];
      s[b.kind]++;
      if (b.status === "offline") { s.offline++; continue; }
      s.capacityKwh += b.capacity;
      s.storedKwh += b.capacity * b.soc;
      if (b.soc < SOC_LOW) s.low++;
      if (b.power > 0) s.chargingKw += b.power;
      else s.dischargingKw -= b.power;
    }
    s.reserve = s.capacityKwh ? s.storedKwh / s.capacityKwh : 0;
    s.flowKw = s.chargingKw + s.dischargingKw;
    // 25% of capacity per hour moving through the grid counts as fully circulating
    s.flowIdx = s.capacityKwh ? Math.min(1, s.flowKw / (s.capacityKwh * 0.25)) : 0;
    out.set(g.id, s);
  }
  return out;
}

export function cityTotals(stats: Map<number, GridStats>) {
  let cap = 0, stored = 0, flow = 0, charging = 0, discharging = 0, batteries = 0, offline = 0, low = 0;
  for (const s of stats.values()) {
    cap += s.capacityKwh; stored += s.storedKwh; flow += s.flowKw;
    charging += s.chargingKw; discharging += s.dischargingKw;
    batteries += s.batteries; offline += s.offline; low += s.low;
  }
  return { cap, stored, flow, charging, discharging, batteries, offline, low, reserve: cap ? stored / cap : 0, grids: stats.size };
}

export function record(world: World, stats: Map<number, GridStats>) {
  const push = (arr: HistoryPoint[], p: HistoryPoint) => {
    arr.push(p);
    if (arr.length > HISTORY_LEN) arr.shift();
  };
  for (const s of stats.values()) {
    let arr = world.history.get(s.id);
    if (!arr) world.history.set(s.id, (arr = []));
    push(arr, { t: world.simTime, reserve: s.reserve, flowKw: s.flowKw });
  }
  const c = cityTotals(stats);
  push(world.cityHistory, { t: world.simTime, reserve: c.reserve, flowKw: c.flow });
}

export function shouldRecord(world: World) {
  const last = world.cityHistory[world.cityHistory.length - 1];
  return !last || world.simTime - last.t >= HISTORY_STEP_MS;
}

export function buildAlerts(stats: Map<number, GridStats>): Alert[] {
  const alerts: Alert[] = [];
  for (const s of stats.values()) {
    if (s.reserve < 0.2) {
      alerts.push({ id: `res-${s.id}`, gridId: s.id, severity: "critical", title: `${s.name} reserve critical`, detail: `${Math.round(s.reserve * 100)}% stored · ${s.low} batteries under 15%` });
    } else if (s.reserve < 0.32) {
      alerts.push({ id: `res-${s.id}`, gridId: s.id, severity: "warning", title: `${s.name} reserve low`, detail: `${Math.round(s.reserve * 100)}% stored · ${s.low} batteries under 15%` });
    }
    if (s.offline >= 3) {
      alerts.push({ id: `off-${s.id}`, gridId: s.id, severity: s.offline >= 5 ? "warning" : "info", title: `${s.offline} batteries offline`, detail: `${s.name} · ${Math.round((s.offline / s.batteries) * 100)}% of fleet` });
    }
  }
  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

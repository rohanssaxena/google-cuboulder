import type { ExpressionSpecification } from "maplibre-gl";

// Shared orange → yellow → green scale. Orange = depleted / stagnant, green = full / circulating.
export const STOPS: [number, string][] = [
  [0, "#e8590c"],
  [0.25, "#ff8a3d"],
  [0.5, "#f5c542"],
  [0.75, "#9bd85a"],
  [1, "#2fbf71"],
];

function hex(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorAt(v: number) {
  const x = Math.min(1, Math.max(0, v));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    if (x <= p1) {
      const [p0, c0] = STOPS[i - 1];
      const t = (x - p0) / (p1 - p0);
      const a = hex(c0), b = hex(c1);
      return `rgb(${a.map((av, k) => Math.round(av + (b[k] - av) * t)).join(",")})`;
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const colorExpr = (prop: string) =>
  ["interpolate", ["linear"], ["get", prop], ...STOPS.flat()] as unknown as ExpressionSpecification;

export const GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `${c} ${p * 100}%`).join(", ")})`;

export type Metric = "flow" | "reserve";

export const fmtKw = (kw: number) => (kw >= 1000 ? `${(kw / 1000).toFixed(kw >= 10000 ? 1 : 2)} MW` : `${Math.round(kw)} kW`);
export const fmtKwh = (kwh: number) => (kwh >= 1000 ? `${(kwh / 1000).toFixed(kwh >= 10000 ? 1 : 2)} MWh` : `${Math.round(kwh)} kWh`);
export const pct = (v: number) => `${Math.round(v * 100)}%`;

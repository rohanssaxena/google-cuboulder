"use client";

import { useId, useState } from "react";

interface Props {
  points: { t: number; v: number }[];
  format: (v: number) => string;
  height?: number;
  domain?: [number, number];
  color?: string;
}

const W = 300;

// Single-series area with crosshair + tooltip; the current value carries a pinned badge.
export default function AreaChart({ points, format, height = 96, domain, color = "var(--accent)" }: Props) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <div style={{ height }} />;

  const vs = points.map((p) => p.v);
  const [lo, hi] = domain ?? [Math.min(...vs) * 0.9, Math.max(...vs) * 1.08 || 1];
  const padT = 26;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (height - padT - 4);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${W},${height}L0,${height}Z`;
  const active = hover ?? points.length - 1;
  const ap = points[active];
  const ax = x(active);
  const time = new Date(ap.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // ticks every 6 hours
  const ticks = points.map((p, i) => ({ i, d: new Date(p.t) })).filter(({ d }) => d.getMinutes() < 30 && d.getHours() % 6 === 0);

  return (
    <div className="area" style={{ height: height + 18 }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--chart-fill)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--chart-fill)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map(({ i }) => (
          <line key={i} x1={x(i)} x2={x(i)} y1={padT - 6} y2={height} className="area-grid" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={ax} x2={ax} y1={y(ap.v)} y2={height} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="area-dot" style={{ left: `${(ax / W) * 100}%`, top: y(ap.v), background: color }} />
      <span className="area-badge" style={{ left: `clamp(28px, ${(ax / W) * 100}%, calc(100% - 28px))` }}>
        {format(ap.v)}
        {hover !== null && <em>{time}</em>}
      </span>
      <div className="area-axis">
        {ticks.map(({ i, d }) => (
          <span key={i} style={{ left: `${(x(i) / W) * 100}%` }}>
            {d.toLocaleTimeString([], { hour: "numeric" })}
          </span>
        ))}
      </div>
    </div>
  );
}

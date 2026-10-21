"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAlerts, cityTotals, computeStats, createWorld, record, shouldRecord, stepWorld,
  type GridStats, type NeighborhoodFeature, type World,
} from "@/lib/sim";
import { colorAt, fmtKw, fmtKwh, GRADIENT_CSS, pct, type Metric } from "@/lib/scale";
import AreaChart from "./AreaChart";
import type { Theme } from "./MapView";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const SPEEDS = [1, 60, 600] as const;
const COL_DEFAULT = { left: 320, right: 340 };
const COL_MIN = 260;
const COL_MAX = 560;

export default function Dashboard() {
  const [features, setFeatures] = useState<NeighborhoodFeature[] | null>(null);
  const worldRef = useRef<World | null>(null);
  const [stats, setStats] = useState<Map<number, GridStats>>(new Map());
  const [metric, setMetric] = useState<Metric>("flow");
  const [theme, setTheme] = useState<Theme>("dark");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hover, setHover] = useState<{ id: number | null; x?: number; y?: number }>({ id: null });
  const [cols, setCols] = useState(COL_DEFAULT);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cols") ?? "null");
      if (saved?.left && saved?.right) setCols(saved);
    } catch {}
  }, []);
  const resizeCol = useCallback((side: "left" | "right", width: number | null, done = false) => {
    setCols((c) => {
      const next = { ...c, [side]: width === null ? COL_DEFAULT[side] : Math.round(Math.min(COL_MAX, Math.max(COL_MIN, width))) };
      if (done) try { localStorage.setItem("cols", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // theme: stored choice, else OS preference
  useEffect(() => {
    let t: Theme | null = null;
    try { t = localStorage.getItem("theme") as Theme | null; } catch {}
    setTheme(t ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    fetch("/data/denver-neighborhoods.json")
      .then((r) => r.json())
      .then((fc: { features: NeighborhoodFeature[] }) => {
        worldRef.current = createWorld(fc.features);
        setStats(computeStats(worldRef.current));
        setFeatures(fc.features);
      });
  }, []);

  // live tick: one real second advances `speed` simulated seconds
  useEffect(() => {
    if (paused || !features) return;
    const timer = setInterval(() => {
      const w = worldRef.current!;
      let remaining = speed * 1000;
      while (remaining > 0) {
        const dt = Math.min(remaining, 10 * 60 * 1000);
        stepWorld(w, dt);
        remaining -= dt;
      }
      const s = computeStats(w);
      if (shouldRecord(w)) record(w, s);
      setStats(s);
    }, 1000);
    return () => clearInterval(timer);
  }, [paused, speed, features]);

  const onHover = useCallback((id: number | null, p?: { x: number; y: number }) => setHover({ id, ...p }), []);

  const world = worldRef.current;
  const city = useMemo(() => cityTotals(stats), [stats]);
  const alerts = useMemo(() => buildAlerts(stats), [stats]);
  const selected = selectedId !== null ? stats.get(selectedId) : undefined;

  return (
    <div className="app" style={{ "--left-w": `${cols.left}px`, "--right-w": `${cols.right}px` } as React.CSSProperties}>
      {features && world && (
        <MapView
          features={features}
          world={world}
          stats={stats}
          metric={metric}
          theme={theme}
          selectedId={selectedId}
          hoverId={hover.id}
          onSelect={setSelectedId}
          onHover={onHover}
        />
      )}
      <div className="atmo" />

      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Gridwatch</span>
          <span className="brand-sep" />
          <span className="brand-sub">Denver microgrids</span>
          <span className="brand-sep" />
          <span className={`live ${paused ? "is-paused" : ""}`}>
            <i />
            {world ? new Date(world.simTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
          </span>
        </div>

        <div className="seg" role="tablist" aria-label="Map metric">
          <button className={metric === "flow" ? "on" : ""} onClick={() => setMetric("flow")}>Energy in circulation</button>
          <button className={metric === "reserve" ? "on" : ""} onClick={() => setMetric("reserve")}>Battery reserve</button>
        </div>

        <div className="actions">
          <div className="seg seg-sm" aria-label="Simulation speed">
            {SPEEDS.map((s) => (
              <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
          </div>
          <button className="icon-btn" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="pill-btn" onClick={() => setPaused(!paused)}>
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? "Resume" : "Pause feed"}
          </button>
        </div>
      </header>

      <aside className="col col-left">
        <Resizer side="left" width={cols.left} onResize={resizeCol} />
        <GridList stats={stats} selectedId={selectedId} hoverId={hover.id} onPick={setSelectedId} onHover={(id) => setHover({ id })} />

        <section className="card card-grow card-alerts">
          <div className="card-head">
            <h2>Alerts</h2>
            <span className={`chip ${alerts.some((a) => a.severity === "critical") ? "chip-crit" : ""}`}>{alerts.length}</span>
          </div>
          <div className="alerts">
            {alerts.length === 0 && <p className="muted">All microgrids within normal range.</p>}
            {alerts.slice(0, 12).map((a) => (
              <button key={a.id} className={`alert sev-${a.severity}`} onClick={() => setSelectedId(a.gridId)}>
                <SevIcon severity={a.severity} />
                <span className="alert-text">
                  <b>{a.title}</b>
                  <span>{a.detail}</span>
                </span>
                <span className="sev-label">{a.severity}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <aside className="col col-right">
        <Resizer side="right" width={cols.right} onResize={resizeCol} />
        {selected && world ? <GridDetail s={selected} world={world} onClose={() => setSelectedId(null)} /> : <div className="col-spacer" />}
        <section className="card">
          <div className="card-head">
            <h2>Citywide reserve · 24h</h2>
          </div>
          {world && <AreaChart points={world.cityHistory.map((p) => ({ t: p.t, v: p.reserve }))} format={pct} domain={[0, 1]} height={selected ? 64 : 96} />}
          <p className="note"><InfoIcon /> {trendNote(world)}</p>
        </section>
      </aside>

      <footer className="bottom">
        <Stat value={fmtKw(city.flow)} label="In circulation" delta={delta(world, "flowKw")} />
        <Stat value={fmtKwh(city.stored)} label="Stored" sub={`of ${fmtKwh(city.cap)}`} delta={delta(world, "reserve")} />
        <Stat value={pct(city.reserve)} label="Avg. reserve" bar={city.reserve} />
        <Stat value={(city.batteries - city.offline).toLocaleString()} label="Batteries online" sub={`${city.offline} offline · ${city.low} low`} />
        <Stat value={fmtKw(city.charging)} label="Charging" />
        <Stat value={fmtKw(city.discharging)} label="Discharging" />
        <section className="card stat stat-legend">
          <span className="stat-label">{metric === "flow" ? "Energy in circulation" : "Battery reserve"}</span>
          <i style={{ background: GRADIENT_CSS }} />
          <span className="stat-scale"><span>{metric === "flow" ? "Stagnant" : "Depleted"}</span><span>{metric === "flow" ? "Circulating" : "Full"}</span></span>
        </section>
      </footer>

      {hover.id !== null && hover.x !== undefined && stats.get(hover.id) && (
        <MapTooltip s={stats.get(hover.id)!} metric={metric} x={hover.x} y={hover.y!} />
      )}
      {!features && <div className="loading">Loading microgrid telemetry…</div>}
    </div>
  );
}

// ---------- pieces ----------

// Drag the inner edge of a side column to resize it; double-click to reset.
function Resizer({ side, width, onResize }: { side: "left" | "right"; width: number; onResize: (side: "left" | "right", w: number | null, done?: boolean) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`resizer ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      onDoubleClick={() => onResize(side, null, true)}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        document.body.classList.add("resizing");
        const widthAt = (x: number) => width + (side === "left" ? x - startX : startX - x);
        const move = (ev: PointerEvent) => onResize(side, widthAt(ev.clientX));
        const up = (ev: PointerEvent) => {
          onResize(side, widthAt(ev.clientX), true);
          setDragging(false);
          document.body.classList.remove("resizing");
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
    />
  );
}

function delta(world: World | null, key: "flowKw" | "reserve") {
  const h = world?.cityHistory;
  if (!h || h.length < 3) return undefined;
  const now = h[h.length - 1][key], prev = h[h.length - 3][key];
  return prev ? (now - prev) / prev : undefined;
}

function trendNote(world: World | null) {
  const h = world?.cityHistory;
  if (!h || h.length < 3) return "Collecting history…";
  const d = h[h.length - 1].reserve - h[h.length - 3].reserve;
  if (Math.abs(d) < 0.01) return "Reserve holding steady over the last hour";
  return `Reserve ${d > 0 ? "rose" : "fell"} ${Math.abs(Math.round(d * 100))} pts in the last hour`;
}

function Stat({ value, label, sub, delta, bar }: { value: string; label: string; sub?: string; delta?: number; bar?: number }) {
  return (
    <section className="card stat">
      <span className="stat-label">
        {label}
        {delta !== undefined && (
          <span className={`kpi-delta ${delta >= 0 ? "up" : "down"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}%
          </span>
        )}
      </span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
      {bar !== undefined && (
        <span className="kpi-bar stat-bar"><i style={{ width: pct(bar), background: colorAt(bar) }} /></span>
      )}
    </section>
  );
}

function BatteryIcon({ level }: { level: number }) {
  const w = Math.max(1.5, 19 * Math.min(1, Math.max(0, level)));
  return (
    <svg className="batt" width="28" height="14" viewBox="0 0 28 14" aria-hidden>
      <rect x="0.75" y="0.75" width="23.5" height="12.5" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="25.5" y="4.5" width="2" height="5" rx="1" fill="currentColor" />
      <rect x="3" y="3" width={w} height="8" rx="1.5" fill={colorAt(level)} />
    </svg>
  );
}

function GridList({ stats, selectedId, hoverId, onPick, onHover }: {
  stats: Map<number, GridStats>; selectedId: number | null; hoverId: number | null;
  onPick: (id: number) => void; onHover: (id: number | null) => void;
}) {
  const [sort, setSort] = useState<"reserve" | "name">("reserve");
  const listRef = useRef<HTMLDivElement>(null);
  const rows = [...stats.values()].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a.reserve - b.reserve));

  useEffect(() => {
    listRef.current?.querySelector(".glist-row.sel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <section className="card card-grow card-list">
      <div className="card-head">
        <h2>Microgrids <span className="chip">{stats.size}</span></h2>
        <div className="seg seg-xs" aria-label="Sort microgrids">
          <button className={sort === "reserve" ? "on" : ""} onClick={() => setSort("reserve")}>Reserve</button>
          <button className={sort === "name" ? "on" : ""} onClick={() => setSort("name")}>A–Z</button>
        </div>
      </div>
      <div className="glist" ref={listRef} onMouseLeave={() => onHover(null)}>
        {rows.map((s) => (
          <button
            key={s.id}
            className={`glist-row ${selectedId === s.id ? "sel" : ""} ${hoverId === s.id ? "hov" : ""}`}
            onClick={() => onPick(s.id)}
            onMouseEnter={() => onHover(s.id)}
          >
            <BatteryIcon level={s.reserve} />
            <span className="glist-text">
              <b>{s.name}</b>
              <span>{fmtKw(s.flowKw)} circulating</span>
            </span>
            <span className="glist-pct">{pct(s.reserve)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function GridDetail({ s, world, onClose }: { s: GridStats; world: World; onClose: () => void }) {
  const hist = world.history.get(s.id) ?? [];
  const grid = world.grids.find((g) => g.id === s.id)!;
  const bats = grid.batteryIdx.map((i) => world.batteries[i]);
  const sorted = [...bats].sort((a, b) => (a.status === "offline" ? 1 : 0) - (b.status === "offline" ? 1 : 0) || a.soc - b.soc);
  // distribution of state of charge, ten buckets
  const buckets = Array.from({ length: 10 }, () => 0);
  bats.forEach((b) => b.status !== "offline" && buckets[Math.min(9, Math.floor(b.soc * 10))]++);
  const maxB = Math.max(...buckets, 1);
  const resKwh = bats.filter((b) => b.kind === "residential").reduce((a, b) => a + b.capacity, 0);
  const comKwh = bats.filter((b) => b.kind === "commercial").reduce((a, b) => a + b.capacity, 0);

  return (
    <section className="card card-grow detail">
      <div className="card-head">
        <div>
          <span className="eyebrow">Microgrid #{s.id}</span>
          <h2 className="detail-title">{s.name}</h2>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      <div className="detail-stats">
        <div><span className="big" style={{ color: colorAt(s.reserve) }}>{pct(s.reserve)}</span><span>reserve</span></div>
        <div><span className="big">{fmtKw(s.flowKw)}</span><span>circulating</span></div>
        <div><span className="big">{fmtKwh(s.storedKwh)}</span><span>stored</span></div>
      </div>

      <h3>Reserve · 24h</h3>
      <AreaChart points={hist.map((p) => ({ t: p.t, v: p.reserve }))} format={pct} domain={[0, 1]} height={80} />

      <h3>State of charge distribution</h3>
      <div className="dist">
        {buckets.map((n, i) => (
          <div key={i} className="dist-col" title={`${i * 10}–${i * 10 + 10}%: ${n} batteries`}>
            <i style={{ height: `${(n / maxB) * 100}%`, background: colorAt((i + 0.5) / 10) }} />
            <span>{n}</span>
          </div>
        ))}
      </div>
      <div className="dist-axis"><span>0%</span><span>50%</span><span>100%</span></div>

      <h3>Fleet mix</h3>
      <div className="mix">
        <i className="mix-res" style={{ flex: resKwh }} />
        <i className="mix-com" style={{ flex: comKwh }} />
      </div>
      <div className="mix-legend">
        <span><i className="mix-res" /> Homeowners · {s.residential} · {fmtKwh(resKwh)}</span>
        <span><i className="mix-com" /> Businesses · {s.commercial} · {fmtKwh(comKwh)}</span>
      </div>

      <h3>Lowest batteries <em>{s.low} under 15% · {s.offline} offline</em></h3>
      <div className="blist">
        {sorted.slice(0, 8).map((b) => (
          <div key={b.id} className="brow">
            <span className={`bkind ${b.kind}`}>{b.kind === "commercial" ? "B" : "H"}</span>
            <span className="brow-text"><b>{b.owner}</b><span>{b.capacity} kWh · {b.status}</span></span>
            <span className="brow-soc">
              <span className="kpi-bar"><i style={{ width: pct(b.soc), background: b.status === "offline" ? "var(--muted)" : colorAt(b.soc) }} /></span>
              {b.status === "offline" ? "—" : pct(b.soc)}
            </span>
          </div>
        ))}
      </div>
      <p className="note"><InfoIcon /> Zoom in on the map to see every battery.</p>
    </section>
  );
}

function MapTooltip({ s, metric, x, y }: { s: GridStats; metric: Metric; x: number; y: number }) {
  const v = metric === "flow" ? s.flowIdx : s.reserve;
  return (
    <div className="tooltip" style={{ transform: `translate(${x + 16}px, ${y + 16}px)` }}>
      <div className="tooltip-head"><span className="rank-swatch" style={{ background: colorAt(v) }} /><b>{s.name}</b></div>
      <div className="tooltip-grid">
        <span>Circulating</span><b>{fmtKw(s.flowKw)}</b>
        <span>Reserve</span><b>{pct(s.reserve)}</b>
        <span>Stored</span><b>{fmtKwh(s.storedKwh)}</b>
        <span>Batteries</span><b>{s.batteries - s.offline} / {s.batteries}</b>
      </div>
    </div>
  );
}

// ---------- icons ----------

const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 2.5 20.5 7.2v9.6L12 21.5 3.5 16.8V7.2L12 2.5Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13 6.5 8.5 13h3l-1 4.5L15.5 11h-3l.5-4.5Z" fill="var(--accent)" />
  </svg>
);
const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
);
const PauseIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="1" y="1" width="10" height="10" rx="2.5" fill="currentColor" /></svg>;
const PlayIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 1.5v9l8-4.5-8-4.5Z" fill="currentColor" /></svg>;
const InfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M12 11v6M12 7.5v.5" stroke="var(--panel-solid)" strokeWidth="2.2" strokeLinecap="round" /></svg>
);
function SevIcon({ severity }: { severity: "critical" | "warning" | "info" }) {
  if (severity === "critical")
    return <svg className="sev-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden><path d="M12 3 22 20H2L12 3Z" fill="currentColor" /><path d="M12 10v4M12 17v.5" stroke="var(--panel-solid)" strokeWidth="2.2" strokeLinecap="round" /></svg>;
  if (severity === "warning")
    return <svg className="sev-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="M12 7v6M12 16.5v.5" stroke="var(--panel-solid)" strokeWidth="2.2" strokeLinecap="round" /></svg>;
  return <svg className="sev-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 11v6M12 7.5v.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}

# Verification — Mobile-First Responsive Gridwatch Dashboard

## Environment / API confirmation
- Stack: Next.js 16.4.2 (Turbopack), React 19.3.0, App Router. Read the local docs at
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md`.
- Confirmed the current API: viewport is configured via a `viewport` export (type `Viewport` from `next`),
  NOT a manual `<meta>` tag. Server Components only — `app/layout.tsx` is a Server Component, so the
  export is valid there.
- Added `export const viewport: Viewport = { width: "device-width", initialScale: 1 }`.
  Deliberately did NOT set `maximumScale` / `userScalable` so pinch-zoom (accessibility) is preserved.

## What I ran
1. `npm run build` (includes `prebuild` -> `scripts/copy-worker.mjs`):
   - Result: SUCCESS, run twice (initial implementation, then again after the Summary-tab follow-up).
     "Compiled successfully", TypeScript finished with no errors, static pages generated both times.
   - No type or lint errors introduced by the changes.
2. Dev server was already running on http://localhost:3000.
   - `curl -s http://localhost:3000 | grep '<meta name="viewport"'` returned:
     `<meta name="viewport" content="width=device-width, initial-scale=1"/>`
     -> confirms the viewport config reaches the rendered `<head>`.
3. Browser-screenshot tooling: NONE installed (no chromium/chrome on PATH; no playwright/puppeteer/cypress
   in node_modules). Installing Playwright would add a heavy dependency, which the task forbids, so I did
   NOT capture pixel screenshots. Verification below is via compiled CSS/markup + the structural guarantees
   of the layout, plus a manual checklist for a reviewer with a browser.

## Code-level verification (what guarantees the requirements)

### Breakpoints (req 1)
- `globals.css`: the mobile layout now triggers at `@media (max-width: 1023px)` (raised from the old 860px),
  so desktop's resizable 3-column grid applies only at `>= 1024px`. A phone-specific
  `@media (max-width: 640px)` block adds the scrolling stat strip and tighter spacing.
- Drag-resize disabled on small/touch screens TWO ways:
  - JS: `Dashboard.tsx` computes `isDesktop = useMediaQuery("(min-width: 1024px)")` and only renders
    `<Resizer>` when `isDesktop`, so no pointer handlers mount below 1024px.
  - CSS: `.resizer { display: none }` inside the `<=1023px` block as defense-in-depth.
- `MapView.tsx` `padding()` threshold bumped 860 -> 1024 to match, so `fitBounds` uses simple mobile padding
  whenever the stacked layout is active.

### Mobile layout prioritizes map + key controls (req 2)
- `.app` becomes `display:flex; flex-direction:column`; `.app .map` is `position:relative; height:56vh`
  (52vh on phones) with `order:1` -> map sits prominently on top.
- Compact header: `.topbar` wraps; metric toggle (`.seg`), speed (`.seg-sm`), theme (`.icon-btn`), and
  pause (`.pill-btn`) reflow into full-width rows with no horizontal overflow.
- Summary / Grids / Alerts / Details are a segmented tab bar (`.mobile-tabs`) over `.mobile-panel`.
  The SAME `Stat` cards, `GridList`, alerts `<section>`, `GridDetail`, and citywide `AreaChart` instances
  render — only their container/visibility changes (no duplicated logic). Default tab is Summary.
  Selecting a grid auto-switches to the Details tab; the Details tab is `disabled` when nothing is
  selected. Citywide chart lives under Details (alongside a selected grid's detail).

### Citywide stats moved into a Summary tab on mobile (follow-up requirement)
- The separate always-visible bottom stats strip (`<footer class="bottom">`) now renders ONLY on desktop:
  JSX gates it with `{isDesktop && <footer className="bottom">{statCards}</footer>}`.
- On mobile the identical `statCards` (In circulation, Stored, Avg. reserve, Batteries online, Charging,
  Discharging, and the gradient legend) render inside the new "Summary" tab via
  `<div className="mobile-stats">{statCards}</div>`. `statCards` is defined once at component scope and
  shared by both, so there is no logic duplication.
- `.mobile-stats` is a readable VERTICAL grid (`repeat(2, minmax(0,1fr))`, legend spans full width) — NOT a
  horizontal scroll. No horizontal page overflow at 375px.
- Tab order is Summary / Grids / Alerts / Details. At `<=640px` the tab buttons use reduced padding
  (`11px 6px`, 12px font) so all four labels fit within 375px without overflow; buttons stay `>=44px` tall.
- Desktop bottom strip and desktop layout are unchanged.
- Note on SSR: the `useMediaQuery` hook returns `false` on first render, so the server-rendered HTML is the
  mobile layout (Summary tab, no `.bottom` footer); the desktop 3-column layout + bottom strip appear after
  client hydration. This matches the existing `isDesktop` gating of the columns and avoids hydration
  mismatch. Verified via `curl http://localhost:3000`: `Summary`, `mobile-tabs`, and `mobile-stats` present;
  `class="bottom"` absent in the initial (mobile-first) HTML.

### Tap targets / legibility (req 4)
- `.seg button`, `.mobile-tabs button`, `.icon-btn` (44x44), `.pill-btn` (44h) all >= 44px tall on mobile.
- `.seg-sm` speed buttons >= 40px.

### Functionality preserved (req 5)
- Metric toggle, speed (1x/60x/600x), pause/resume, theme toggle, neighborhood selection + fly-to,
  battery popups, citywide reserve chart, alerts click-to-select, microgrids list + Reserve/A-Z sort:
  all rendered from the same components/state; only layout containers changed.
- Hover tooltip (`MapTooltip`) is mouse-driven; on touch there is no mousemove, so it simply doesn't appear.
  Tap-to-select (map `click` handler + GridList row `onClick`) + the Details tab convey the same data, so
  hover degrades gracefully to tap. No interaction depends solely on hover.

### Desktop unchanged (req 6)
- All `>= 1024px` rules are untouched; desktop renders the original `.col-left` / `.col-right` asides with
  working `<Resizer>` drag + `localStorage("cols")` persistence. Responsive behavior is strictly additive.

## Manual checklist for a reviewer with a browser (DevTools device toolbar)
Open http://localhost:3000.
- 1440 wide: three-column resizable layout, drag handles work, absolute map behind floating panels —
  identical to before.
- 375x812 (iPhone): map prominent on top; header controls wrap with no horizontal overflow; the four tabs
  Summary/Grids/Alerts/Details fit in the tab bar with no overflow and switch content; the Summary tab shows
  all 7 citywide stats in a readable vertical grid (NOT a horizontal scroll) with no separate bottom strip;
  tap a microgrid in Grids -> it selects on the map and auto-opens Details; NO horizontal PAGE scroll
  (`document.documentElement.scrollWidth <= window.innerWidth`); buttons measure >= 44px tall.
- 768 (tablet): single-column mobile layout (not a cramped 2/3-column squeeze).
- Verify metric toggle, speed, pause, theme, sort toggle (Reserve/A-Z), alerts click-to-select, battery
  popups (zoom in then tap a dot), and the citywide chart all still work.

## Constraints honored
- `lib/sim.ts` and `lib/scale.ts` NOT modified.
- Changes scoped to `app/layout.tsx`, `app/globals.css`, `components/Dashboard.tsx`, `components/MapView.tsx`.
- No new dependencies added (plain CSS media queries + a tiny `useMediaQuery` hook using existing React state).
- `AGENTS.md` auto-generated block left untouched.
- No temporary files created (this note is the only added file, under .agents/tasks/).

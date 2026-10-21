# Implementation Plan — Mobile-First Responsive Gridwatch Dashboard

## Context & key findings (from reading the repo)

- **Stack:** Next.js `16.4.2` + Turbopack, React `19.3.0`, MapLibre GL `^6.15.0`. App Router. Scripts: `npm run dev` (`next dev`), `npm run build` (`next build`). A `predev`/`prebuild` step copies the maplibre worker (`scripts/copy-worker.mjs`).
- **Layout today (`components/Dashboard.tsx`, 435 lines):** `.app` is a CSS grid `grid-template-columns: var(--left-w,320px) 1fr var(--right-w,340px)` with rows `auto 1fr auto` (topbar / columns+map / bottom stats). The map is `position:absolute; inset:0` behind floating panels. Left column = Microgrids list + Alerts; right column = GridDetail (when a grid is selected) + Citywide reserve chart; bottom = 7-item stat strip. Column widths persist to `localStorage("cols")`; `COL_DEFAULT {left:320,right:340}`, `COL_MIN 260`, `COL_MAX 560`. The `<Resizer>` component attaches `pointerdown`/`pointermove` handlers for drag-resize.
- **Styling (`app/globals.css`, 322 lines):** All layout lives here via CSS variables + classes. There are ALREADY two responsive breakpoints: `@media (max-width:1180px)` (tighter padding, 4-col bottom) and `@media (max-width:860px)` (switches `.app` to `display:flex; flex-direction:column`, map becomes `position:relative; height:62vh`, columns stack via `order`, `.resizer{display:none}`, 2-col bottom grid). This existing 860px block is the "squeezed desktop" the user is unhappy with — it is the baseline we improve, not a clean mobile layout.
- **Map (`components/MapView.tsx`, 320 lines):** client-only via `next/dynamic` `ssr:false`. `padding()` already branches on `window.innerWidth < 860` (returns `24` on narrow screens, else computes padding from `.col-left`/`.col-right`/`.bottom` rects). Map tap/click already opens battery popups and selects grids; the hover tooltip (`MapTooltip`) is driven by MapLibre `mousemove` — on touch devices there is no mousemove, so tap-to-select already degrades gracefully. `fitBounds` uses `padding()`.
- **Viewport:** `app/layout.tsx` is a Server Component and currently exports `metadata` but **no `viewport`**. Per the LOCAL docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md`): export a static `viewport: Viewport` object from `layout.tsx`/`page.tsx` (supported in Server Components only). The viewport meta tag is auto-set by default; the doc explicitly notes manual config is usually unnecessary. We will set only `width: 'device-width', initialScale: 1`. **Do NOT set `maximumScale`/`userScalable:false`** — that blocks pinch-zoom and is an accessibility regression (task requires legible/accessible mobile).
- **Repo rules:** `AGENTS.md` only contains the auto-generated `<!-- BEGIN:nextjs-agent-rules -->` block — **do not remove or hand-edit it**; `next dev` re-adds it. No `.kiro/steering`, no README/CONTRIBUTING. No test framework is configured (no test deps/scripts). Current git branch: `main`.
- **Do NOT touch** `lib/sim.ts` or `lib/scale.ts` (simulation/scale logic). Changes stay in the presentation layer: `app/layout.tsx`, `app/globals.css`, `components/Dashboard.tsx`, and `components/MapView.tsx` (only for mobile map sizing/padding).

## Design decisions (chosen approach + rationale)

1. **Breakpoint strategy — three tiers, CSS-first with a thin JS hook.**
   - **Desktop `>= 1024px`:** keep today's resizable three-column grid exactly as-is (task 6: desktop look must not change). Raise the current `860px` flex-stack threshold to `1024px` so the real mobile layout kicks in earlier and we never show a cramped two/three-column squeeze on tablets/phones.
   - **Tablet/mobile `<= 1023px`:** single-column flow — map on top, a compact control row, and a **tabbed panel** (segmented control) for Microgrids / Alerts / Detail + the citywide chart, so panels are not stacked into cramped side columns.
   - **Phone `<= 640px` (covers 375px):** tighten spacing, make the stat strip a horizontal scroll row, ensure ≥44px tap targets, prevent any horizontal page scroll.
   - *Rationale:* The project already styles everything with CSS media queries and uses plain React state; a CSS-first approach is additive and matches the house style with no new deps. A tiny `useMediaQuery` hook is needed only where behavior (not just style) must change — gating the resizer handlers and driving the mobile tab state — because those cannot be done in CSS alone.

2. **Disable drag-resize on small/touch screens via JS, not just CSS.** Today `.resizer{display:none}` hides the handle but the `<Resizer>` still mounts and binds pointer handlers. We will conditionally render `<Resizer>` only when `isDesktop` (`matchMedia("(min-width:1024px)")`), so no touch handlers attach and `touch-action` conflicts can't occur. Keep the CSS `display:none` as defense-in-depth. *Rationale:* satisfies task 1 ("disable drag-to-resize on touch/small screens") robustly.

3. **Mobile panel = segmented tabs over a scrollable section (not a true overlay bottom-sheet).** Below 1024px, render a segmented control ("Grids · Alerts · Details") above the stacked panel area and show one panel at a time in a scrollable region; "Details" tab is enabled/auto-selected when a grid is selected. *Rationale:* a tabbed panel is lighter than a draggable sheet, needs no new dependency, reuses the existing `.seg` styling and existing `GridList`/`GridDetail`/alerts components, and keeps the map prominent. It directly satisfies task 2 ("bottom sheet / tabbed panel / scrollable section rather than cramped side columns"). The approach is additive — the same components render; only their container/visibility changes.

4. **Stat strip becomes a horizontal scroll-snap row on phones.** Below 1024px keep a responsive grid; at `<=640px` switch `.bottom` to a horizontally scrollable flex row (`overflow-x:auto`, `scroll-snap`, each `.stat` gets a `min-width`) so all 7 stats remain readable and nothing clips or forces page-level horizontal scroll. *Rationale:* satisfies task 3 and task 4 (no horizontal page scroll at 375px).

5. **Compact header on mobile.** Keep brand + live clock compact; the metric toggle, speed, theme, and pause controls reflow into a tidy wrapping control row with ≥44px targets and no horizontal overflow. Reuse existing `.topbar`/`.seg`/`.actions` classes; only adjust sizing/wrapping in the mobile media queries. *Rationale:* task 2, additive styling only.

6. **Viewport export** added to `app/layout.tsx` as described above. *Rationale:* task — required for `width=device-width, initial-scale=1` using the current Next.js API.

7. **Map sizing on mobile** stays `position:relative; height` driven by CSS; `MapView.padding()` threshold is bumped from `860` to `1024` to match the new breakpoint so `fitBounds` padding is correct in the stacked layout. *Rationale:* keep map framing correct; task constraint allows MapView edits for map sizing.

No test framework exists; verification is build + manual responsive checks at 375×812 and 1440 (and a 768 tablet spot-check), per the task.

---

# Implementation Plan

- [ ] 1. Add the `viewport` export to the root layout for `width=device-width, initial-scale=1`.
      Import the `Viewport` type from `next` and export `export const viewport: Viewport = { width: "device-width", initialScale: 1 };` alongside the existing `metadata` export. Do NOT set `maximumScale`/`userScalable` (preserve pinch-zoom accessibility). Leave `metadata`, fonts, and `data-theme="dark"` untouched.
      Files: `app/layout.tsx`
      Verify: `npm run build` compiles with no type errors; then `npm run dev`, open `http://localhost:3000`, and in DevTools confirm `<head>` contains `<meta name="viewport" content="width=device-width, initial-scale=1">`.

- [ ] 2. Add a tiny `useMediaQuery` hook and mobile UI state to `Dashboard.tsx`, and gate the Resizer so drag-resize is desktop-only.
      In `components/Dashboard.tsx` add a small `useMediaQuery(query: string)` hook (React `useState` + `useEffect` + `matchMedia`, SSR-safe: default `false` on first render, subscribe in effect). Compute `const isDesktop = useMediaQuery("(min-width: 1024px)")`. Add `const [mobileTab, setMobileTab] = useState<"grids" | "alerts" | "details">("grids")`. Render `<Resizer ... />` only when `isDesktop` (both left and right). When a grid is selected on mobile, auto-switch `mobileTab` to `"details"` (effect on `selectedId` when `!isDesktop`). Keep all existing state/handlers (metric, speed, paused, theme, selectedId, hover, cols) unchanged.
      Files: `components/Dashboard.tsx`
      Verify: `npm run build` passes. `npm run dev` → at 1440 the resize handles still drag the columns; shrink the window below 1024px and confirm the handles are gone and no resize occurs on drag.

- [ ] 3. Restructure the left/right columns + stats into a mobile tabbed panel in `Dashboard.tsx` (markup/class changes only, same child components).
      Wrap the column/panel region so that: on desktop it renders today's `.col-left` and `.col-right` asides unchanged; on mobile (`!isDesktop`) it renders a segmented control (reuse `.seg` styling, add a `mobile-tabs` class) with Grids / Alerts / Details buttons driven by `mobileTab`, and shows exactly one of `GridList`, the Alerts card, or `GridDetail`+Citywide-chart in a scrollable `mobile-panel` container. Keep the Citywide reserve chart reachable (place under the Details tab, or always below the map — choose Details tab to keep one scroll region). Do not duplicate component logic; render the SAME `GridList`, alerts `<section>`, `GridDetail`, and `AreaChart` instances, just inside the mobile container when `!isDesktop`. Ensure the "Details" tab is disabled/greyed when nothing is selected.
      Files: `components/Dashboard.tsx`
      Verify: `npm run build` passes. `npm run dev` at 375×812: the three tabs switch content, tapping a microgrid in the Grids tab selects it on the map and auto-shows the Details tab; sort toggle, alerts click-to-select, and the citywide chart all still work.

- [ ] 4. Rework the responsive CSS in `globals.css`: raise the mobile threshold to 1024px, add a compact mobile header, tabbed-panel styles, and ≥44px tap targets.
      In `app/globals.css`: change the existing `@media (max-width: 860px)` block to `@media (max-width: 1023px)` (keep its flex-column `.app`, relative map, `order`-based stacking, `.resizer{display:none}`, and `maplibregl` ctrl repositioning). Add styles for `.mobile-tabs` (full-width segmented control, ≥44px buttons) and `.mobile-panel` (scrollable region with sensible `max-height`). Ensure `.topbar` controls wrap tidily and all buttons (`.seg button`, `.icon-btn`, `.pill-btn`, tab buttons) are ≥44px tall on mobile. Keep the desktop (`>=1024px`) rules exactly as they are so the desktop look is unchanged. Keep the `@media (max-width:1180px)` tweaks but ensure they don't fight the new mobile layout (they only apply in the 1024–1180 desktop band now).
      Files: `app/globals.css`
      Verify: `npm run dev` at 1440 → pixel-identical desktop layout (resizable 3 columns, absolute map). At 768 and 375 → single-column flow, map on top, compact wrapping header, tab bar visible; measure a few buttons in DevTools to confirm ≥44px height.

- [ ] 5. Make the bottom stat strip reflow without horizontal page overflow on phones.
      In `app/globals.css`, within the `<=1023px` (and a nested `<=640px`) rules, change `.bottom` from the cramped multi-column grid to a horizontally scrollable row: `display:flex; overflow-x:auto; gap; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch;` with each `.stat { flex: 0 0 auto; min-width: ~150px; scroll-snap-align:start; }` and the legend stat sized to fit. Ensure the row itself scrolls, not the page (`body` already `overflow:auto` on mobile — confirm no element exceeds viewport width).
      Files: `app/globals.css`
      Verify: `npm run dev` at 375×812 → the stats row scrolls horizontally, all 7 stats readable, and the PAGE has no horizontal scrollbar (DevTools: `document.documentElement.scrollWidth <= window.innerWidth`).

- [ ] 6. Update `MapView.padding()` breakpoint to match the new 1024px mobile threshold.
      In `components/MapView.tsx`, change the `window.innerWidth < 860` check in `padding()` to `window.innerWidth < 1024` so `fitBounds` uses the simple mobile padding whenever the stacked layout is active. No other map logic changes.
      Files: `components/MapView.tsx`
      Verify: `npm run build` passes. `npm run dev` at 375 → selecting/deselecting a microgrid flies the map with the neighborhood comfortably framed (not clipped under the panel); at 1440 → framing is unchanged from before.

- [ ] 7. Confirm touch interactions degrade correctly (no regressions from hover-only paths).
      Review in `Dashboard.tsx`/`MapView.tsx` that nothing on mobile depends solely on hover: map tap selects a grid and opens battery popups (existing `click` handler), `GridList` rows select on click, the hover `MapTooltip` simply won't appear without a mouse (acceptable — tap selection + Details tab convey the same data). No code change expected unless a hover-only control is found; if so, make its action also fire on click/tap.
      Files: `components/Dashboard.tsx`, `components/MapView.tsx` (only if a hover-only interaction is found)
      Verify: `npm run dev` with DevTools device toolbar (touch emulation) at 375×812 → tapping a map neighborhood selects it (orange highlight + Details), tapping a battery dot (after zoom) opens its popup, nothing requires a hover to reach.

- [ ] 8. Full verification pass (build + responsive checks at the required viewports).
      Run the production build and a manual responsive sweep.
      Files: none (verification only)
      Verify:
      - `npm run build` → completes successfully with no type/lint errors.
      - `npm run dev` → `http://localhost:3000`:
        - **1440 (desktop):** three-column resizable layout, draggable handles work, absolute map behind floating panels — visually identical to before this change.
        - **375×812 (phone):** map prominent on top, compact wrapping header (metric/speed/theme/pause all reachable, no overflow), tabbed Grids/Alerts/Details panel, horizontally scrollable stat strip, NO horizontal page scroll, tap targets ≥44px, text legible.
        - **768 (tablet) spot-check:** single-column mobile layout (not a cramped 2/3-column squeeze).
        - All functionality preserved: metric toggle, speed (1×/60×/600×), pause/resume, theme toggle (dark↔light), neighborhood selection + fly-to, battery popups, citywide reserve chart, alerts list click-to-select, microgrids list with Reserve/A–Z sort.

## Notes / assumptions

- No test runner exists in the repo (no test deps or scripts in `package.json`); verification is `npm run build` + manual responsive checks, as the task specifies. Do not add a test framework for this presentation-only change.
- `AGENTS.md`'s auto-generated block is left untouched; if `next dev` re-adds it to the working tree, that is expected and may be committed with the work.
- Exact mobile map height (`62vh` today) and stat `min-width` values are starting points; adjust during the manual sweep so nothing clips at 375px while the map stays prominent.
- Desktop CSS (`>=1024px`) and the `localStorage("cols")` resize persistence are left functionally unchanged — responsive behavior is strictly additive.

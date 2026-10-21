# Mobile-first responsive Gridwatch dashboard with tabbed panel

Below 1024px the dashboard drops its resizable three-column desktop layout for a single-column flow: a prominent map on top, a compact wrapping header, and a Summary/Grids/Alerts/Details tab bar over one scrollable panel. The same `GridList`, alerts section, `GridDetail`, citywide `AreaChart`, and `Stat` cards are reused across both layouts via shared JSX (`gridListCard`, `alertsCard`, `detailCard`, `chartCard`, `statCards`) rather than duplicated, so behavior stays identical and only the containers change. Desktop (`>=1024px`) renders the original asides, `Resizer` drag handles, `localStorage` column persistence, and bottom stats strip untouched. The viewport is set through the Next.js `viewport` export (current API per the local docs) instead of a manual `<meta>` tag, and pinch-zoom is left enabled.

Watch for: on desktop the first paint renders the mobile layout and flips to the three-column layout only after hydration, because the media-query hook starts at `false` (confirmed — a brief mobile flash on desktop load, intentional per the verification note to avoid a hydration mismatch). No functional regressions found.

**Verdict**: APPROVED

## High-level view

The gating strategy is two-layered and consistent: JavaScript (`isDesktop = useMediaQuery("(min-width: 1024px)")`) chooses which JSX tree mounts, and CSS media queries at `<=1023px` and `<=640px` style the mobile tree. The `Resizer` only mounts on desktop so no drag handlers bind on touch, and `.resizer { display:none }` backs that up in CSS. `MapView`'s `fitBounds` padding threshold moved 860->1024 to match the new stacked breakpoint.

Functionality is preserved by construction: every interactive piece is defined once and rendered into whichever layout is active. The header controls (metric toggle, speed, pause, theme) reflow into full-width rows at `<=1023px` with `>=44px` tap targets; the four panel tabs shrink padding at `<=640px` to fit 375px without overflow. Citywide stats render in a two-column vertical grid inside the Summary tab (no horizontal scroll), and the always-visible desktop bottom strip is gated off on mobile.

The one real trade-off is SSR: the media-query hook returns `false` on the server and first client render, so desktop users get a momentary mobile layout before the client corrects it. This is a deliberate choice to keep hydration consistent and does not change the final rendered state or any functionality. Hover tooltips degrade to tap because selection is driven by click handlers on both the map and the grid rows, with the Details tab surfacing the same data on touch.

<details>
<summary>Issues (1)</summary>

1. **Desktop first-paint mobile flash (LOW)** — `useMediaQuery` starts at `false`, so desktop loads render the mobile tab layout for one frame before flipping to three columns. Intentional per the verification note to avoid hydration mismatch; acceptable as-is, but could be smoothed later with a CSS-only desktop-default or a hydration-safe initial guess if the flash is noticeable.

</details>

<details>
<summary>Details</summary>

### Two-layer gating keeps desktop byte-for-byte unchanged

The split is driven by `isDesktop` in `Dashboard.tsx`. When true, the original `col-left`/`col-right` asides render with their `Resizer` children and the `localStorage("cols")`-backed widths; the `{isDesktop && <footer className="bottom">{statCards}</footer>}` strip renders below. All the `>=1024px` CSS is untouched, and the mobile rules live entirely in the new `@media (max-width: 1023px)` and `@media (max-width: 640px)` blocks, so the responsive behavior is strictly additive. The old `@media (max-width: 860px)` block was replaced wholesale by the `1023px` block, which raises the mobile threshold to the intended breakpoint.

Drag-to-resize is disabled two ways on small screens: the `Resizer` component is only rendered inside the desktop branch (so no pointer handlers mount below 1024px), and `.resizer { display: none }` in the mobile block is defense-in-depth. This satisfies the requirement that drag handles be off on touch/small screens.

`MapView.tsx` moves its `padding()` branch from `< 860` to `< 1024`, so whenever the stacked layout is active the map uses the simple 24px padding instead of trying to read `.col-left`/`.col-right`/`.bottom` rects that no longer exist in the mobile tree.

### Shared JSX preserves every interaction

The components are defined once and injected into whichever layout mounts:

```
statCards ─┬─ desktop <footer class="bottom">
           └─ mobile Summary tab (.mobile-stats)

gridListCard, alertsCard ─┬─ desktop col-left
                          └─ mobile Grids / Alerts tabs

detailCard, chartCard ─┬─ desktop col-right
                       └─ mobile Details tab
```

Because `GridList` (with its Reserve/A–Z sort toggle), the alerts click-to-select buttons, `GridDetail`, and the citywide `AreaChart` are the same instances in both trees, metric toggle, speed, pause, theme, neighborhood selection + fly-to, battery popups, the reserve chart, alerts, and the microgrids sort all carry over without change. `GridList` itself is not touched by the diff, so its sort toggle and scroll-into-view behavior are preserved as-is.

Hover tooltips are mouse-driven (`MapTooltip` keyed on `hover.id` from `onMouseMove`/`onMouseEnter`). On touch there is no mousemove so the tooltip simply never appears, and the same information is reachable by tapping a map dot or a grid row (both wired to `setSelectedId`), which on mobile auto-switches to the Details tab via the `useEffect` on `selectedId`. Hover degrades to tap as required, with no interaction depending solely on hover.

### Header, tabs, and stat strip fit phone widths

At `<=1023px` the `.topbar` wraps, the metric `.seg` and `.actions` row each take full width, and the icon/pill/segment buttons are sized to `>=44px` (speed `.seg-sm` to `>=40px`), meeting the ~44px tap-target requirement. The four tab labels get reduced padding and a 12px font at `<=640px` so Summary/Grids/Alerts/Details fit within 375px.

The citywide stats, which were the horizontally-laid-out `.bottom` strip on desktop, render in the Summary tab as `.mobile-stats` — a `repeat(2, minmax(0,1fr))` vertical grid with the legend spanning full width. That is a wrapping grid, not a horizontal scroll, so there is no horizontal page overflow at phone widths and the bottom-strip-overflow requirement is addressed by relocation rather than by scrolling. `html, body { overflow: auto }` in the mobile block lets the page scroll vertically.

### SSR first-paint flash on desktop

`useMediaQuery` initializes `matches` to `false` and only reads `matchMedia(query).matches` inside a post-mount effect. The server HTML and first client render are therefore always the mobile tree (Summary tab, no `.bottom` footer), confirmed via `curl` in the verification note; a desktop load flips to three columns once the effect runs after hydration. The cost is a one-frame mobile flash on desktop. Fixing it with a non-`false` initial guess would risk a hydration mismatch, so the trade-off is defensible — flagged LOW, not a blocker.

### Constraints

The commit touches only `app/layout.tsx`, `app/globals.css`, `components/Dashboard.tsx`, and `components/MapView.tsx` (plus the `.agents/tasks/verification.md` note); `lib/sim.ts` and `lib/scale.ts` are not in the diff. The viewport is configured through `export const viewport: Viewport` per the local Next.js docs, with `maximumScale`/`userScalable` deliberately omitted so pinch-zoom stays available. No new dependencies were added — the only mechanism is plain CSS media queries plus a small `useMediaQuery` hook built on existing React state and `matchMedia`. The `AGENTS.md` `<!-- BEGIN:nextjs-agent-rules -->` block is intact (present and unmodified). An uncommitted `package-lock.json` edit exists in the working tree but is only a project `name` rename (`google` -> `denver-microgrid-monitor`), not a dependency change and not part of this commit.

### Test coverage

No automated UI tests exist in the repo and none were added; the project has no browser-test tooling installed, and installing Playwright was correctly avoided as a heavy dependency the task forbids. Verification rests on a successful `npm run build` (no type/lint errors, run twice), a `curl` check that the viewport meta and mobile markup reach the served HTML, and a manual reviewer checklist. Not tested: actual rendered pixel behavior at 375/768/1440, real touch-event drag suppression, and the no-horizontal-scroll assertion (`scrollWidth <= innerWidth`) — these are asserted structurally and by the checklist rather than executed. The responsive guarantees are structural, not pixel-verified.

</details>

<details>
<summary>File map</summary>

- `app/layout.tsx` — add Next.js `viewport` export (`width=device-width`, `initial-scale=1`); pinch-zoom preserved.
- `app/globals.css` — replace the old 860px mobile block with `<=1023px` single-column/tabbed-panel styles and a `<=640px` phone block; `>=44px` tap targets; `.mobile-stats` vertical grid.
- `components/Dashboard.tsx` — add SSR-safe `useMediaQuery` + `isDesktop` gate and a Summary/Grids/Alerts/Details tab bar; share `statCards`/card JSX between layouts; gate desktop asides, `Resizer`, and bottom strip to `>=1024px`.
- `components/MapView.tsx` — bump `padding()` breakpoint 860->1024 to match the stacked layout.

Full diff: `git show HEAD`.

</details>

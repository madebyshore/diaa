# Home nav + grid rework

## Context

Five related tweaks to the home page, all touching the top nav, the text-mode
grid, and shared nav styles:

1. **Nav hover** should stop using the width-expand stagger animation. Instead:
   fade the whole nav out → swap to the full expanded set → fade back in (and the
   reverse on mouse-leave).
2. **Commas** on the nav items currently render clipped/tiny (see screenshot) —
   each visible item in a group needs a clean comma separator.
3. **Filtered text view** should stay centered (it currently top-aligns).
4. **Authored grid rows** should go away. The CMS `grid` field becomes a flat
   array of Detail references; the front end renders one responsive
   `flex-wrap` row, centered — no per-row authoring, no `--fit` shrink logic.
5. `.global-nav__link` should get `text-box: cap alphabetic`.

Doing #4 first simplifies #2/#3: once the text pane is a single centered
flex-wrap, "filtered = centered" falls out for free, and the comma fix is pure
CSS.

> **⚠ Breaking content change (#4):** the live Sanity `grid` is stored as
> `gridRow → cells → detail` objects. After this change the schema + build query
> read `grid` as a flat array of Detail **references**, so the existing authored
> grid will no longer match and the home grid will render **empty until it is
> re-authored** in the Studio (and the Studio is redeployed). Confirming you're
> OK with re-adding the home grid items is the main reason for this plan gate.

---

## 1 — CMS grid → flat array  (`apps/be`)

**`schemaTypes/documents/singletons/pageHome.js`**
- Replace the `grid` field's `of:` (currently `gridRow` object → `cells` array →
  `gridCell` object → `detail` ref) with a flat reference array:
  ```js
  of: [{ type: 'reference', to: [{ type: 'detail' }] }]
  ```
- Drop `components: { input: HomeGrid }` and the `HomeGrid` import — the custom
  row/cell composer no longer applies; the default array input is used.
- Update the field `description` (rows → ordered list).
- Delete `components/homeGrid.jsx` (only `pageHome` imports it — will verify).
  Leave `components/gridBuilder.jsx` alone (belongs to the `gridBuilder` slice).
- Studio redeploy (`cd apps/be && npx sanity deploy`) is a manual follow-up.

## 2 — Build pipeline  (`apps/fe/scripts`)

**`utils/queries.ts` → `pageHomeQuery`:** replace the `grid[] { _key, cells[] {
"detail": detail->{…} } }` projection with a flat dereference:
```groq
"grid": grid[]->{
  _id, title, titleItalic, inProgress,
  "slug": slug.current,
  "coverImage": coverImage.asset->url,
  coverSize,
  "taxonomy": taxonomy->{ _id, title }
}
```

**`sanity-content.ts`:**
- `PageHomeDoc.grid: DetailRef[] | null`; delete the `GridCell` / `GridRow`
  interfaces.
- Replace the nested row/cell loop (~L333–382) with a single flat loop over
  `pageHome.grid` building `homeGridItems` (keep `seenDetailIds` dedup,
  `flatIndex`, the `sanityPicture` entry, and the `detailPages.push` per slug).
- Remove `homeGridRows` and the `gridRows` key from the home page `data`.

## 3 — Template  (`apps/fe/src/routes/home/home.html`)

- Text mode: drop the `{{#gridRows}}<div class="home__text-row">{{#cells}}…
  {{/cells}}</div>{{/gridRows}}` wrapper. Iterate `{{#gridItems}}` directly inside
  `.home__text`, emitting the same `<a class="home__text-item">` / in-progress
  `<div>` per item (unchanged markup, just un-nested).
- Image mode and `.home__text-gpu` already iterate `{{#gridItems}}` — untouched.

## 4 — Home JS  (`apps/fe/src/routes/home/home.ts`)

**Remove the grid-row machinery:** `textRows`, `rowWraps()`, `fitTextRows()`,
`fitResizeId` + its `ResizeHub.add`, `TEXT_FIT_STEPS`, and the empty-row hide loop
inside `applyFilter()`. Drop the `ResizeHub` import if it's then unused.

**Replace the nav width-expand with a fade-swap:**
- Delete `applyNavProgress()`, `computeNavExpandTotalMs()`, the body of
  `expandNav`/`collapseNav`, `updateNavCommas()`, `navProgress`,
  `navExpandTotalMs`, the `navItems` naturalWidth measurement, and the
  `NAV_WIDTH_PHASE_MS / NAV_OPACITY_* / NAV_COLLAPSE_DURATION_MS / NAV_EXPAND_EASE
  / NAV_SIBLING_GAP_PX / NAV_GROUP_GAP_PX` constants. **Comma logic moves to pure
  CSS (§6), so all `data-comma` writes go away.**
- Add `setNavExpanded(expanded: boolean)`: pause any in-flight nav anima, fade
  `navEl.style.opacity` 1→0 over `NAV_FADE_DURATION` on `NAV_FADE_EASE`, toggle
  `navEl.classList.toggle("is-expanded", expanded)` at opacity 0, then fade 0→1,
  clearing inline opacity at the end. A `navGen` counter guards against
  overlapping hovers (bail if superseded after an `await`). Reuses
  `animaToPromise` + `Anima` (same pattern as `switchMode`).
- `navEnterHandler` → cancel pending collapse timer, `setNavExpanded(true)`.
  `navLeaveHandler` → debounce by `NAV_COLLAPSE_DELAY_MS` (kept), then
  `setNavExpanded(false)`.
- `init()` leaves the nav collapsed (no `.is-expanded`, no inline styles).
- New constants: `NAV_FADE_DURATION = 150`, `NAV_FADE_EASE = "slow"` (tunable).

## 5 — Home styles  (`apps/fe/src/styles/pages/_home.module.scss`)

- `.home__text`: keep `flex: 1 1 auto` (fills the column from the prior change);
  switch to `flex-flow: row wrap; justify-content: center; align-content: center;
  align-items: baseline; gap: var(--S)`. This is the single responsive centered
  row — and makes the **filtered view centered (#3)** by construction.
- Delete `.home__text-row`, the `.home[data-filtered]` reflow block (rows →
  `display: contents`), and the `--fit` usage; `.home__text-item` padding becomes
  fixed `var(--XS)`.
- `.home__mode, .home__filter`: **remove `overflow: hidden`** (this un-clips the
  comma `::after` — the root cause of the tiny/cut commas, **#2**).
- Remove `.home .global-nav__group { gap: 0 }` (revert to the inherited 0.6rem
  within-group gap).
- Remove the `content: attr(data-comma)` override on `.home__filter::after /
  .home__mode::after`.
- Add the collapsed/expanded rules:
  ```scss
  .home .global-nav:not(.is-expanded) {
    .home__filter:not(.is-active),
    .home__mode:not(.is-active) { display: none; }      // show only actives
    .home__filter.is-active::after { content: ","; }      // bridge → mode group
    .home__mode.is-active::after  { content: "";  }       // last item, no comma
    .global-nav__group + .global-nav__group { margin-left: 0; } // tight collapsed gap
  }
  ```
  Expanded relies on the existing `_globals` group-comma rules
  (`.global-nav__group > *:not(:last-child)::after { content: "," }`) for
  `All, Projects, Studio, Curio` / `Text, Image`, and the inherited
  `& + & { margin-left }` for the inter-group gap.

## 6 — Shared nav style  (`apps/fe/src/styles/includes/_globals.module.scss`)

- `.global-nav__link`: add `text-box: cap alphabetic;` (**#5**).

## 7 — Changelog

- Add entries under `[Unreleased]` (Changed + a note on the breaking CMS grid
  shape) per project rules.

---

## Verification

- `cd apps/fe && npx tsc --noEmit` — clean (ignoring the pre-existing
  `sanity-content.ts` L193 deprecation).
- `pnpm --filter fe dev` (port 3000), then check:
  - **Nav resting** shows `( All, Text )`; hover fades out → in showing
    `( All, Projects, Studio, Curio   Text, Image )` with clean commas; mouse-out
    fades back. Switch the active filter to a mid/last taxonomy (e.g. Studio,
    Curio) and confirm the collapsed bridge comma still reads `( Studio, Text )`.
  - **Text mode** renders all items in one centered wrapping row; resize narrows/
    wraps responsively; vertically centered in the pane.
  - **Filtered** text view stays centered (both axes).
  - `.global-nav__link` (footer) sits on the cap-height baseline.
- Re-author the home `grid` in the Studio (flat Detail list) and rebuild so the
  grid is populated again.
- Build sanity: `pnpm --filter fe build`.

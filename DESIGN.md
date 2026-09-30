# Jelly Dice — DESIGN.md

Design authority for this project. Source brief: user-pasted spec "Jelly Dice" (2026-09-29).
No external visual references were supplied; everything below is derived from the brief.
Deliverable: one self-contained `index.html` (WebGPU + WGSL, no external models, images, audio or fonts).

## 1. Principles

1. The dice are the hero. UI is quiet editorial typography around a large, empty, warm stage.
2. Material over decoration: the candy must read as *heavy, elastic gummy* through physics + light
   transport, not through UI effects.
3. Every visible behavior is real: softness is local lattice deformation, results come from the
   final orientation, sounds come from simulated contacts.

## 2. Color

| Token | Value | Use |
|---|---|---|
| `paper` | `#F2EDE5` (linear 0.888, 0.846, 0.783) | page, cyclorama floor, tone-map anchor (maps 1:1) |
| `ink` | `#1D1A17` | heading, primary button fill, selected states |
| `ink-2` | `#6E665D` | captions, labels, hint (contrast 5.2:1 on paper) |
| `hair` | `rgba(29,26,23,.14)` | 1 px dividers and control borders |
| `hair-strong` | `rgba(29,26,23,.30)` | hover borders |

Flavors (swatch sRGB → physical transmittance per world unit `T1`; absorption `σ = −ln T1`):

| Flavor | Swatch | T1 (linear RGB) |
|---|---|---|
| Emerald (default) | `#14A673` | 0.10, 0.62, 0.34 |
| Amethyst | `#9A5AD8` | 0.46, 0.15, 0.72 |
| Amber | `#EFA11C` | 0.95, 0.64, 0.07 |
| Sapphire | `#2C6FE0` | 0.06, 0.28, 0.80 |
| Ruby | `#D4203F` | 0.84, 0.035, 0.09 |
| Lime | `#98CC1F` | 0.50, 0.85, 0.06 |

Rules: no UI gradients, no glass blur, no drop shadows on UI. Pips are milky cream `#F4EFE6`-ish,
~93 % opaque, so they stay readable on every flavor.

## 3. Typography (native text, exact copy)

| Role | Family stack (first available wins) | Size | Style | Line height | Tracking |
|---|---|---|---|---|---|
| Display "Jelly / Dice." | Iowan Old Style → Hoefler Text → Baskerville → Palatino → Georgia → serif | clamp(64px, 8.6vw, 136px); mobile 50px | italic 400 | 0.84 | −0.03em |
| Result total | same serif | 46px (mobile 34px) | italic 400 | 1 | −0.02em |
| Collection label | system sans (-apple-system / Segoe UI / Roboto) | 11px | 500, uppercase | 1.2 | 0.22em |
| Caption, hint | system sans | 13px | 400 | 1.55 | 0 |
| Control labels | system sans | 10.5px | 500, uppercase | 1 | 0.18em |
| Buttons | system sans | 13–14px | 500 | 1 | 0.01em |

Rights/availability: only locally installed system fonts are referenced by name; no font file is
embedded, downloaded or redistributed (`NOT_EMBEDDED`). Second line of the title is indented 0.42em
for an editorial stagger.

Rendered-face evidence (2026-09-29, Claude built-in browser = Chrome 152 on macOS 27): canvas width
of the title string with the stack equals Iowan Old Style Italic exactly (960.5 px @100px) and differs
from Hoefler/Baskerville/Georgia/serif. "New York" is not exposed by name in Chrome (its width equals
an unknown font), so it was removed from the stack to keep Safari and Chrome on the same face.
Other platforms fall back through Palatino / Georgia — accepted difference.

## 4. Layout

- Canvas is full-bleed and fixed; UI floats above it with `pointer-events` only on controls.
- Desktop (≥ 900px): brand block top-left (inset 40px); status / Sound / Reset view top-right;
  control column bottom-right, width 300px; hint bottom-left. Rows divided by 1px `hair` lines,
  12px vertical padding. Primary button: 50px tall, fully rounded, `ink` fill, `paper` text.
- Mobile (< 720px): brand top-left (title 52px), compact top bar, controls in a bottom sheet
  (paper at 92 % opacity + top hairline). The 3D projection is lens-shifted so the dice centre sits
  in the free band between header and sheet — UI never covers the dice at rest.
- Safe-area insets respected on all edges.

## 5. Interaction & motion

- UI transitions 180–240ms `cubic-bezier(.2,.7,.2,1)`. Result reveal: values rise 8px + fade,
  60ms stagger. Rolling indicator: three dots pulsing at 900ms.
- Focus-visible: 2px `ink` outline, 3px offset. Hover: border `hair-strong`.
- Space rolls (except while a slider has focus). Right-drag or empty-background drag orbits;
  wheel / pinch zooms within limits; Reset view eases back (≈0.6s).

## 6. VISUAL MECHANISM (visual-mechanism-rd)

- REFERENCE: brief only (premium gummy candy, studio product lighting). Style is not copied from
  any source.
- MECHANISM: 5×5×5 surface-conforming node lattice per die (XPBD distance + cell-volume
  constraints + weak global shape matching); render mesh embedded in the lattice by tricubic
  Catmull-Rom (C1) param coords; normals via cofactor of the deformation Jacobian (no seams).
  Material: per-die back-face depth → thickness; Beer–Lambert absorption `exp(−σ·t)`;
  screen-space refraction of a per-die backdrop copy (so dice behind stay visible); thickness-scaled
  blur + in-scatter for soft internal scattering; studio softbox environment; colored soft shadows
  from a light-space thickness map; analytic box AO for contact.
- TOOL ROUTE: WebGPU (WGSL compute + render), CPU physics in JS (fixed 120 Hz step, 8 substeps).
- MACRO: rounded pillowy cube silhouette, stable at rest; rigid tumble when rolled.
- MESO: the grabbed corner/face region stretches first (neck thins by volume preservation), the rest
  follows; landing squash; pips and bubbles ride the deforming body.
- MICRO: soft rectangular highlights, deep saturated core, light thin edges, tiny air bubbles.
- MOTION GRAMMAR: pull → local stretch → (sustained) peel/lift; release → recoil → 1–3 wobbles →
  settle ≲1.5s; landing squash ≈5–10 % → restrained rebound; roll settles in ≈1.5–3s.
- GATES (technical): no NaN, floor penetration < 3 % of die size, dice overlap bounded, result ==
  orientation, no console errors, steady frame time with 5 dice + sound, no JS heap growth trend.
- GATES (visual, human-reviewed): reads as heavy gummy (not balloon / plastic / slime); pips readable
  at default view; thickness gradient visible; no black outlines, seams, blown highlights or banding.
- FAIL CONDITIONS: whole-object scaling as "softness"; floaty drift; endless bouncing; explosions;
  hollow/flat material; disappearing dice behind other dice.
- DELIVERY: `index.html` (single file). State after automated checks: `TECHNICAL_PASS` +
  `PENDING_USER_REVIEW` for art direction.

## 6b. v4 additions (2026-09-30): bilingual page + object library

User request (2026-09-30): Chinese/English switch; about ten calm, everyday objects that
appear directly like the dice (chips + typed input in either language); selectable colours including
the object's own.

**Objects** (order = chip order = eyebrow number; `OBJECT_TYPES` in `src/v4-parts/02b-objects.js`):
01 骰子 Dice · 02 松果 Pine cone · 03 葫芦 Gourd · 04 银杏叶 Ginkgo leaf (scale 0.8) · 05 橡果 Acorn ·
06 鹅卵石 Pebble (scale 0.9) · 07 苹果 Apple · 08 手机 Phone · 09 小房子 Home · 10 蘑菇 Mushroom.
Each is an SDF with BODY / ACCENT / STEM parts and per-fragment details in rest space: pips (die),
scale seams (pine cone), red cord (gourd), veins (ginkgo), cap texture (acorn), quartz vein (pebble),
dark screen + two lenses (phone), warm emissive windows + door (home), white dots + gills (mushroom).
Detail masks must be distances (`max(detail, mask)`), never `if` branches — branch seams show up as
lines through `fwidth` (roof / cap-rim lesson).

**Colour**: palette = 本色/Natural (objects only; default when an object is chosen) + the six flavours.
With a flavour, accent = σ×1.7 and stem = σ×2.5 of the flavour (scatter ÷√k). Natural T1 highlights:
apple red body + green leaf, gourd honey, ginkgo pale gold, pebble grey, phone blue jelly
(T1 0.34/0.50/0.88, density ×1.5), home cream walls + terracotta roof, mushroom red cap + cream stem.

**Copy** (exact): EN keeps the original lines. ZH: eyebrow `柔软游乐系列 / NN`; title `果冻 / {物件}。`;
caption `一点运气。/ 一点晃动。/ 软软的概率。`; hint `轻点戳一戳，拖动拉一拉，让运气晃一晃。`;
roll `掷骰子` (dice) / `抛一抛` (objects); input placeholder `输入：苹果、手机…`.
Object results: up / side / down words per object (e.g. 屏幕朝上 / 立着 / 屏幕朝下) and a count
"k/n" of the up state; dice keep face values + total.
Object captions (shown only when a host page sets `notes: true`) must only reference content that
really exists on that host page.

**Typography (ZH)**: title `"Songti SC", STSong, "Noto Serif CJK SC", "Source Han Serif SC"` 500,
never synthetic italics; second line indented 1em; 36px on phones. UI sans adds PingFang SC /
Hiragino Sans GB / Noto Sans CJK SC / Microsoft YaHei.

**Layout**: phones — compact sheet (chips row scrolls horizontally; "随便来一个" beside the input);
the sheet is re-measured by ResizeObserver. Desktop — framing guard: the outermost drop spot
(+half width +0.35 tumble room) must project left of the control column (−16px); 1440×900 framing is
unchanged from v3. Layout scale `typeScale(t)` spreads drops/tosses and frames wide objects.

**Mechanism changes**: objects use an axis-aligned box lattice (exact affine embedding) with
volume-weighted node masses; floor/object contacts via curvature-adaptive surface samples,
Jacobi-averaged corrections and anchor-based static friction; box-lattice objects sleep in contact
groups after ~1.2 s calm; floor AO samples each object's SDF slab (40³ half-float 3D atlas);
coloured shadows use an rgba optical-depth map (σ·thickness per object). Dice physics unchanged.

## 6c. Embedding in another page

- A host page can configure the engine through `window.JELLY_CONFIG` (set before the module runs):
  `embedded`, `lang`, `langHref`, `langLinks`, `notes`, `storageKey` (null = no Web Storage), `paper`,
  `strings`, and `titleTemplate`. The standalone page sets none of these and uses the defaults.
- On sites with a strict Content-Security-Policy, pass the config as a JSON data block
  (`<script type="application/json">`) and assign it from a same-origin module imported before the engine.
- Rules for engine code: no inline `<script>`, no `style=""` markup or `setAttribute('style', …)` (CSSOM
  `style.setProperty` is fine), no eval or `new Function`, and no network access.

## 7. Forbidden

Heavy panels, decorative gradients in UI, neon, bloom blowouts, black outlines on dice, background
music, external assets, fake softness via global scaling, random-number results.

## 8. Historical best

- `checkpoints/v5-embed-config.html` (= current `index.html`, SHA-256 `fdaf1451…2ff2`, 2026-09-30):
  v4 visuals unchanged, plus optional host-page config (paper colour, title template,
  message overrides, optional storage). Also relaxed calm thresholds, so knobbly objects fall asleep
  reliably. Source: `src/v4-parts/` (`zsh src/build.sh` reproduces index.html byte-for-byte).
- `checkpoints/v4-bilingual-objects.html` (SHA-256 `65f2d03c…79f8`, 2026-09-30): v3 dice unchanged,
  plus the zh/en switch, the ten-object library, natural colours and object results. Immediate rollback for v5.
- `checkpoints/v3-startup-hardened.html` (SHA-256 `15f3253a…a6bd`, 2026-09-30) —
  same visuals as v2 plus start-up hardening (no-script message, staged start, watchdog).
- `checkpoints/v2-best.html` (SHA-256 `b15cfc19…51b5`) — visual baseline verified 2026-09-29:
  material with depth-graded in-scatter + camera-relative reflection cards, SDF contact AO,
  soft lattice with anchored stretch, restrained rebound, desktop/mobile framing.
- `checkpoints/v1-physics-baseline.html` — earlier baseline (stiffer grab, bouncier landings); kept for rollback only.
- Art direction status: `PENDING_USER_REVIEW`.

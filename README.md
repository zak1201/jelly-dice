# Jelly Dice / 果冻骰子

A single-file WebGPU playground: heavy, translucent jelly dice and nine everyday objects (pine cone, gourd,
ginkgo leaf, acorn, pebble, apple, phone, little house, mushroom) that you can grab, stretch, poke and toss.
Chinese / English, adjustable colours, optional sound.

一个单文件 WebGPU 小实验：果冻骰子和九样日常小东西，可以抓、拉、戳、抛；中英文切换，颜色可调，声音可选。

## Open it

`index.html` is self-contained (no external requests). Open it in a browser with WebGPU — Chrome / Edge 113+
or Safari 26+ — by double-clicking or dragging it into the browser, or serve the folder locally, e.g.
`python3 -m http.server` and visit `http://127.0.0.1:8000/`. Without WebGPU or JavaScript the page explains
what is missing.

Useful URL parameters: `?lang=zh|en`, `?object=apple` (any object id), `?webgpu=off` (fallback preview).

## Controls

Drag an object to pull and stretch it, tap to poke, drag the background to orbit, pinch or ⌘/Ctrl-scroll to
zoom. `Space` or the toss button throws them again. Type an object name (中文 or English) to switch.

## Structure

| Path | What |
|---|---|
| `index.html` | The page (built from `src/v4-parts`) |
| `src/v4-parts/` | Sources: head/tail HTML, core, object library, soft-body physics, sound, WGSL shaders, renderer, app |
| `src/build.sh` | `zsh src/build.sh [out.html]` rebuilds `index.html` byte-for-byte (needs Node for the syntax check) |
| `src/harness/` | Development test scripts: Node physics runs and browser checks via the Chrome DevTools protocol |
| `checkpoints/` | Earlier versions, v1–v5 (`v5-embed-config.html` = current) |
| `DESIGN.md` | Design rules, colour and type tokens, visual mechanism, history |

## Technique, briefly

Procedural SDF shapes meshed with surface nets. Soft bodies are XPBD lattices, with the render mesh embedded
through tricubic Catmull-Rom interpolation in a compute pass. The material combines per-object thickness,
Beer–Lambert absorption, refraction of the backdrop, depth-graded in-scatter, coloured optical-depth shadows,
and SDF contact AO. The tone map keeps the paper colour exact.

No license file is included; all rights reserved unless one is added.

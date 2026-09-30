
// ============================================================================
// 8. CAMERA, PICKING, INPUT, UI, MAIN LOOP
// ============================================================================
const FLAVORS = [ // T1 = light transmitted through one world unit of candy (linear RGB)
  { name: { en: 'Emerald', zh: '翡翠' }, swatch: '#14A673', T1: [0.10, 0.62, 0.34], scatter: [0.018, 0.56, 0.21] },
  { name: { en: 'Amethyst', zh: '紫晶' }, swatch: '#9A5AD8', T1: [0.46, 0.15, 0.72], scatter: [0.31, 0.035, 0.58] },
  { name: { en: 'Amber', zh: '琥珀' }, swatch: '#EFA11C', T1: [0.95, 0.64, 0.07], scatter: [0.90, 0.46, 0.015] },
  { name: { en: 'Sapphire', zh: '蓝宝' }, swatch: '#2C6FE0', T1: [0.06, 0.28, 0.80], scatter: [0.012, 0.13, 0.64] },
  { name: { en: 'Ruby', zh: '红宝' }, swatch: '#D4203F', T1: [0.84, 0.035, 0.09], scatter: [0.82, 0.008, 0.03] },
  { name: { en: 'Lime', zh: '青柠' }, swatch: '#98CC1F', T1: [0.50, 0.85, 0.06], scatter: [0.36, 0.68, 0.01] },
];
const NATURAL = -1;   // palette index of the object's own colours ("本色")

/** Optional host-page configuration (an embedding page sets this before the module runs). */
const CONFIG = Object.assign({
  lang: null, langHref: null, strings: null, notes: null, storageKey: 'jelly.lang',
  embedded: false,   // true: the canvas lives inside a scrolling page (site page), not full screen
  root: null,        // selector of the embedded section (Space rolls only while focus is inside it)
  langLinks: null,   // selector of the site's language links; they keep the current object (?object=)
  title: null,       // (lang, objectName) => document title
  titleTemplate: null, // { zh, en } with {name}, e.g. "Jelly {name} · My site" (JSON-friendly)
}, window.JELLY_CONFIG || {});
const EMBED = !!CONFIG.embedded;
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------------------------------------------------------------- words
const I18N = {
  en: {
    eyebrow: 'The Soft Play Collection', jelly: 'Jelly', caption: ['A little luck.', 'A little wobble.', 'Very soft odds.'],
    hint: 'Tap to poke. Drag to pull. Let luck wobble.',
    result: 'Result', total: 'Total', rolling: 'Rolling', settling: 'Settling', settled: 'Settled', preparing: 'Preparing', unavailable: 'Unavailable',
    flavor: 'Flavor', natural: 'Natural', object: 'Object', countDice: 'Dice', count: 'Count',
    roll: 'Roll the dice', toss: 'Toss them', space: 'Space',
    settings: 'Settings', firmness: 'Firmness', damping: 'Internal damping',
    soundOn: 'Sound on', soundOff: 'Sound off', resetView: 'Reset view', langBtn: '中文', langLabel: '切换到中文',
    typePh: 'Type: apple, phone…', typeGo: 'Make it', surprise: 'Surprise me',
    notFound: (q, list) => `No “${q}” yet. Try ${list}.`, listJoin: ', ', listLast: ' or ',
    starting: 'Starting GPU', shapingDice: 'Shaping dice', compiling: 'Compiling shaders', shaping: 'Shaping',
    ready: 'WebGPU ready', noGpu: 'WebGPU unavailable', checking: 'Checking WebGPU…',
    canvas: 'Interactive 3D scene of translucent jelly objects. Drag one to pull it, tap to poke it, drag the background to orbit the camera.',
    controls: 'Jelly controls', objects: 'Objects', diceUnit: (n) => `${n} ${n === 1 ? 'die' : 'dice'}`, objUnit: (n) => `${n}`,
    resultDice: (v, t) => `Result: ${v.join(', ')}. Total ${t}.`, resultObj: (w, k, n, s) => `Result: ${w.join(', ')}. ${s}: ${k} of ${n}.`,
    fbTitle: 'Jelly Dice needs WebGPU.', fbHelp: 'Open this page in a current desktop Chrome or Edge, Safari 26 or newer, or another browser with WebGPU enabled. On Linux, Chrome may need chrome://flags/#enable-unsafe-webgpu.',
    fbStuck: (s) => `WebGPU did not finish starting (stuck at “${s}”). Reload the page, or open it in Chrome, Edge or Safari 26+.`,
    fbNoApi: 'This browser does not expose WebGPU (navigator.gpu is missing).', fbNoAdapter: 'No compatible GPU adapter was found — WebGPU may be disabled or blocklisted on this device.',
    fbDevice: (m) => `The GPU device could not be created (${m}).`, fbLost: (m) => `The GPU device was lost (${m}). Reload to restart.`, fbStart: (m) => `Jelly Dice could not start WebGPU: ${m}`,
  },
  zh: {
    eyebrow: '柔软游乐系列', jelly: '果冻', caption: ['一点运气。', '一点晃动。', '软软的概率。'],
    hint: '轻点戳一戳，拖动拉一拉，让运气晃一晃。',
    result: '结果', total: '合计', rolling: '抛出中', settling: '晃动中', settled: '已停稳', preparing: '准备中', unavailable: '不可用',
    flavor: '口味', natural: '本色', object: '物件', countDice: '骰子', count: '数量',
    roll: '掷骰子', toss: '抛一抛', space: '空格',
    settings: '设置', firmness: '硬度', damping: '内部阻尼',
    soundOn: '声音开', soundOff: '声音关', resetView: '重置视角', langBtn: 'EN', langLabel: 'Switch to English',
    typePh: '输入：苹果、手机…', typeGo: '变出来', surprise: '随便来一个',
    notFound: (q, list) => `还没有「${q}」。试试${list}。`, listJoin: '、', listLast: '或',
    starting: '启动 GPU', shapingDice: '塑形中', compiling: '编译着色器', shaping: '塑形中',
    ready: 'WebGPU 已就绪', noGpu: 'WebGPU 不可用', checking: '正在检查 WebGPU…',
    canvas: '可交互的半透明果冻物体三维场景。拖动物体可以拉伸，轻点可以戳一下，拖动背景可以旋转视角。',
    controls: '果冻控制面板', objects: '物件', diceUnit: (n) => `${n} 颗骰子`, objUnit: (n) => `${n} 个`,
    resultDice: (v, t) => `结果：${v.join('、')}，合计 ${t}。`, resultObj: (w, k, n, s) => `结果：${w.join('、')}。${n} 个里 ${k} 个${s}。`,
    fbTitle: '果冻骰子需要 WebGPU。', fbHelp: '请用新版桌面 Chrome 或 Edge、Safari 26 及以上版本打开，或在其他浏览器中开启 WebGPU。Linux 上的 Chrome 可能需要开启 chrome://flags/#enable-unsafe-webgpu。',
    fbStuck: (s) => `WebGPU 没有完成启动（停在“${s}”）。请刷新页面，或改用 Chrome、Edge、Safari 26 及以上版本打开。`,
    fbNoApi: '这个浏览器没有提供 WebGPU（缺少 navigator.gpu）。', fbNoAdapter: '没有找到可用的 GPU 适配器：这台设备上的 WebGPU 可能被关闭或列入了黑名单。',
    fbDevice: (m) => `无法创建 GPU 设备（${m}）。`, fbLost: (m) => `GPU 设备丢失（${m}），请刷新页面。`, fbStart: (m) => `果冻骰子无法启动 WebGPU：${m}`,
  },
};
if (CONFIG.strings) for (const l of ['en', 'zh']) Object.assign(I18N[l], CONFIG.strings[l] || {});

/** How an object ended up: short words for up / side / down, and the word that is counted. */
const LANDING = [
  null,
  { up: ['立着', 'Standing'], side: ['躺着', 'Lying'], down: ['倒立', 'Upside down'], count: ['立着', 'Standing'] },
  { up: ['立着', 'Standing'], side: ['躺着', 'Lying'], down: ['倒立', 'Upside down'], count: ['立着', 'Standing'] },
  { up: ['正面', 'Face up'], side: ['立着', 'On edge'], down: ['背面', 'Face down'], count: ['正面朝上', 'Face up'] },
  { up: ['立着', 'Standing'], side: ['躺着', 'Lying'], down: ['倒立', 'Upside down'], count: ['立着', 'Standing'] },
  { up: ['平躺', 'Flat'], side: ['立着', 'On edge'], down: ['翻面', 'Flipped'], count: ['平躺', 'Flat'] },
  { up: ['正立', 'Upright'], side: ['侧躺', 'On its side'], down: ['倒立', 'Upside down'], count: ['正立', 'Upright'] },
  { up: ['屏幕朝上', 'Screen up'], side: ['立着', 'On edge'], down: ['屏幕朝下', 'Screen down'], count: ['屏幕朝上', 'Screen up'] },
  { up: ['立着', 'Standing'], side: ['倒了', 'Toppled'], down: ['倒扣', 'Upside down'], count: ['立着', 'Standing'] },
  { up: ['立着', 'Standing'], side: ['倒了', 'Toppled'], down: ['倒扣', 'Upside down'], count: ['立着', 'Standing'] },
];

const $ = (s) => document.querySelector(s);
const canvas = $('#stage');
const ui = {
  brand: $('.brand'), eyebrow: $('#eyebrow'), title: $('#title'), caption: $('#caption'), controls: $('#controls'),
  status: $('#gpuStatus'), statusText: $('#gpuStatus .status-text'), sound: $('#soundBtn'), soundText: $('#soundBtn .sound-text'),
  lang: $('#langBtn'), langText: $('#langBtn .btn-text'), reset: $('#resetViewBtn'), resetText: $('#resetViewBtn .btn-text'),
  result: $('#result'), resultLabel: $('#resultLabel'), resultState: $('#resultState'), values: $('#resultValues'),
  totalLabel: $('#totalLabel'), total: $('#totalNum'),
  objLabel: $('#objLabel'), objects: $('#objects'), objForm: $('#objForm'), objInput: $('#objInput'), objGo: $('#objGo'),
  objShuffle: $('#objShuffle'), objMsg: $('#objMsg'),
  flavorLabel: $('#flavorLabel'), swatches: $('#swatches'), flavorName: $('#flavorName'),
  countLabel: $('#countLabel'), count: $('#countSeg'), roll: $('#rollBtn'), rollText: $('#rollBtn .roll-text'), rollKey: $('#rollBtn kbd'),
  settingsLabel: $('#settingsLabel'), firmness: $('#firmness'), firmnessLabel: $('#firmnessLabel'), firmnessOut: $('#firmnessOut'),
  damping: $('#damping'), dampingLabel: $('#dampingLabel'), dampingOut: $('#dampingOut'),
  hint: $('#hint'), fallback: $('#fallback'), fallbackTitle: $('#fallbackTitle'), fallbackReason: $('#fallbackReason'), fallbackHelp: $('#fallbackHelp'),
};

let physics = null, renderer = null;
const sound = new Sound();
const types = [];                                     // per object type: { geo, td (physics), gpu }
const slotType = new Int32Array(CFG.MAX_DICE);        // object type held by each slot
const app = {
  ready: false, last: 0, acc: 0, time: 0, fps: 60, frameMs: 0, physMs: 0, needResize: true,
  lang: 'en', type: 0, flavor: 0, userFlavor: false,
  mode: 'moving', still: 0, results: [], hover: null, rollCount: 0, busy: false,
  density: 2.3, scatterStrength: 0.55, exposure: 1.0, pipOpacity: 0.94, envIntensity: 1.0, debugView: 0,   // material look
  mat: new Float32Array(CFG.MAX_DICE * 24),           // per slot: sigB, scB, sigA, scA, sigS, scS (rgb + w), gliding
  matTarget: new Float32Array(CFG.MAX_DICE * 24),
  interp: new Float64Array(CFG.MAX_DICE * NP * 3),
};
const T = (k) => I18N[app.lang][k];
/** A message with arguments: built-in strings are functions; host overrides may use "{0}". */
const fmt = (k, ...a) => { const v = T(k); return typeof v === 'function' ? v(...a) : String(v).replace('{0}', a[0]); };
/** Layout scale of an object type: 1 for the die, larger for wide objects (leaf, pebble, phone). */
const typeScale = (t) => { const h = OBJECT_TYPES[t].half; return Math.max(1, Math.max(h[0], h[2], h[1] * 0.8) / 1.05); };
const objName = (t, lang = app.lang) => OBJECT_TYPES[t].names[lang];

// ---------------------------------------------------------------- camera
const NEAR = 0.5, FAR = 90, PITCH_MIN = 0.2, PITCH_MAX = 1.25;
const cam = {
  yaw: 0.42, pitch: 0.62, dist: 16, gyaw: 0.42, gpitch: 0.62, gdist: 16, base: 16,
  fovy: 30 * DEG, target: [0, 0.75, 0], lens: [0, 0], zoomMin: 0.72, zoomMax: 1.45,
  eye: [0, 0, 0], view: M4.create(), proj: M4.create(), viewProj: M4.create(), invViewProj: M4.create(),
};
const light = { view: M4.create(), proj: M4.create(), viewProj: M4.create(), near: 0.5, far: 60, dist: 25 };

function initLight() {
  const e = [LIGHT_DIR[0] * light.dist, LIGHT_DIR[1] * light.dist, LIGHT_DIR[2] * light.dist];
  M4.lookAt(light.view, e, [0, 0, 0], [0, 1, 0]);
  M4.ortho(light.proj, -CFG.SHADOW_HALF, CFG.SHADOW_HALF, -CFG.SHADOW_HALF, CFG.SHADOW_HALF, light.near, light.far);
  M4.mul(light.viewProj, light.proj, light.view);
}

function updateCamera(dt) {
  const k = 1 - Math.exp(-dt * 11);
  cam.yaw += (cam.gyaw - cam.yaw) * k;
  cam.pitch += (cam.gpitch - cam.pitch) * k;
  cam.dist += (cam.gdist - cam.dist) * k;
  const cp = Math.cos(cam.pitch);
  cam.eye[0] = cam.target[0] + cam.dist * Math.sin(cam.yaw) * cp;
  cam.eye[1] = cam.target[1] + cam.dist * Math.sin(cam.pitch);
  cam.eye[2] = cam.target[2] + cam.dist * Math.cos(cam.yaw) * cp;
  M4.lookAt(cam.view, cam.eye, cam.target, [0, 1, 0]);
  M4.perspective(cam.proj, cam.fovy, canvas.clientWidth / Math.max(1, canvas.clientHeight), NEAR, FAR, cam.lens[0], cam.lens[1]);
  M4.mul(cam.viewProj, cam.proj, cam.view);
  M4.invert(cam.invViewProj, cam.viewProj);
}
const camForward = () => norm3([cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]]);
const _gv = M4.create(), _gp = M4.create(), _gvp = M4.create();
/** CSS x of a world point for the camera's goal pose at distance `dist` (framing checks only). */
function goalScreenX(p, dist) {
  const cp = Math.cos(cam.gpitch), t = cam.target;
  const eye = [t[0] + dist * Math.sin(cam.gyaw) * cp, t[1] + dist * Math.sin(cam.gpitch), t[2] + dist * Math.cos(cam.gyaw) * cp];
  M4.lookAt(_gv, eye, t, [0, 1, 0]);
  M4.perspective(_gp, cam.fovy, canvas.clientWidth / Math.max(1, canvas.clientHeight), NEAR, FAR, cam.lens[0], cam.lens[1]);
  M4.mul(_gvp, _gp, _gv);
  const M = _gvp, x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
  return (x / w * 0.5 + 0.5) * canvas.clientWidth;
}

/** Frame the play area inside the part of the screen the UI leaves free (lens shift + distance). */
function layoutView() {
  if (EMBED) {
    const W = Math.max(1, canvas.clientWidth), H = Math.max(1, canvas.clientHeight), narrow = W <= 720;
    cam.fovy = (narrow && H > W ? 38 : 30) * DEG;
    cam.lens[0] = 0; cam.lens[1] = 0.03;
    const S = typeScale(app.type), tanY = Math.tan(cam.fovy / 2), tanX = tanY * W / H;
    const ratio = cam.gdist / cam.base;
    cam.base = Math.max((narrow ? 4.0 : 4.6) * S / (tanX * 0.94), 2.6 * S / (tanY * 0.82), 9);
    cam.gdist = clamp(cam.base * (Number.isFinite(ratio) ? ratio : 1), cam.base * cam.zoomMin, cam.base * cam.zoomMax);
    if (!app.ready) cam.dist = cam.gdist;
    return;
  }
  const W = innerWidth, H = innerHeight, mobile = W <= 720;
  cam.fovy = (mobile && H > W ? 38 : 30) * DEG;
  let top = 0, bottom = H;
  if (mobile) {
    top = ui.brand.getBoundingClientRect().bottom + 2;
    const sheetTop = ui.controls.getBoundingClientRect().top;
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(H - sheetTop)}px`);
    bottom = sheetTop - 30;
  }
  const cy = (top + bottom) / 2;
  // desktop: lift the trio a little and lean it away from the bottom-right control column
  // (narrower desktops: the control column takes a bigger share of the width, so lean further left)
  cam.lens[0] = mobile ? 0 : -0.045 - Math.max(0, (1300 - W) / 1300) * 0.36;
  cam.lens[1] = mobile ? (H / 2 - cy) / (H / 2) : 0.07;
  const hFrac = clamp((bottom - top) / H, 0.3, 1);
  const tanY = Math.tan(cam.fovy / 2), tanX = tanY * W / H;
  const wFrac = mobile ? 0.96 : 0.6 * clamp((W - 330) / 1000, 0.82, 1);
  const S = typeScale(app.type);
  const fitX = (mobile ? 4.1 : 4.7) * S / (tanX * wFrac);
  const fitY = 2.7 * S / (tanY * hFrac * (mobile ? 0.96 : 0.62));
  const ratio = cam.gdist / cam.base;
  cam.base = Math.max(fitX, fitY, 9);
  if (!mobile) { // step back until the outermost drop spot clears the control column (any desktop width)
    const { right, fwd } = camFloorBasis(), er = (2.8 + 1.05 + 0.35) * S, limit = ui.controls.getBoundingClientRect().left - 16;
    const edge = [right[0] * er + fwd[0] * 0.3 * S, 1.0 * S, right[2] * er + fwd[2] * 0.3 * S];
    for (let i = 0; i < 14 && goalScreenX(edge, cam.base) > limit; i++) cam.base *= 1.06;
  }
  cam.gdist = clamp(cam.base * (Number.isFinite(ratio) ? ratio : 1), cam.base * cam.zoomMin, cam.base * cam.zoomMax);
  if (!app.ready) cam.dist = cam.gdist;
}

function resize() {
  if (!renderer) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderer.resize(w, h);
  layoutView();
}

// ---------------------------------------------------------------- object types
/** Build (once) everything one object type needs: mesh + lattice, physics rest data, GPU ranges. */
function ensureType(t) {
  if (types[t]) return types[t];
  const geo = buildTypeGeometry(t);
  const td = physics.prepareType(geo);
  const gpu = renderer.uploadType(geo);
  types[t] = { geo, td, gpu, com: [...td.com], gridLo: geo.grid.lo, gridInv: geo.grid.inv };   // floor occlusion samples the type's SDF slab
  return types[t];
}

/** Target material of a slot: body / accent / stem as (absorption rgb, density) + (in-scatter rgb, strength). */
function materialTarget(slot) {
  const t = slotType[slot], O = OBJECT_TYPES[t], out = app.matTarget, o = slot * 24;
  const dens = app.density * (O.density || 1), strength = app.scatterStrength;
  const put = (k, T1, sc, deep) => {
    for (let c = 0; c < 3; c++) {
      out[o + k * 8 + c] = -Math.log(clamp(T1[c], 0.004, 0.999)) * deep;
      out[o + k * 8 + 4 + c] = sc[c] * (deep > 1 ? 1 / Math.sqrt(deep) : 1);
    }
    out[o + k * 8 + 3] = dens; out[o + k * 8 + 7] = strength;
  };
  if (app.flavor === NATURAL && O.natural) {
    const n = O.natural;
    put(0, n.body.slice(0, 3), n.body.slice(3), 1); put(1, n.accent.slice(0, 3), n.accent.slice(3), 1); put(2, n.stem.slice(0, 3), n.stem.slice(3), 1);
  } else {
    const F = FLAVORS[app.flavor === NATURAL ? 0 : app.flavor];
    put(0, F.T1, F.scatter, 1); put(1, F.T1, F.scatter, 1.7); put(2, F.T1, F.scatter, 2.5);
  }
}

// ---------------------------------------------------------------- picking
const _pe = new Float64Array(NEP * 3), _pP = new Float64Array(3);
let _pp = new Float64Array(3 * 4096);
function screenRay(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const nx = (cx - r.left) / r.width * 2 - 1, ny = 1 - (cy - r.top) / r.height * 2;
  const M = cam.invViewProj, unproj = (z) => {
    const x = M[0] * nx + M[4] * ny + M[8] * z + M[12], y = M[1] * nx + M[5] * ny + M[9] * z + M[13];
    const zz = M[2] * nx + M[6] * ny + M[10] * z + M[14], w = M[3] * nx + M[7] * ny + M[11] * z + M[15];
    return [x / w, y / w, zz / w];
  };
  const a = unproj(0), b = unproj(1);
  return { o: a, d: norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
}

/** Ray vs. the live deformed picking proxy of every object. Exact lattice coords of the hit. */
function pickDie(cx, cy) {
  const { o, d } = screenRay(cx, cy);
  let best = null;
  for (let s = 0; s < physics.count; s++) {
    const D = physics.dice[s];
    const ox = D.cm[0] - o[0], oy = D.cm[1] - o[1], oz = D.cm[2] - o[2], tca = ox * d[0] + oy * d[1] + oz * d[2];
    if (ox * ox + oy * oy + oz * oz - tca * tca > D.radius * D.radius) continue;
    const pr = types[slotType[s]].geo.proxy, U = pr.u, tris = pr.tris, n = U.length / 3;
    if (_pp.length < n * 3) _pp = new Float64Array(n * 3);
    extendNodes(physics.x, s * NP * 3, _pe, 0, 3);
    for (let i = 0; i < n; i++) { crEval(_pe, 0, 3, U[i * 3], U[i * 3 + 1], U[i * 3 + 2], _pP, null); _pp[i * 3] = _pP[0]; _pp[i * 3 + 1] = _pP[1]; _pp[i * 3 + 2] = _pP[2]; }
    const before = best;
    for (let k = 0; k < tris.length; k += 3) { // Möller–Trumbore
      const i0 = tris[k], i1 = tris[k + 1], i2 = tris[k + 2], a = i0 * 3, b = i1 * 3, c = i2 * 3;
      const e1x = _pp[b] - _pp[a], e1y = _pp[b + 1] - _pp[a + 1], e1z = _pp[b + 2] - _pp[a + 2];
      const e2x = _pp[c] - _pp[a], e2y = _pp[c + 1] - _pp[a + 1], e2z = _pp[c + 2] - _pp[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = o[0] - _pp[a], ty = o[1] - _pp[a + 1], tz = o[2] - _pp[a + 2];
      const bu = (tx * px + ty * py + tz * pz) * inv;
      if (bu < 0 || bu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const bv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (bv < 0 || bu + bv > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 0 && (!best || t < best.t)) {
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (nx * d[0] + ny * d[1] + nz * d[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }   // face the viewer
        best = { slot: s, t, i0, i1, i2, bu, bv, n: norm3([nx, ny, nz]), U };
      }
    }
    if (best !== before) best.world = [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
  }
  if (!best) return null;
  const w0 = 1 - best.bu - best.bv, u = [0, 0, 0], U = best.U;
  for (let k = 0; k < 3; k++) u[k] = w0 * U[best.i0 * 3 + k] + best.bu * U[best.i1 * 3 + k] + best.bv * U[best.i2 * 3 + k];
  const rest = new Float64Array(3);
  crEval(types[slotType[best.slot]].geo.restExt, 0, 3, u[0], u[1], u[2], rest, null);
  return { slot: best.slot, u, world: best.world, normal: best.n, rest };
}

function project(p) { // world → CSS px (tests + result ordering)
  const M = cam.viewProj, x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13];
  const w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
  return [(x / w * 0.5 + 0.5) * canvas.clientWidth, (0.5 - y / w * 0.5) * canvas.clientHeight];
}

// ---------------------------------------------------------------- input
const pointers = new Map();
let gesture = null;

function rayPlane(cx, cy, p0, n) {
  const { o, d } = screenRay(cx, cy), den = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((p0[0] - o[0]) * n[0] + (p0[1] - o[1]) * n[1] + (p0[2] - o[2]) * n[2]) / den;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

function finishGrab(allowPoke) {
  const g = gesture;
  gesture = null;
  canvas.classList.remove('grabbing');
  const stretch = physics.endGrab();
  if (!g || g.type !== 'grab') return;
  const quick = performance.now() - g.t0 < 260 && g.moved < 8;
  if (allowPoke && quick) {
    physics.poke(g.hit.slot, g.hit.u, g.hit.normal, 3.4);
    sound.play('poke', 0.6, 'poke' + g.hit.slot);
  } else {
    const s = clamp((stretch - 1.06) / 0.55, 0, 1);
    if (s > 0.04) sound.play('release', s, 'release' + g.hit.slot);
  }
  markMoving();
}

canvas.addEventListener('pointerdown', (e) => {
  if (!app.ready) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone: keep going without capture */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) { // second finger: pinch-zoom / two-finger orbit, never a grab
    if (gesture && gesture.type === 'grab') finishGrab(false);
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', span: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    return;
  }
  if (e.button === 1 || e.button === 2) { gesture = { type: 'orbit', x: e.clientX, y: e.clientY }; canvas.classList.add('orbiting'); return; }
  if (e.button !== 0) return;
  const hit = pickDie(e.clientX, e.clientY);
  if (hit) {
    physics.beginGrab(hit.slot, hit.u, hit.rest, hit.world);
    gesture = { type: 'grab', id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0, hit, planeN: camForward() };
    canvas.classList.add('grabbing');
    markMoving();
  } else {
    gesture = { type: 'orbit', x: e.clientX, y: e.clientY };
    canvas.classList.add('orbiting');
  }
});

canvas.addEventListener('pointermove', (e) => {
  const pt = pointers.get(e.pointerId);
  if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
  if (!gesture) { if (e.pointerType === 'mouse') app.hover = [e.clientX, e.clientY]; return; }
  if (gesture.type === 'grab' && e.pointerId === gesture.id) {
    gesture.moved = Math.max(gesture.moved, Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0));
    const p = rayPlane(e.clientX, e.clientY, gesture.hit.world, gesture.planeN);
    if (p) physics.setGrabTarget(p);
  } else if (gesture.type === 'orbit') {
    cam.gyaw -= (e.clientX - gesture.x) * 0.0062;
    cam.gpitch = clamp(cam.gpitch + (e.clientY - gesture.y) * 0.0048, PITCH_MIN, PITCH_MAX);
    gesture.x = e.clientX; gesture.y = e.clientY;
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const span = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.gdist = clamp(cam.gdist * gesture.span / span, cam.base * cam.zoomMin, cam.base * cam.zoomMax);
    cam.gyaw -= (mx - gesture.mx) * 0.0062;
    cam.gpitch = clamp(cam.gpitch + (my - gesture.my) * 0.0048, PITCH_MIN, PITCH_MAX);
    gesture.span = span; gesture.mx = mx; gesture.my = my;
  }
});

function pointerEnd(e) {
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.type === 'grab' && e.pointerId === gesture.id) finishGrab(e.type === 'pointerup');
  else if (gesture.type === 'orbit' && pointers.size === 0) { gesture = null; canvas.classList.remove('orbiting'); }
  else if (gesture.type === 'pinch' && pointers.size < 2) gesture = null;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) pointerEnd(e); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', () => { app.hover = null; canvas.classList.remove('can-grab'); });
canvas.addEventListener('wheel', (e) => {
  if (EMBED && !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  cam.gdist = clamp(cam.gdist * Math.exp(e.deltaY * 0.0011), cam.base * cam.zoomMin, cam.base * cam.zoomMax);
}, { passive: false });

const typingTarget = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
const jellyRoot = CONFIG.root ? document.querySelector(CONFIG.root) : null;
const spaceIsOurs = () => !EMBED || (jellyRoot && jellyRoot.contains(document.activeElement));
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || typingTarget(e.target) || !spaceIsOurs()) return;
  e.preventDefault();                       // no page scroll, no double-activation of a focused button
  if (!e.repeat) roll();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && !typingTarget(e.target) && spaceIsOurs()) e.preventDefault(); });
window.addEventListener('resize', () => { app.needResize = true; });

// ---------------------------------------------------------------- actions
function faceUpQuat(face, yaw) {
  const q1 = quatFromTo(FACES[face].n, [0, 1, 0], [0, 0, 0, 1]);
  const q2 = quatAxisAngle(0, 1, 0, yaw, [0, 0, 0, 1]);
  return quatMul(q2, q1, [0, 0, 0, 1]);
}
const narrowStage = () => (EMBED ? canvas.clientWidth : innerWidth) <= 720;
const overlayZones = () => !EMBED && innerWidth > 720;   // full-screen layout: heading + control column float over the stage
function camFloorBasis() {
  const s = Math.sin(cam.gyaw), c = Math.cos(cam.gyaw);
  return { right: [c, 0, -s], fwd: [-s, 0, -c] };
}
/** Well-separated floor points inside the framed area (camera-relative). */
function pickSpots(n, avoid = [], minSep = 2.7) {
  const S = typeScale(app.type), { right, fwd } = camFloorBasis(), halfW = (narrowStage() ? 2.3 : 3.8) * S;
  const out = [];
  minSep *= S;
  for (let s = 0; s < n; s++) {
    let best = null, bestD = -1;
    for (let k = 0; k < 50; k++) {
      const a = (Math.random() * 2 - 1) * halfW, b = lerp(-1.5, 2.2, Math.random()) * S;
      if (overlayZones() && ((a < -1.9 * S && b > 1.1 * S) || (a > 1.6 * S && b < -0.2 * S))) continue;   // heading / control column zones
      const p = [a * right[0] + b * fwd[0], 0, a * right[2] + b * fwd[2]];
      let md = Infinity;
      for (const q of out.concat(avoid)) md = Math.min(md, Math.hypot(p[0] - q[0], p[2] - q[2]));
      if (md > minSep) { best = p; break; }
      if (md > bestD) { bestD = md; best = p; }
    }
    out.push(best);
  }
  return out;
}

/**
 * Landing spots for a toss: each object hops 1–2.5 units from where it is (biased toward the
 * centre of the view), spots stay inside the framed area and apart from each other.
 */
function tossTargets(n) {
  const S = typeScale(app.type), { right, fwd } = camFloorBasis(), halfW = (narrowStage() ? 2.3 : 3.8) * S, out = [];
  for (let s = 0; s < n; s++) {
    const c = physics.dice[s].cm;
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 60; k++) {
      const ang = Math.random() * Math.PI * 2, r = (1.0 + Math.random() * 1.5) * S;
      const p = [c[0] * 0.45 + Math.cos(ang) * r, 0, c[2] * 0.45 + Math.sin(ang) * r];
      const a = p[0] * right[0] + p[2] * right[2], b = p[0] * fwd[0] + p[2] * fwd[2];
      if (Math.abs(a) > halfW || b < -1.6 * S || b > 2.3 * S) continue;
      if (overlayZones() && ((a > 1.6 * S && b < -0.2 * S) || (a < -1.9 * S && b > 1.1 * S))) continue;   // control column / heading zones
      let md = 9 * S;
      for (const q of out) md = Math.min(md, Math.hypot(p[0] - q[0], p[2] - q[2]));
      const score = Math.min(md, 3.4 * S) - Math.abs(a) * 0.05;
      if (score > bestScore) { bestScore = score; best = p; }
      if (md > 3.1 * S) break;
    }
    out.push(best || [c[0] * 0.5, 0, c[2] * 0.5]);
  }
  return out;
}

function roll() {
  if (!app.ready || app.busy) return;
  if (gesture && gesture.type === 'grab') finishGrab(false);
  physics.endGrab();
  const n = physics.count, targets = tossTargets(n);
  for (let s = 0; s < n; s++) {
    const delay = s * (0.045 + Math.random() * 0.035);
    const tf = 0.6 + Math.random() * 0.16;
    const ax = norm3([Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.45, Math.random() * 2 - 1]);
    const w = 5.5 + Math.random() * 4.5;   // ~0.7–1.3 turns in the air: random, but lands heavy
    physics.schedule(s, delay, () => physics.toss(s, targets[s], tf, [ax[0] * w, ax[1] * w, ax[2] * w]));
    sound.play('toss', 0.6, 'toss' + s, delay);
  }
  app.rollCount++;
  setMode('rolling');
}

/** Drop a fresh object of the current type into slot s, a little above spot p. */
function dropInto(s, p, k = 0) {
  const t = app.type, O = OBJECT_TYPES[t];
  slotType[s] = t;
  materialTarget(s); app.mat.set(app.matTarget.subarray(s * 24, s * 24 + 24), s * 24);
  const lift = REDUCED ? types[t].td.com[1] - (O.center[1] - O.half[1]) + 0.02 : Math.max(...O.half) + 0.7 + k * 0.35;
  const q = REDUCED ? quatAxisAngle(0, 1, 0, Math.random() * Math.PI * 2, [0, 0, 0, 1]) : t === 0 ? randomQuat(Math.random)
    : quatMul(quatAxisAngle(0, 1, 0, Math.random() * Math.PI * 2, [0, 0, 0, 1]), quatAxisAngle(Math.random() - 0.5, 0, Math.random() - 0.5, (Math.random() - 0.5) * 0.9, [0, 0, 0, 1]), [0, 0, 0, 1]);
  physics.spawn(s, [p[0], lift, p[2]], q, REDUCED ? [0, 0, 0] : [0, -1.5, 0],
    REDUCED ? [0, 0, 0] : [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3], types[t].td);
}

function setCount(n) {
  n = clamp(n | 0, 1, CFG.MAX_DICE);
  const old = physics.count;
  if (n === old) return;
  if (n > old) {
    const avoid = [];
    for (let s = 0; s < old; s++) avoid.push([physics.dice[s].cm[0], 0, physics.dice[s].cm[2]]);
    const spots = pickSpots(n - old, avoid, 2.6);
    for (let s = old; s < n; s++) dropInto(s, spots[s - old], s - old);
  } else if (gesture && gesture.type === 'grab' && gesture.hit.slot >= n) { gesture = null; canvas.classList.remove('grabbing'); }
  physics.setCount(n);
  for (const b of ui.count.children) b.setAttribute('aria-checked', String(Number(b.dataset.n) === n));
  markMoving();
}

/** Switch every slot to object type t (built on first use), dropped in where the old ones were. */
async function setType(t) {
  if (!app.ready || app.busy || t < 0 || t >= OBJECT_TYPES.length) return;
  if (t === app.type) { roll(); return; }
  if (gesture && gesture.type === 'grab') finishGrab(false);
  physics.endGrab();
  if (!types[t]) {
    app.busy = true;
    ui.resultState.textContent = T('shaping');
    document.body.classList.add('shaping');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));   // let the state paint first
    try { ensureType(t); } finally { app.busy = false; document.body.classList.remove('shaping'); }
  }
  app.type = t;
  if (!app.userFlavor) app.flavor = OBJECT_TYPES[t].natural ? NATURAL : 0;
  layoutView();                                   // reframe for this object's size (the camera glides)
  const n = physics.count, spots = layoutSpots(n);
  for (let s = 0; s < n; s++) dropInto(s, spots[s], s);
  physics.pending = [];
  app.results = [];
  renderTypeUI(); renderFlavorUI();
  setMode('moving');
  markMoving();
  try { const u = new URL(location.href); u.searchParams.set('object', OBJECT_TYPES[t].id); history.replaceState(null, '', u); } catch { /* file:// or sandboxed: fine */ }
}

function setFlavor(i, byUser = true) {
  app.flavor = i;
  if (byUser) app.userFlavor = i !== NATURAL;
  for (let s = 0; s < CFG.MAX_DICE; s++) if (types[slotType[s]]) materialTarget(s);
  renderFlavorUI();
}

/** Calm, framed drop spots for n objects: the curated trio, plus free spots for a 4th and 5th. */
function layoutSpots(n) {
  const { right, fwd } = camFloorBasis(), k = (narrowStage() ? 0.84 : 1) * typeScale(app.type);
  const L = n === 1 ? [[0.05, -0.3]] : n === 2 ? [[-1.6, 0.0], [1.7, -0.2]] : [[-2.75, 0.15], [0.05, -0.6], [2.8, 0.3]];
  const out = L.map(([a, b]) => [(a * right[0] + b * fwd[0]) * k, 0, (a * right[2] + b * fwd[2]) * k]);
  return n > 3 ? out.concat(pickSpots(n - 3, out, 2.6)) : out;
}

/** A calm, curated opening: three dice dropped gently in a fixed arrangement (deterministic). */
function spawnInitial() {
  const { right, fwd } = camFloorBasis(), L = [[-2.75, 0.15], [0.05, -0.6], [2.8, 0.3]];
  const k = narrowStage() ? 0.84 : 1;                      // a slightly tighter trio on phones
  if (app.type === 0) {
    const faces = [2, 4, 0], yaws = [0.35, -0.28, 0.12];   // shows 3 · 1 · 2 on top
    for (let s = 0; s < 3; s++) {
      const a = L[s][0] * k, b = L[s][1] * k;
      slotType[s] = 0; materialTarget(s); app.mat.set(app.matTarget.subarray(s * 24, s * 24 + 24), s * 24);
      physics.spawn(s, [a * right[0] + b * fwd[0], REDUCED ? CFG.H + 0.04 : CFG.H + 0.55 + s * 0.28, a * right[2] + b * fwd[2]],
        faceUpQuat(faces[s], yaws[s] + cam.gyaw), [0, 0, 0], [0, 0, 0], types[0].td);
    }
  } else {
    for (let s = 0; s < 3; s++) dropInto(s, [L[s][0] * k * right[0] + L[s][1] * k * fwd[0], 0, L[s][0] * k * right[2] + L[s][1] * k * fwd[2]], s);
  }
  physics.setCount(3);
}

/** Site language links keep the current object, so switching language keeps what is on the table. */
function updateLangLinks() {
  if (!CONFIG.langLinks) return;
  for (const a of document.querySelectorAll(CONFIG.langLinks)) {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (app.type === 0) u.searchParams.delete('object'); else u.searchParams.set('object', OBJECT_TYPES[app.type].id);
      a.setAttribute('href', u.pathname + u.search + u.hash);
    } catch { /* leave the link as it is */ }
  }
}

/** Typed text → object. Chinese or English, any case; unknown words get a friendly nudge. */
function submitObject(text) {
  const q = String(text || '').trim();
  if (!q) return;
  const t = matchObject(q);
  if (t >= 0) { ui.objMsg.textContent = ''; ui.objInput.value = ''; setType(t); return; }
  const picks = [6, 7, 9].map((i) => objName(i));
  const list = picks.slice(0, -1).join(T('listJoin')) + T('listLast') + picks[picks.length - 1];
  ui.objMsg.textContent = T('notFound')(q.slice(0, 24), list);
}

// ---------------------------------------------------------------- results & UI state
function markMoving() { if (app.mode === 'settled') setMode('moving'); app.still = 0; }

function setMode(mode) {
  app.mode = mode;
  ui.result.dataset.mode = mode;
  if (mode === 'rolling') ui.resultState.innerHTML = `${T('rolling')}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
  else if (mode === 'moving') ui.resultState.textContent = T('settling');
  else ui.resultState.textContent = T('settled');
}

/** How an object rests: its rest "up" axis against world up. */
function landing(s) {
  const up = physics.dice[s].R[4];
  return up > 0.7 ? 'up' : up < -0.7 ? 'down' : 'side';
}

function renderResults() {
  const li = app.lang === 'zh' ? 0 : 1, rs = app.results;
  if (!rs.length) { ui.values.replaceChildren(); ui.total.textContent = '–'; return; }
  if (rs[0].type === 0 && rs.every((r) => r.type === 0)) {
    const total = rs.reduce((t, r) => t + r.value, 0);
    ui.totalLabel.textContent = T('total');
    ui.values.replaceChildren(...rs.map((r, k) => {
      const el = document.createElement('span');
      el.className = 'value'; el.textContent = r.value; el.style.animationDelay = `${k * 60}ms`;
      return el;
    }));
    ui.total.textContent = String(total);
    ui.result.setAttribute('aria-label', T('resultDice')(rs.map((r) => r.value), total));
  } else {
    const W = LANDING[rs[0].type] || LANDING[6], words = rs.map((r) => (LANDING[r.type] || W)[r.state][li]);
    const k = rs.filter((r) => r.state === 'up').length;
    ui.totalLabel.textContent = W.count[li];
    ui.values.replaceChildren(...words.map((w, i) => {
      const el = document.createElement('span');
      el.className = 'value word'; el.textContent = w; el.style.animationDelay = `${i * 60}ms`;
      return el;
    }));
    ui.total.replaceChildren(document.createTextNode(String(k)), Object.assign(document.createElement('em'), { textContent: `/${rs.length}` }));
    ui.result.setAttribute('aria-label', T('resultObj')(words, k, rs.length, W.count[li]));
  }
}

function updateSettle(dt) {
  let moving = !!physics.grab || physics.pending.length > 0 || app.busy;
  for (let s = 0; s < physics.count && !moving; s++) {
    const D = physics.dice[s];
    if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) moving = true;
  }
  if (moving) { app.still = 0; if (app.mode === 'settled') setMode('moving'); return; }
  app.still += dt;
  if (app.still > 0.45 && app.mode !== 'settled') {
    app.results = [];
    for (let s = 0; s < physics.count; s++) {
      const t = slotType[s], x = project(physics.dice[s].cm)[0];
      if (t === 0) { const r = physics.upFace(s); app.results.push({ slot: s, type: 0, value: r.value, confidence: r.confidence, x }); }
      else app.results.push({ slot: s, type: t, state: landing(s), x });
    }
    app.results.sort((a, b) => a.x - b.x);           // read left to right, like the table
    renderResults();
    setMode('settled');
  }
}

// ---------------------------------------------------------------- language & static UI
function detectLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  if (CONFIG.lang === 'zh' || CONFIG.lang === 'en') return CONFIG.lang;
  if (CONFIG.storageKey) try { const s = localStorage.getItem(CONFIG.storageKey); if (s === 'zh' || s === 'en') return s; } catch { /* storage blocked */ }
  return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
}

function renderTypeUI() {
  const t = app.type, isDie = t === 0, O = OBJECT_TYPES[t];
  const name = objName(t), num = String(t + 1).padStart(2, '0');
  const stop = app.lang === 'zh' ? '。' : '.';
  ui.title.replaceChildren(...[T('jelly'), name + stop].map((s) => Object.assign(document.createElement('span'), { textContent: s })));
  ui.eyebrow.replaceChildren(document.createTextNode(T('eyebrow')), Object.assign(document.createElement('span'), { className: 'sep', textContent: '/' }), document.createTextNode(num));
  const tt = CONFIG.titleTemplate && CONFIG.titleTemplate[app.lang];
  document.title = CONFIG.title ? CONFIG.title(app.lang, name) : tt ? tt.replace("{name}", name) : app.lang === 'zh' ? `果冻${name} · ${T('eyebrow')}` : `Jelly ${name}`;
  updateLangLinks();
  ui.countLabel.textContent = isDie ? T('countDice') : T('count');
  ui.rollText.textContent = isDie ? T('roll') : T('toss');
  for (const b of ui.objects.children) {
    const i = Number(b.dataset.t);
    b.textContent = OBJECT_TYPES[i].names[app.lang];
    b.setAttribute('aria-checked', String(i === t));
  }
  for (const b of ui.count.children) b.setAttribute('aria-label', (isDie ? T('diceUnit') : T('objUnit'))(Number(b.dataset.n)));
  const note = CONFIG.notes === true ? O.note : CONFIG.notes && CONFIG.notes[O.id];
  const gap = app.lang === 'zh' ? '' : ' ';
  ui.caption.replaceChildren(...(note ? [note[app.lang] || note.en] : T('caption')).flatMap((line, i, a) => (i < a.length - 1 ? [line + gap, document.createElement('br')] : [line])));
  ui.swatches.classList.toggle('has-natural', !!O.natural);
  const nat = ui.swatches.querySelector('.swatch.natural');
  if (nat && O.natural) {
    const hex = (c) => `rgb(${c.slice(0, 3).map((v) => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2) * 0.92)).join(',')})`;
    nat.style.setProperty('--c', `linear-gradient(135deg, ${hex(O.natural.body)} 0 55%, ${hex(O.natural.accent)} 55% 100%)`);
  }
  if (app.results.length && app.mode === 'settled') renderResults();
}

function renderFlavorUI() {
  const f = app.flavor, O = OBJECT_TYPES[app.type];
  const nat = f === NATURAL && O.natural;
  ui.flavorName.textContent = nat ? T('natural') : FLAVORS[f === NATURAL ? 0 : f].name[app.lang];
  document.documentElement.style.setProperty('--flavor', nat ? '#8A6A3A' : FLAVORS[f === NATURAL ? 0 : f].swatch);
  for (const b of ui.swatches.querySelectorAll('.swatch')) b.setAttribute('aria-checked', String(Number(b.dataset.f) === (nat ? NATURAL : (f === NATURAL ? 0 : f))));
}

function applyLang(lang, persist = false) {
  app.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (persist && CONFIG.storageKey) try { localStorage.setItem(CONFIG.storageKey, lang); } catch { /* storage blocked: fine */ }
  canvas.setAttribute('aria-label', T('canvas'));
  ui.controls.setAttribute('aria-label', T('controls'));
  ui.resultLabel.textContent = T('result');
  if (!app.results.length) ui.totalLabel.textContent = T('total');
  ui.objLabel.textContent = T('object');
  ui.objects.setAttribute('aria-label', T('objects'));
  ui.objInput.placeholder = T('typePh'); ui.objInput.setAttribute('aria-label', T('typePh'));
  ui.objGo.textContent = T('typeGo'); ui.objShuffle.textContent = T('surprise'); ui.objMsg.textContent = '';
  ui.flavorLabel.textContent = T('flavor');
  for (const b of ui.swatches.querySelectorAll('.swatch')) {
    const f = Number(b.dataset.f), nm = f === NATURAL ? T('natural') : FLAVORS[f].name[lang];
    b.setAttribute('aria-label', nm); b.title = nm;
  }
  ui.rollKey.textContent = T('space');
  ui.settingsLabel.textContent = T('settings'); ui.firmnessLabel.textContent = T('firmness'); ui.dampingLabel.textContent = T('damping');
  ui.soundText.textContent = sound.on ? T('soundOn') : T('soundOff');
  ui.resetText.textContent = T('resetView'); ui.reset.setAttribute('aria-label', T('resetView'));
  ui.langText.textContent = T('langBtn'); ui.lang.setAttribute('aria-label', T('langLabel')); ui.lang.lang = lang === 'zh' ? 'en' : 'zh-CN';
  ui.hint.textContent = T('hint');
  ui.fallbackTitle.textContent = T('fbTitle'); ui.fallbackHelp.textContent = T('fbHelp');
  if (app.ready) ui.status.title = T('ready');
  renderTypeUI(); renderFlavorUI();
  if (app.ready) setMode(app.mode); else ui.resultState.textContent = app.stageKey ? T(app.stageKey) : T('preparing');
}

function buildUI() {
  const mk = (tag, props) => Object.assign(document.createElement(tag), props);
  const nat = mk('button', { type: 'button', className: 'swatch natural' });
  nat.dataset.f = String(NATURAL); nat.setAttribute('role', 'radio');
  nat.addEventListener('click', () => setFlavor(NATURAL));
  ui.swatches.insertBefore(nat, ui.flavorName);
  FLAVORS.forEach((f, i) => {
    const b = mk('button', { type: 'button', className: 'swatch' });
    b.dataset.f = String(i); b.setAttribute('role', 'radio'); b.style.setProperty('--c', f.swatch);
    b.addEventListener('click', () => setFlavor(i));
    ui.swatches.insertBefore(b, ui.flavorName);
  });
  OBJECT_TYPES.forEach((O, i) => {
    const b = mk('button', { type: 'button', className: 'chip' });
    b.dataset.t = String(i); b.setAttribute('role', 'radio');
    b.addEventListener('click', () => setType(i));
    ui.objects.appendChild(b);
  });
  ui.objForm.addEventListener('submit', (e) => { e.preventDefault(); submitObject(ui.objInput.value); });
  ui.objShuffle.addEventListener('click', () => {
    let t = app.type;
    while (t === app.type) t = Math.floor(Math.random() * OBJECT_TYPES.length);
    setType(t);
  });
  for (let n = 1; n <= CFG.MAX_DICE; n++) {
    const b = mk('button', { type: 'button', textContent: String(n) });
    b.dataset.n = String(n); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(n === 3));
    b.addEventListener('click', () => { if (app.ready && !app.busy) setCount(n); });
    ui.count.appendChild(b);
  }
  ui.roll.addEventListener('click', () => roll());
  ui.reset.addEventListener('click', () => { cam.gyaw = 0.42; cam.gpitch = 0.62; cam.gdist = cam.base; });
  ui.sound.addEventListener('click', async () => {
    if (sound.on) { sound.disable(); }
    else { await sound.enable(); if (sound.on) sound.play('poke', 0.35, 'ui'); }
    ui.sound.setAttribute('aria-pressed', String(sound.on));
    ui.soundText.textContent = sound.on ? T('soundOn') : T('soundOff');
  });
  ui.lang.addEventListener('click', () => {
    const next = app.lang === 'zh' ? 'en' : 'zh';
    if (CONFIG.langHref && CONFIG.langHref[next]) { // a site page with one URL per language
      const u = new URL(CONFIG.langHref[next], location.href);
      u.searchParams.set('object', OBJECT_TYPES[app.type].id);
      location.href = u.href;
      return;
    }
    applyLang(next, true);
    try { const u = new URL(location.href); u.searchParams.set('lang', next); history.replaceState(null, '', u); } catch { /* fine */ }
  });
  const bindSlider = (input, out, apply) => {
    const upd = () => { out.textContent = input.value; apply(Number(input.value) / 100); };
    input.addEventListener('input', upd);
    upd();
  };
  bindSlider(ui.firmness, ui.firmnessOut, (v) => { if (physics) { physics.firmness = v; physics.applySettings(); } });
  bindSlider(ui.damping, ui.dampingOut, (v) => { if (physics) { physics.dampingAmt = v; physics.applySettings(); } });
  // the phone sheet changes height with language, results and the settings drawer: keep the framing in step
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { app.needResize = true; });
    ro.observe(ui.controls);
    if (EMBED) ro.observe(canvas);
  }
  if (EMBED && window.IntersectionObserver) new IntersectionObserver((es) => { app.visible = es[es.length - 1].isIntersecting; }).observe(canvas);
}

function fail(reason) {
  if (document.body.classList.contains('no-gpu')) return;   // first failure wins
  document.body.classList.add('no-gpu');
  ui.fallback.hidden = false;
  ui.fallbackReason.textContent = reason;
  ui.status.dataset.state = 'error';
  ui.status.title = reason;
  ui.statusText.textContent = T('noGpu');
  ui.resultState.textContent = T('unavailable');
  ui.roll.disabled = true;
  app.ready = false;
}

// ---------------------------------------------------------------- frame
function handleImpacts() {
  for (let s = 0; s < physics.count; s++) {
    const D = physics.dice[s];
    if (D.floorImpact > 1.3) sound.play('land', (D.floorImpact - 1.3) / 9, 'land' + s);
    if (D.diceImpact > 1.1) sound.play('clack', (D.diceImpact - 1.1) / 7, 'clack' + s);
  }
}

// Per-frame scratch (no allocations in the render loop).
const _order = [], _rects = new Array(CFG.MAX_DICE).fill(null), _depth = new Float64Array(CFG.MAX_DICE);
const _rectStore = Array.from({ length: CFG.MAX_DICE }, () => [0, 0, 0, 0]);
const _slotGpu = new Array(CFG.MAX_DICE).fill(null);
/** Screen rectangle (px) covering an object's world AABB — the region copied as its backdrop. */
function dieRect(out, minx, miny, minz, maxx, maxy, maxz, W, H) {
  const M = cam.viewProj;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const cx = k & 1 ? maxx : minx, cy = k & 2 ? maxy : miny, cz = k & 4 ? maxz : minz;
    const x = M[0] * cx + M[4] * cy + M[8] * cz + M[12];
    const y = M[1] * cx + M[5] * cy + M[9] * cz + M[13];
    const w = M[3] * cx + M[7] * cy + M[11] * cz + M[15];
    if (w < 0.05) { out[0] = 0; out[1] = 0; out[2] = W; out[3] = H; return out; }
    const sx = (x / w * 0.5 + 0.5) * W, sy = (0.5 - y / w * 0.5) * H;
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  const pad = 8 + H * 0.012;
  out[0] = Math.max(0, Math.floor(x0 - pad)); out[1] = Math.max(0, Math.floor(y0 - pad));
  out[2] = Math.min(W, Math.ceil(x1 + pad)); out[3] = Math.min(H, Math.ceil(y1 + pad));
  return out[2] - out[0] >= 2 && out[3] - out[1] >= 2 ? out : null;
}

function drawFrame(alpha) {
  const n = physics.count, X = physics.x, XS = physics.xs, I = app.interp, n3 = n * NP * 3, m = physics.m;
  for (let i = 0; i < n3; i++) I[i] = XS[i] + (X[i] - XS[i]) * alpha;
  for (let s = 0; s < n; s++) _slotGpu[s] = types[slotType[s]].gpu;
  renderer.uploadNodes(I, n, _slotGpu);
  const W = renderer.w, H = renderer.h, dd = renderer.dieData;
  const fx = cam.target[0] - cam.eye[0], fy = cam.target[1] - cam.eye[1], fz = cam.target[2] - cam.eye[2];
  _order.length = 0;
  for (let s = 0; s < n; s++) {
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < NP; i++) {
      const o = (s * NP + i) * 3, x = I[o], y = I[o + 1], z = I[o + 2], mi = m[s * NP + i];
      cx += mi * x; cy += mi * y; cz += mi * z;   // mass centre (masses sum to 1)
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const D = physics.dice[s], R = D.R, o = s * DIE_FLOATS, ty = types[slotType[s]];
    dd[o] = cx; dd[o + 1] = cy; dd[o + 2] = cz; dd[o + 3] = D.radius;
    dd[o + 4] = R[0]; dd[o + 5] = R[3]; dd[o + 6] = R[6]; dd[o + 7] = ty.gridInv[0];
    dd[o + 8] = R[1]; dd[o + 9] = R[4]; dd[o + 10] = R[7]; dd[o + 11] = ty.gridInv[1];
    dd[o + 12] = R[2]; dd[o + 13] = R[5]; dd[o + 14] = R[8]; dd[o + 15] = ty.gridInv[2];
    const r = dieRect(_rectStore[s], minx, miny, minz, maxx, maxy, maxz, W, H);
    _rects[s] = r;
    if (r) { dd[o + 16] = r[0]; dd[o + 17] = r[1]; dd[o + 18] = r[2]; dd[o + 19] = r[3]; }
    dd[o + 20] = ty.com[0]; dd[o + 21] = ty.com[1]; dd[o + 22] = ty.com[2]; dd[o + 23] = 0;
    dd[o + 24] = ty.gridLo[0]; dd[o + 25] = ty.gridLo[1]; dd[o + 26] = ty.gridLo[2]; dd[o + 27] = slotType[s];
    dd.set(app.mat.subarray(s * 24, s * 24 + 24), o + 28);
    _depth[s] = (cx - cam.eye[0]) * fx + (cy - cam.eye[1]) * fy + (cz - cam.eye[2]) * fz;
    let k = _order.length; _order.push(s);
    while (k > 0 && _depth[_order[k - 1]] < _depth[s]) { _order[k] = _order[k - 1]; k--; }   // far → near
    _order[k] = s;
  }
  const F = renderer.frame;
  F.set(cam.viewProj, 0); F.set(cam.view, 16); F.set(cam.invViewProj, 32); F.set(light.viewProj, 48);
  F[64] = cam.eye[0]; F[65] = cam.eye[1]; F[66] = cam.eye[2]; F[67] = app.time;
  F[68] = LIGHT_DIR[0]; F[69] = LIGHT_DIR[1]; F[70] = LIGHT_DIR[2]; F[71] = CFG.SHADOW_HALF;
  F[72] = W; F[73] = H; F[74] = 1 / W; F[75] = 1 / H;
  F[84] = NEAR; F[85] = FAR; F[86] = light.far - light.near; F[87] = light.dist - light.near;
  F[88] = n; F[89] = app.exposure; F[90] = app.pipOpacity; F[91] = app.debugView;
  F[96] = Math.cos(cam.yaw); F[97] = Math.sin(cam.yaw); F[98] = app.envIntensity; F[99] = 0;
  renderer.uploadFrame();
  renderer.uploadDice(n);
  renderer.render(n, _order, _rects, _slotGpu);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (app.visible === false) { app.last = now; return; }   // embedded stage scrolled away: no physics, no GPU work
  const dt = Math.min(Math.max((now - app.last) / 1000, 0), 0.1);
  app.last = now;
  app.time += dt;
  if (dt > 0) app.fps = lerp(app.fps, 1 / dt, 0.05);
  if (app.needResize) { app.needResize = false; resize(); }
  const t0 = performance.now();
  app.acc += dt;
  let steps = 0;
  while (app.acc >= CFG.STEP && steps < 4) { physics.step(CFG.STEP); handleImpacts(); app.acc -= CFG.STEP; steps++; }
  if (steps === 4) app.acc = 0;
  const t1 = performance.now();
  app.physMs = lerp(app.physMs, t1 - t0, 0.08);
  // colour changes glide; the simulation is never touched
  const kf = 1 - Math.exp(-dt * 9), M = app.mat, Mt = app.matTarget;
  for (let i = 0, l = physics.count * 24; i < l; i++) M[i] += (Mt[i] - M[i]) * kf;
  updateCamera(dt);
  updateSettle(dt);
  if (app.hover && !gesture) {
    canvas.classList.toggle('can-grab', !!pickDie(app.hover[0], app.hover[1]));
    app.hover = null;
  }
  drawFrame(app.acc / CFG.STEP);
  app.frameMs = lerp(app.frameMs, performance.now() - t0, 0.08);
}

async function main() {
  buildUI();
  const params = new URLSearchParams(location.search);
  applyLang(detectLang());
  const wanted = matchObject(params.get('object') || '');
  // Start-up is staged and watched, so a stalled GPU start explains itself instead of looking frozen.
  const stage = (k) => { app.stageKey = k; ui.resultState.textContent = T(k); ui.status.title = T(k); };
  const watchdog = setTimeout(() => {
    if (!app.ready && !document.body.classList.contains('no-gpu')) fail(fmt('fbStuck', T(app.stageKey || 'starting')));
  }, 15000);
  ui.status.title = T('checking');
  stage('starting');
  if (!navigator.gpu || params.get('webgpu') === 'off') { clearTimeout(watchdog); return fail(T('fbNoApi')); }
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { adapter = null; }
  if (!adapter) { clearTimeout(watchdog); return fail(T('fbNoAdapter')); }
  let device;
  try { device = await adapter.requestDevice(); } catch (e) { clearTimeout(watchdog); return fail(fmt('fbDevice', e.message)); }
  device.lost.then((info) => { if (info.reason !== 'destroyed') fail(fmt('fbLost', info.message || 'unknown reason')); });
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  stage('compiling');
  await new Promise((r) => setTimeout(r, 0));   // let the stage label paint
  physics = new SoftDice();
  physics.firmness = Number(ui.firmness.value) / 100;
  physics.dampingAmt = Number(ui.damping.value) / 100;
  physics.applySettings();
  renderer = new Renderer(device, context, format);
  await renderer.init();
  stage('shapingDice');
  await new Promise((r) => setTimeout(r, 0));
  app.type = wanted >= 0 ? wanted : 0;
  if (app.type !== 0) app.flavor = OBJECT_TYPES[app.type].natural ? NATURAL : 0;
  ensureType(app.type);
  clearTimeout(watchdog);
  initLight();
  resize();
  // Review preset for stable close-up screenshots (?view=close). Not used in normal play.
  if (params.get('view') === 'close') {
    cam.gdist = cam.dist = cam.base * 0.42; cam.target[0] = 0.35; cam.target[2] = 0.5;
  }
  spawnInitial();
  renderTypeUI(); renderFlavorUI();
  setMode('moving');
  app.ready = true;
  ui.roll.disabled = false;
  ui.status.dataset.state = 'ready';
  const info = adapter.info || {};
  ui.status.title = `${T('ready')}${info.vendor ? ` · ${info.vendor}` : ''}${info.architecture ? ` ${info.architecture}` : ''}`;
  app.last = performance.now();
  requestAnimationFrame(loop);
}

// Test / debugging hook (read-mostly; used by the automated checks in HANDOFF.md).
window.__jelly = {
  CFG, TUNE, FACES, OBJECT_TYPES, app, cam, sound, types, slotType,
  get physics() { return physics; }, get renderer() { return renderer; },
  roll, setCount, setFlavor, setType, submitObject, applyLang, project, pickDie, matchObject,
  renderOnce() { updateCamera(1 / 60); updateSettle(0); drawFrame(1); },   // for tests while the tab is hidden
  state() {
    if (!physics) return null;
    return {
      mode: app.mode, lang: app.lang, type: OBJECT_TYPES[app.type].id, count: physics.count,
      results: app.results.map((r) => (r.type === 0 ? r.value : r.state)),
      fps: Math.round(app.fps), physMs: +app.physMs.toFixed(2), frameMs: +app.frameMs.toFixed(2),
      dice: physics.dice.slice(0, physics.count).map((D, s) => ({
        type: OBJECT_TYPES[slotType[s]].id, c: [...D.cm].map((v) => +v.toFixed(3)),
        up: slotType[s] === 0 ? physics.upFace(s).value : landing(s), asleep: !!D.asleep,
        speed: +D.speed.toFixed(3), spin: +D.spin.toFixed(3), wobble: +D.wobble.toFixed(3), maxStretch: +D.maxStretch.toFixed(3),
      })),
      gpuErrors: renderer ? renderer.gpuErrors.slice(0, 5) : [], nanResets: physics.nanResets || 0,
    };
  },
};

main().catch((e) => { console.error(e); fail(fmt('fbStart', e.message)); });

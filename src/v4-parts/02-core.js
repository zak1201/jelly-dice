/* ============================================================================
   Jelly Dice — single-file WebGPU playground
   ----------------------------------------------------------------------------
   1. Config & small math          5. Sound (Web Audio)
   2. Procedural shape + lattice   6. WGSL shaders
   3. Mesh build (surface, bubbles, picking proxy)
   4. Soft-body physics (XPBD lattice, shape matching, contacts)
   7. WebGPU renderer              8. Camera, picking, input, UI, main loop

   How softness works: every die owns a 5×5×5 lattice of mass nodes whose outer
   layer sits exactly on the candy surface. The physics moves only those 125
   nodes. The render mesh (≈32k vertices with pips and bubbles) is embedded in
   the lattice once, by storing tricubic Catmull-Rom parameter coordinates for
   every vertex. A compute shader re-evaluates the smooth (C1) map each frame,
   so pips, bubbles and normals follow local deformation with no mesh rebuild.
   ========================================================================== */

// ============================================================================
// 1. CONFIG & SMALL MATH
// ============================================================================
const CFG = Object.freeze({
  H: 1.0,             // die half-size in world units (dice are 2 units wide)
  SUPER_P: 8.0,       // superellipsoid exponent: softly rounded edges/corners
  PILLOW: 0.045,      // dome height of each face (× H) — "pillowy" faces
  N: 5,               // physics lattice nodes per axis
  FACE_RES: 72,       // render quads per face edge
  PROXY_STEP: 6,      // picking proxy uses every 6th render vertex (13×13 per face)
  MAX_DICE: 5,
  BUBBLES: 12,        // internal air bubbles per die
  PIP_DEPTH: 0.055, PIP_R: 0.155, PIP_R1: 0.215, PIP_G: 0.52, PIP_FILL: 0.9,
  GRAVITY: 38,        // world units / s² (heavy, snappy fall at this scale)
  STEP: 1 / 120,      // fixed physics step
  SUBSTEPS: 8,        // XPBD substeps per step
  WALL_R: 6.4,        // invisible round table edge (keeps every die in frame)
  SHADOW_SIZE: 2048,
  THICK_SIZE: 1024,   // light-space optical-depth map (smooth, so half resolution)
  SHADOW_HALF: 9.5,   // half extent of the key-light shadow frustum
  VCAP: 32768,        // deformed vertices reserved per object slot (die: 32,478)
  VIN_CAP: 262144,    // static vertex records for all object types (all ten: ≈213k)
  IDX_CAP: 1572864,   // indices for all object types (all ten: ≈1.15M)
  SDF_DIMS: 40,       // per-type signed-distance grid (collisions + floor occlusion)
  SDF_SLABS: 10,      // object types in the GPU SDF atlas
});

// Physics tuning. Firmness / damping sliders interpolate the *Min/*Max pairs.
const TUNE = {
  // Shape matching carries the body's weight per node (tiny sag) while soft lattice edges let
  // a concentrated pull stretch the grabbed region first — the "anchored stretch".
  smMin: 0.0012, smMax: 0.0062,         // global shape-matching pull per substep
  smCapSoft: 8, smCapFirm: 22,          // shape-matching restoring acceleration cap, × gravity
  edgeSoft: 0.45, edgeFirm: 0.05,       // XPBD edge compliance per unit rest length
  volCompliance: 4e-5,                  // cell volume compliance (approx. volume preservation without locking)
  maxStretch: 1.85, minStretch: 0.42,   // hard stretch limits on every lattice edge
  intDampMin: 0.8, intDampMax: 16,      // internal (deformation) damping, 1/s
  rotDampAir: 0.3, rotDampContact: 6.5, rotDampGrab: 6, linDamp: 0.03,
  restAssist: 7,                        // extra damping for a nearly-still grounded die (no creeping)
  restitution: 0.22,                    // max rebound speed / impact speed (rigid part only)
  muS: 1.15, muK: 0.85, muDice: 0.45,   // floor static/kinetic friction, die-die friction
  adhesion: 55,                         // grabbed-die floor stickiness, × gravity per node (fades under sustained pull)
  grabK: 125, grabC: 8, grabFmax: 1.9,  // grab spring (force per unit), damping, max force in die weights
  grabSigma: 0.8,                       // grab footprint radius in lattice units (rounded neck, not a spike)
  vmax: 55,
};

const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** Small deterministic PRNG (mulberry32) for reproducible bubbles. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- column-major mat4 helpers (WGSL mat4x4f layout) ----
const M4 = {
  create: () => new Float32Array(16),
  perspective(out, fovy, aspect, near, far, sx = 0, sy = 0) {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[8] = -sx; out[9] = -sy;            // lens shift in NDC (keeps dice clear of UI)
    out[10] = far / (near - far); out[11] = -1;
    out[14] = (near * far) / (near - far);
    return out;
  },
  ortho(out, l, r, b, t, n, f) {
    out.fill(0);
    out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = 1 / (n - f);
    out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = n / (n - f); out[15] = 1;
    return out;
  },
  lookAt(out, eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  },
  mul(out, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  },
  invert(out, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
};

// ---- quaternions [x, y, z, w] and row-major 3×3 rotations ----
function quatToMat(q, R) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
  R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
  R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
  return R;
}
function quatMul(a, b, out) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
function quatAxisAngle(ax, ay, az, angle, out) {
  const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(angle / 2) / l;
  out[0] = ax * s; out[1] = ay * s; out[2] = az * s; out[3] = Math.cos(angle / 2);
  return out;
}
function quatNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  return q;
}
/** Rotation taking unit vector a onto unit vector b. */
function quatFromTo(a, b, out) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) { // opposite: rotate 180° about any perpendicular axis
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    return quatAxisAngle(a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0], Math.PI, out);
  }
  out[0] = a[1] * b[2] - a[2] * b[1]; out[1] = a[2] * b[0] - a[0] * b[2]; out[2] = a[0] * b[1] - a[1] * b[0]; out[3] = 1 + d;
  return quatNormalize(out);
}
function randomQuat(rnd) { // uniform random rotation (Shoemake)
  const u1 = rnd(), u2 = rnd() * 2 * Math.PI, u3 = rnd() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

/** Inverse of the symmetric matrix [[a,d,e],[d,b,f],[e,f,c]] into out (row-major). */
function invSym3(a, b, c, d, e, f, out) {
  const A = b * c - f * f, B = e * f - c * d, C = d * f - b * e;
  const det = a * A + d * B + e * C;
  if (!(Math.abs(det) > 1e-12)) { out.fill(0); return false; }
  const k = 1 / det;
  out[0] = A * k; out[1] = B * k; out[2] = C * k;
  out[3] = B * k; out[4] = (a * c - e * e) * k; out[5] = (d * e - a * f) * k;
  out[6] = C * k; out[7] = (d * e - a * f) * k; out[8] = (a * b - d * d) * k;
  return true;
}

// ============================================================================
// 2. PROCEDURAL SHAPE + LATTICE EMBEDDING
// ============================================================================
// Face table. t1 × t2 = n (outward), so grid triangles wind counter-clockwise.
// Standard die: opposite faces sum to 7; 1-2-3 run counter-clockwise around
// their shared corner.
const FACES = [
  { n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], value: 2 },
  { n: [-1, 0, 0], t1: [0, 0, 1], t2: [0, 1, 0], value: 5 },
  { n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0], value: 3 },
  { n: [0, -1, 0], t1: [1, 0, 0], t2: [0, 0, 1], value: 4 },
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0], value: 1 },
  { n: [0, 0, -1], t1: [0, 1, 0], t2: [1, 0, 0], value: 6 },
];
const faceIndexFor = (axis, sign) => axis * 2 + (sign > 0 ? 0 : 1);

const G = CFG.PIP_G;
const PIP_LAYOUT = {
  1: [[0, 0]],
  2: [[-G, -G], [G, G]],
  3: [[-G, -G], [0, 0], [G, G]],
  4: [[-G, -G], [G, -G], [-G, G], [G, G]],
  5: [[-G, -G], [G, -G], [0, 0], [-G, G], [G, G]],
  6: [[-G, -G], [-G, 0], [-G, G], [G, -G], [G, 0], [G, G]],
};

/** Depth (× H) of the rounded pip dimples at face coords (s, t) ∈ [-1, 1]². */
function pipDepthAt(value, s, t) {
  const r = value === 1 ? CFG.PIP_R1 : CFG.PIP_R;
  const depth = CFG.PIP_DEPTH * (value === 1 ? 1.12 : 1);
  let d = 0;
  for (const [cs, ct] of PIP_LAYOUT[value]) {
    const q = Math.hypot(s - cs, t - ct) / r;
    if (q < 1) { const w = 1 - q * q; d = Math.max(d, depth * w * w); } // C1 dish, soft rim
  }
  return d;
}

/**
 * Rest-shape point for face coords (s, t): the cube point is projected onto a
 * p=8 superellipsoid (G∞-smooth rounding), domed by a C1 "pillow" that
 * vanishes with zero slope at the face borders, and dimpled by pips.
 */
function shapePoint(face, s, t, withPips, out) {
  const F = FACES[face], P = CFG.SUPER_P;
  const qx = F.n[0] + s * F.t1[0] + t * F.t2[0];
  const qy = F.n[1] + s * F.t1[1] + t * F.t2[1];
  const qz = F.n[2] + s * F.t1[2] + t * F.t2[2];
  const pn = Math.pow(Math.pow(Math.abs(qx), P) + Math.pow(Math.abs(qy), P) + Math.pow(Math.abs(qz), P), 1 / P);
  const x = qx / pn, y = qy / pn, z = qz / pn;
  let nx = Math.sign(x) * Math.pow(Math.abs(x), P - 1);
  let ny = Math.sign(y) * Math.pow(Math.abs(y), P - 1);
  let nz = Math.sign(z) * Math.pow(Math.abs(z), P - 1);
  const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
  const ss = Math.min(s * s, 1), tt = Math.min(t * t, 1);
  let off = CFG.PILLOW * (1 - ss) * (1 - ss) * (1 - tt) * (1 - tt);
  if (withPips) off -= pipDepthAt(F.value, s, t);
  out[0] = (x + nx * off) * CFG.H; out[1] = (y + ny * off) * CFG.H; out[2] = (z + nz * off) * CFG.H;
  return out;
}

const _sa = new Float64Array(3), _sb = new Float64Array(3), _sc = new Float64Array(3), _sd = new Float64Array(3);
/** Outward rest normal by central differences of the analytic shape. */
function shapeNormal(face, s, t, withPips, out) {
  const e = 1e-4;
  shapePoint(face, s + e, t, withPips, _sa); shapePoint(face, s - e, t, withPips, _sb);
  shapePoint(face, s, t + e, withPips, _sc); shapePoint(face, s, t - e, withPips, _sd);
  const ax = _sa[0] - _sb[0], ay = _sa[1] - _sb[1], az = _sa[2] - _sb[2];
  const bx = _sc[0] - _sd[0], by = _sc[1] - _sd[1], bz = _sc[2] - _sd[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz); out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}

// ---- lattice indexing: N³ physics nodes, (N+2)³ with ghost layer for Catmull-Rom ----
const N = CFG.N, NE = N + 2, NP = N * N * N, NEP = NE * NE * NE;
const nid = (i, j, k) => i + N * (j + N * k);
const eid = (i, j, k) => i + NE * (j + NE * k);

/**
 * Rest positions of the lattice: nested scaled shells of the candy surface.
 * The outer shell lies exactly on the rendered surface, so contacts and
 * picking act on the visible shape.
 */
function buildRestLattice() {
  const rest = new Float64Array(NP * 3), tmp = new Float64Array(3);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const g = [i / (N - 1) * 2 - 1, j / (N - 1) * 2 - 1, k / (N - 1) * 2 - 1];
    const L = Math.max(Math.abs(g[0]), Math.abs(g[1]), Math.abs(g[2]));
    const o = nid(i, j, k) * 3;
    if (L < 1e-9) { rest[o] = rest[o + 1] = rest[o + 2] = 0; continue; }
    const q = [g[0] / L, g[1] / L, g[2] / L];
    let ax = 0;
    if (Math.abs(q[1]) > Math.abs(q[ax]) + 1e-9) ax = 1;
    if (Math.abs(q[2]) > Math.abs(q[ax]) + 1e-9) ax = 2;
    const face = faceIndexFor(ax, q[ax]), F = FACES[face];
    const s = q[0] * F.t1[0] + q[1] * F.t1[1] + q[2] * F.t1[2];
    const t = q[0] * F.t2[0] + q[1] * F.t2[1] + q[2] * F.t2[2];
    shapePoint(face, s, t, false, tmp);
    rest[o] = tmp[0] * L; rest[o + 1] = tmp[1] * L; rest[o + 2] = tmp[2] * L;
  }
  return rest;
}

function ghost3(dst, a, b, c) { // dst[a] = 2·dst[b] − dst[c] (linear extrapolation)
  dst[a] = 2 * dst[b] - dst[c]; dst[a + 1] = 2 * dst[b + 1] - dst[c + 1]; dst[a + 2] = 2 * dst[b + 2] - dst[c + 2];
}
/**
 * Copy N³ nodes (stride 3) into the (N+2)³ extended grid (stride ds) and fill
 * the ghost layer by linear extrapolation, one axis at a time. Affine lattices
 * therefore stay affine, so the Catmull-Rom map reproduces them exactly.
 */
function extendNodes(src, so, dst, d0, ds) {
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = so + nid(i, j, k) * 3, d = d0 + eid(i + 1, j + 1, k + 1) * ds;
    dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2];
  }
  for (let k = 1; k <= N; k++) for (let j = 1; j <= N; j++) {
    ghost3(dst, d0 + eid(0, j, k) * ds, d0 + eid(1, j, k) * ds, d0 + eid(2, j, k) * ds);
    ghost3(dst, d0 + eid(N + 1, j, k) * ds, d0 + eid(N, j, k) * ds, d0 + eid(N - 1, j, k) * ds);
  }
  for (let k = 1; k <= N; k++) for (let i = 0; i <= N + 1; i++) {
    ghost3(dst, d0 + eid(i, 0, k) * ds, d0 + eid(i, 1, k) * ds, d0 + eid(i, 2, k) * ds);
    ghost3(dst, d0 + eid(i, N + 1, k) * ds, d0 + eid(i, N, k) * ds, d0 + eid(i, N - 1, k) * ds);
  }
  for (let j = 0; j <= N + 1; j++) for (let i = 0; i <= N + 1; i++) {
    ghost3(dst, d0 + eid(i, j, 0) * ds, d0 + eid(i, j, 1) * ds, d0 + eid(i, j, 2) * ds);
    ghost3(dst, d0 + eid(i, j, N + 1) * ds, d0 + eid(i, j, N) * ds, d0 + eid(i, j, N - 1) * ds);
  }
}

// Catmull-Rom basis (tension 0.5) and its derivative — mirrored in WGSL.
const _cw = new Float64Array(12), _cd = new Float64Array(12);
function crBasis(t, o) {
  const t2 = t * t, t3 = t2 * t;
  _cw[o] = 0.5 * (-t3 + 2 * t2 - t); _cw[o + 1] = 0.5 * (3 * t3 - 5 * t2 + 2);
  _cw[o + 2] = 0.5 * (-3 * t3 + 4 * t2 + t); _cw[o + 3] = 0.5 * (t3 - t2);
  _cd[o] = 0.5 * (-3 * t2 + 4 * t - 1); _cd[o + 1] = 0.5 * (9 * t2 - 10 * t);
  _cd[o + 2] = 0.5 * (-9 * t2 + 8 * t + 1); _cd[o + 3] = 0.5 * (3 * t2 - 2 * t);
}
/**
 * Evaluate the tricubic map at lattice coords (u, v, w) ∈ [0, N−1]³ (slight
 * extrapolation is allowed). P ← position; J ← [∂P/∂u, ∂P/∂v, ∂P/∂w] or null.
 */
function crEval(ext, e0, es, u, v, w, P, J) {
  const cu = Math.min(Math.max(Math.floor(u), 0), N - 2);
  const cv = Math.min(Math.max(Math.floor(v), 0), N - 2);
  const cc = Math.min(Math.max(Math.floor(w), 0), N - 2);
  crBasis(u - cu, 0); crBasis(v - cv, 4); crBasis(w - cc, 8);
  let px = 0, py = 0, pz = 0, ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
  for (let c = 0; c < 4; c++) for (let b = 0; b < 4; b++) {
    const row = e0 + eid(cu, cv + b, cc + c) * es;
    const wyz = _cw[4 + b] * _cw[8 + c], dyz = _cd[4 + b] * _cw[8 + c], ydz = _cw[4 + b] * _cd[8 + c];
    for (let a = 0; a < 4; a++) {
      const o = row + a * es, nx = ext[o], ny = ext[o + 1], nz = ext[o + 2];
      const W = _cw[a] * wyz; px += W * nx; py += W * ny; pz += W * nz;
      if (J) {
        const Wu = _cd[a] * wyz, Wv = _cw[a] * dyz, Ww = _cw[a] * ydz;
        ux += Wu * nx; uy += Wu * ny; uz += Wu * nz;
        vx += Wv * nx; vy += Wv * ny; vz += Wv * nz;
        wx += Ww * nx; wy += Ww * ny; wz += Ww * nz;
      }
    }
  }
  P[0] = px; P[1] = py; P[2] = pz;
  if (J) { J[0] = ux; J[1] = uy; J[2] = uz; J[3] = vx; J[4] = vy; J[5] = vz; J[6] = wx; J[7] = wy; J[8] = wz; }
}

const _ip = new Float64Array(3), _iJ = new Float64Array(9);
/** Newton inversion of the rest map: find u with CR(u) = X (u holds the guess). */
function crInvert(ext, X, u) {
  for (let it = 0; it < 24; it++) {
    crEval(ext, 0, 3, u[0], u[1], u[2], _ip, _iJ);
    const rx = _ip[0] - X[0], ry = _ip[1] - X[1], rz = _ip[2] - X[2];
    if (rx * rx + ry * ry + rz * rz < 1e-16) return true;
    const J = _iJ; // columns a=(0,1,2) b=(3,4,5) c=(6,7,8); solve J·du = r by Cramer
    const a0 = J[0], a1 = J[1], a2 = J[2], b0 = J[3], b1 = J[4], b2 = J[5], c0 = J[6], c1 = J[7], c2 = J[8];
    const det = a0 * (b1 * c2 - b2 * c1) - b0 * (a1 * c2 - a2 * c1) + c0 * (a1 * b2 - a2 * b1);
    if (Math.abs(det) < 1e-14) return false;
    const du = (rx * (b1 * c2 - b2 * c1) - b0 * (ry * c2 - rz * c1) + c0 * (ry * b2 - rz * b1)) / det;
    const dv = (a0 * (ry * c2 - rz * c1) - rx * (a1 * c2 - a2 * c1) + c0 * (a1 * rz - a2 * ry)) / det;
    const dw = (a0 * (b1 * rz - b2 * ry) - b0 * (a1 * rz - a2 * ry) + rx * (a1 * b2 - a2 * b1)) / det;
    const m = Math.max(Math.abs(du), Math.abs(dv), Math.abs(dw)), s = m > 0.5 ? 0.5 / m : 1;
    u[0] -= du * s; u[1] -= dv * s; u[2] -= dw * s;
  }
  return false;
}

// ============================================================================
// 3. MESH BUILD — render surface, bubbles, picking proxy
// ============================================================================
function makeIcosphere() { // subdivision 1: 42 vertices, 80 triangles
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const cache = new Map();
  const mid = (a, b) => {
    const key = a < b ? a * 64 + b : b * 64 + a;
    if (cache.has(key)) return cache.get(key);
    const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
    const l = Math.hypot(...p); v.push(p.map((c) => c / l)); cache.set(key, v.length - 1);
    return v.length - 1;
  };
  const f2 = [];
  for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); f2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  f = f2;
  return { pos: v, tris: f };
}

/**
 * Builds everything the GPU needs once: per-vertex lattice coordinates (u),
 * param-space normals (m = Jᵀ n, turned back into deformed normals by the
 * cofactor of the live Jacobian) and face coords for crisp procedural pips.
 * Static vertex record (12 floats): u.xyz, stem weight | m.xyz, accent weight | s, t, face, type (0 = die).
 */
function buildDiceGeometry() {
  const rest = buildRestLattice();
  const restExt = new Float64Array(NEP * 3);
  extendNodes(rest, 0, restExt, 0, 3);

  const R = CFG.FACE_RES, V1 = R + 1, surfCount = 6 * V1 * V1;
  const ico = makeIcosphere(), icoCount = ico.pos.length;
  const bubbleVerts = CFG.BUBBLES * icoCount;
  const total = surfCount + CFG.MAX_DICE * bubbleVerts;
  const vin = new Float32Array(total * 12);
  const X = new Float64Array(3), Nn = new Float64Array(3), P = new Float64Array(3), J = new Float64Array(9);
  const u = new Float64Array(3);
  const S = (N - 1) / 2;
  let failures = 0;

  const writeVertex = (vi, kind, s, t, face) => {
    crEval(restExt, 0, 3, u[0], u[1], u[2], P, J);
    let mx = J[0] * Nn[0] + J[1] * Nn[1] + J[2] * Nn[2];
    let my = J[3] * Nn[0] + J[4] * Nn[1] + J[5] * Nn[2];
    let mz = J[6] * Nn[0] + J[7] * Nn[1] + J[8] * Nn[2];
    const ml = Math.hypot(mx, my, mz) || 1; mx /= ml; my /= ml; mz /= ml;
    const o = vi * 12;
    vin[o] = u[0]; vin[o + 1] = u[1]; vin[o + 2] = u[2]; vin[o + 3] = 0 * kind;
    vin[o + 4] = mx; vin[o + 5] = my; vin[o + 6] = mz; vin[o + 7] = 0;
    vin[o + 8] = s; vin[o + 9] = t; vin[o + 10] = face; vin[o + 11] = 0;
  };

  // --- candy surface, 6 face grids (duplicated border vertices coincide exactly) ---
  let vi = 0;
  const K = R / CFG.PROXY_STEP, K1 = K + 1;
  const proxyU = new Float64Array(6 * K1 * K1 * 3);
  const corr = new Float64Array(3);
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    for (let b = 0; b <= R; b++) {
      corr.fill(0);
      for (let a = 0; a <= R; a++) {
        const s = -1 + 2 * a / R, t = -1 + 2 * b / R;
        shapePoint(f, s, t, true, X);
        shapeNormal(f, s, t, true, Nn);
        const g0 = (F.n[0] + s * F.t1[0] + t * F.t2[0] + 1) * S;
        const g1 = (F.n[1] + s * F.t1[1] + t * F.t2[1] + 1) * S;
        const g2 = (F.n[2] + s * F.t1[2] + t * F.t2[2] + 1) * S;
        u[0] = g0 + corr[0]; u[1] = g1 + corr[1]; u[2] = g2 + corr[2];   // warm start along the row
        if (!crInvert(restExt, X, u)) { failures++; u[0] = g0; u[1] = g1; u[2] = g2; crInvert(restExt, X, u); }
        corr[0] = u[0] - g0; corr[1] = u[1] - g1; corr[2] = u[2] - g2;
        writeVertex(vi, 0, s, t, f);
        if (a % CFG.PROXY_STEP === 0 && b % CFG.PROXY_STEP === 0) {
          const po = ((f * K1 + b / CFG.PROXY_STEP) * K1 + a / CFG.PROXY_STEP) * 3;
          proxyU[po] = u[0]; proxyU[po + 1] = u[1]; proxyU[po + 2] = u[2];
        }
        vi++;
      }
    }
  }

  // --- surface indices; quad diagonals mirrored per quadrant for symmetric shading ---
  const surfIdx = [];
  for (let f = 0; f < 6; f++) {
    const base = f * V1 * V1;
    for (let b = 0; b < R; b++) for (let a = 0; a < R; a++) {
      const v00 = base + b * V1 + a, v10 = v00 + 1, v01 = v00 + V1, v11 = v01 + 1;
      if ((a < R / 2) !== (b < R / 2)) surfIdx.push(v00, v10, v11, v00, v11, v01);
      else surfIdx.push(v00, v10, v01, v10, v11, v01);
    }
  }

  // --- internal bubbles: a different seeded set per die, embedded like the surface ---
  const bubbleIdx = [];
  for (let bI = 0; bI < CFG.BUBBLES; bI++) for (const [a, b, c] of ico.tris) {
    bubbleIdx.push(surfCount + bI * icoCount + a, surfCount + bI * icoCount + b, surfCount + bI * icoCount + c);
  }
  for (let d = 0; d < CFG.MAX_DICE; d++) {
    const rnd = mulberry32(9127 + d * 7919);
    const centers = [];
    for (let bI = 0; bI < CFG.BUBBLES; bI++) {
      const r = rnd() < 0.72 ? lerp(0.014, 0.032, rnd()) : lerp(0.036, 0.062, rnd());
      let c = null;
      for (let tries = 0; tries < 60 && !c; tries++) {
        let cand;
        if (centers.length && rnd() < 0.35) { // loose clusters look natural
          const pc = centers[Math.floor(rnd() * centers.length)];
          cand = [pc[0] + (rnd() - 0.5) * 0.28, pc[1] + (rnd() - 0.5) * 0.28, pc[2] + (rnd() - 0.5) * 0.28];
        } else cand = [(rnd() * 2 - 1) * 0.62, (rnd() * 2 - 1) * 0.62, (rnd() * 2 - 1) * 0.62];
        if (Math.max(Math.abs(cand[0]), Math.abs(cand[1]), Math.abs(cand[2])) > 0.64) continue;
        if (centers.every((o) => Math.hypot(o[0] - cand[0], o[1] - cand[1], o[2] - cand[2]) > o[3] + r + 0.035)) c = [...cand, r];
      }
      if (!c) c = [0, 0, 0, 0.001];
      centers.push(c);
      for (let k = 0; k < icoCount; k++) {
        const p = ico.pos[k];
        X[0] = c[0] + p[0] * c[3]; X[1] = c[1] + p[1] * c[3]; X[2] = c[2] + p[2] * c[3];
        Nn[0] = p[0]; Nn[1] = p[1]; Nn[2] = p[2];
        u[0] = (X[0] + 1) * S; u[1] = (X[1] + 1) * S; u[2] = (X[2] + 1) * S;
        if (!crInvert(restExt, X, u)) failures++;
        writeVertex(surfCount + d * bubbleVerts + bI * icoCount + k, 1, 0, 0, -1);
      }
    }
  }

  const idx = new Uint32Array(surfIdx.length + bubbleIdx.length);
  idx.set(surfIdx, 0); idx.set(bubbleIdx, surfIdx.length);
  // picking proxy as triangles over the 13×13 face grids (same format as other objects)
  const ptris = [];
  for (let f = 0; f < 6; f++) for (let b = 0; b < K1 - 1; b++) for (let a = 0; a < K1 - 1; a++) {
    const i00 = (f * K1 + b) * K1 + a, i10 = i00 + 1, i01 = i00 + K1, i11 = i01 + 1;
    ptris.push(i00, i10, i11, i00, i11, i01);
  }
  return {
    type: 0, rest, restExt, vin, idx, failures,
    surfCount, bubbleVerts, perDie: surfCount + bubbleVerts,
    surfIdxCount: surfIdx.length, bubbleIdxCount: bubbleIdx.length,
    proxy: { u: proxyU, tris: Uint32Array.from(ptris) },
    grid: buildSdfGrid(0),
  };
}

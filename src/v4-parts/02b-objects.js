
// ============================================================================
// 3b. OBJECT LIBRARY — procedural jelly objects beyond the die
// ----------------------------------------------------------------------------
// Each object is a signed-distance function (SDF) in rest space (y up, the die
// is 2 units wide). From it we build, once per object type:
//   • a smooth render mesh (naive surface nets + projection onto the surface),
//   • a 5×5×5 box lattice around the mesh (affine at rest, so every vertex
//     embeds exactly), with node masses that follow the object's volume,
//   • surface sample points for floor/object contacts (the die instead uses
//     its surface-shell lattice nodes), a picking proxy and an SDF grid.
// Parts: BODY and ACCENT are jelly in the chosen colour (accent = deeper tone
// or the object's natural second colour), STEM is a deep candy tone. Decals
// (pips, screen, windows, dots, veins) are evaluated per fragment in WGSL.
// ============================================================================
let _dB = 0, _dA = 1e9, _dS = 1e9;   // per-part distances of the last sdf() call

function sdSphere(x, y, z, r) { return Math.sqrt(x * x + y * y + z * z) - r; }
function sdEllipsoid(x, y, z, a, b, c) {
  const k0 = Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
  const k1 = Math.sqrt((x / (a * a)) ** 2 + (y / (b * b)) ** 2 + (z / (c * c)) ** 2);
  return k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -Math.min(a, b, c);
}
function sdRoundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
function sdRoundCylinder(x, y, z, r, h, rr) { // vertical, radius r, half height h, edge rounding rr
  const dx = Math.hypot(x, z) - r + rr, dy = Math.abs(y) - h + rr;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rr;
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }
function extrude(d2, y, hh, rr) { // rounded extrusion of a 2-D distance along y (half height hh)
  const wx = d2 + rr, wy = Math.abs(y) - hh + rr;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - rr;
}
function sdPie2(px, py, s, c, r) { // IQ sector: apex at origin, opens around +y, half-angle with (sin, cos) = (s, c)
  px = Math.abs(px);
  const l = Math.hypot(px, py) - r;
  const t = clamp(px * s + py * c, 0, r);
  const m = Math.hypot(px - s * t, py - c * t);
  return Math.max(l, m * Math.sign(c * px - s * py));
}
function sdTriIso2(px, py, qx, qy) { // IQ isosceles triangle, apex at origin, base at y = qy
  px = Math.abs(px);
  const h1 = clamp((px * qx + py * qy) / (qx * qx + qy * qy), 0, 1);
  const ax = px - qx * h1, ay = py - qy * h1;
  const h2 = clamp(px / qx, 0, 1);
  const bx = px - qx * h2, by = py - qy;
  const s = -Math.sign(qy);
  const d1 = Math.min(ax * ax + ay * ay, bx * bx + by * by);
  const d2 = Math.min(s * (px * qy - py * qx), s * (py - qy));
  return -Math.sqrt(d1) * Math.sign(d2);
}

/**
 * Object catalogue. Order is the UI order and the WGSL type id (dice = 0).
 * T1 = light transmitted through one world unit (linear RGB); sc = in-scatter albedo.
 */
const OBJECT_TYPES = [
  {
    id: 'dice', names: { zh: '骰子', en: 'Dice' }, aliases: ['骰子', '色子', '筛子', 'dice', 'die', 'd6'],
    note: { zh: '一点运气，也别太当真。', en: 'A little luck. Don’t take it too seriously.' },
    center: [0, 0, 0], half: [1.05, 1.05, 1.05], natural: null,
  },
  {
    id: 'pinecone', names: { zh: '松果', en: 'Pine cone' }, aliases: ['松果', '松塔', '松球', 'pinecone', 'pine cone', 'pine-cone', 'cone'],
    note: { zh: '林子里捡来的，一片一片都还在。', en: 'Picked up in the woods, every scale still there.' },
    center: [0, -0.06, 0], half: [0.92, 1.33, 0.92],
    natural: { body: [0.62, 0.38, 0.19, 0.5, 0.26, 0.1], accent: [0.5, 0.3, 0.15, 0.38, 0.2, 0.08], stem: [0.42, 0.26, 0.13, 0.3, 0.16, 0.06] },
    sdf(x, y, z) {
      const t = clamp((y + 0.05) / 1.2, -1, 1);
      const s = 1 + 0.28 * Math.pow(Math.max(t, 0), 1.3);
      const egg = sdEllipsoid(x * s, y + 0.05, z * s, 0.78, 1.17, 0.78) / s;
      const th = Math.atan2(z, x);
      const u1 = (8 * th + 15 * y) / (2 * Math.PI), u2 = (13 * th - 15 * y) / (2 * Math.PI);
      const cd = Math.abs(u1 - Math.floor(u1) - 0.5) + Math.abs(u2 - Math.floor(u2) - 0.5);
      const fade = 1 - smooth01((Math.abs(y + 0.05) - 0.85) / 0.35);
      const body = egg - 0.085 * (1 - smooth01((cd - 0.08) / 0.46)) * fade;
      const stalk = sdCapsule(x, y, z, 0, -1.02, 0, 0.02, -1.3, 0.03, 0.085);
      _dB = body; _dA = 1e9; _dS = stalk;
      return smin(body, stalk, 0.1);
    },
  },
  {
    id: 'gourd', names: { zh: '葫芦', en: 'Gourd' }, aliases: ['葫芦', '葫芦瓜', 'gourd', 'calabash', 'bottle gourd'],
    note: { zh: '系着一根红绳，放在手心刚好。', en: 'Tied with a red cord, just right in the hand.' },
    center: [0, 0.1, 0], half: [0.98, 1.47, 0.98],
    natural: { body: [0.94, 0.72, 0.26, 0.86, 0.56, 0.12], accent: [0.8, 0.56, 0.16, 0.66, 0.4, 0.08], stem: [0.5, 0.36, 0.14, 0.36, 0.24, 0.06] },
    sdf(x, y, z) {
      const body = smin(sdSphere(x, y + 0.42, z, 0.92), sdSphere(x, y - 0.62, z, 0.6), 0.42);
      const stem = sdCapsule(x, y, z, 0, 1.1, 0, 0.07, 1.44, 0.03, 0.075);
      _dB = body; _dA = 1e9; _dS = stem;
      return smin(body, stem, 0.06);
    },
  },
  {
    id: 'ginkgo', scale: 0.8, names: { zh: '银杏叶', en: 'Ginkgo leaf' }, aliases: ['银杏叶', '银杏', '叶子', '树叶', 'ginkgo', 'ginkgo leaf', 'leaf'],
    note: { zh: '原则 03 里说的“一片叶子”。', en: 'The “leaf” from principle 03.' },
    center: [0, 0, -0.34], half: [1.56, 0.23, 1.27],
    natural: { body: [0.96, 0.84, 0.3, 0.9, 0.7, 0.12], accent: [0.84, 0.64, 0.18, 0.7, 0.46, 0.08], stem: [0.72, 0.56, 0.2, 0.56, 0.38, 0.08] },
    sdf(x, y, z) {
      const az = -0.8, R = 1.62;
      const px = x, py = z - az;
      const phi = Math.atan2(px, py);
      const Rw = R + 0.035 * Math.sin(20 * phi);
      let d2 = sdPie2(px, py, Math.sin(1.1), Math.cos(1.1), Rw - 0.08) - 0.08;
      d2 = Math.max(d2, -(Math.hypot(px, py - (R + 0.1)) - 0.27));     // central notch of the fan
      const hh = 0.115 + 0.055 * (1 - clamp(Math.hypot(px, py) / R, 0, 1));
      const blade = extrude(d2, y, hh, 0.09);
      const petiole = sdCapsule(x, y, z, 0, 0, az + 0.12, 0.07, -0.02, az - 0.7, 0.075);
      _dB = blade; _dA = petiole; _dS = 1e9;
      return smin(blade, petiole, 0.08);
    },
  },
  {
    id: 'acorn', names: { zh: '橡果', en: 'Acorn' }, aliases: ['橡果', '橡子', '栎果', 'acorn', 'oak nut'],
    note: { zh: '林子里最常被孩子揣进口袋的东西之一。', en: 'One of the things children most often pocket in the woods.' },
    center: [0, -0.05, 0], half: [0.8, 1.13, 0.8],
    natural: { body: [0.82, 0.54, 0.26, 0.72, 0.4, 0.14], accent: [0.52, 0.37, 0.22, 0.38, 0.24, 0.1], stem: [0.42, 0.28, 0.16, 0.3, 0.18, 0.07] },
    sdf(x, y, z) {
      const nut = smin(sdEllipsoid(x, y + 0.28, z, 0.64, 0.84, 0.64), sdSphere(x, y + 1.08, z, 0.06), 0.32);
      const th = Math.atan2(z, x);
      let cap = smax(sdEllipsoid(x, y - 0.3, z, 0.75, 0.5, 0.75), 0.12 - y, 0.06);
      cap -= 0.018 * Math.sin(18 * th) * Math.sin(24 * y);
      const stem = sdCapsule(x, y, z, 0, 0.74, 0, 0.03, 1.0, 0.02, 0.06);
      _dB = nut; _dA = cap; _dS = stem;
      return smin(smin(nut, cap, 0.04), stem, 0.05);
    },
  },
  {
    id: 'pebble', scale: 0.9, names: { zh: '鹅卵石', en: 'Pebble' }, aliases: ['鹅卵石', '石头', '卵石', '小石头', 'pebble', 'stone', 'rock'],
    note: { zh: '被水磨了很久的形状，自然而然。', en: 'A shape the water took its time with. Naturally.' },
    center: [0, 0.03, 0], half: [1.4, 0.68, 1.07],
    natural: { body: [0.66, 0.7, 0.72, 0.5, 0.54, 0.56], accent: [0.56, 0.6, 0.62, 0.4, 0.44, 0.46], stem: [0.5, 0.52, 0.54, 0.36, 0.38, 0.4] },
    sdf(x, y, z) {
      const wx = x + 0.06 * Math.sin(1.7 * z + 0.4), wz = z + 0.05 * Math.sin(1.9 * x), wy = y + 0.04 * Math.sin(1.3 * x + 0.7 * z);
      const e = smax(sdEllipsoid(wx, wy, wz, 1.3, 0.62, 0.98), -0.5 - y, 0.3);
      _dB = e; _dA = 1e9; _dS = 1e9;
      return e;
    },
  },
  {
    id: 'apple', names: { zh: '苹果', en: 'Apple' }, aliases: ['苹果', '萍果', 'apple', 'apples'],
    note: { zh: '一只会晃的苹果。', en: 'An apple with a wobble.' },
    center: [0, 0.14, 0], half: [1.03, 1.08, 1.03],
    natural: { body: [0.86, 0.1, 0.12, 0.76, 0.04, 0.05], accent: [0.3, 0.72, 0.2, 0.12, 0.52, 0.08], stem: [0.42, 0.26, 0.12, 0.3, 0.16, 0.05] },
    sdf(x, y, z) {
      let e = sdEllipsoid(x, y, z, 1.0, 0.9, 1.0);
      e = smax(e, -sdSphere(x, y - 0.98, z, 0.3), 0.22);
      e = smax(e, -sdSphere(x, y + 0.95, z, 0.2), 0.16);
      const stem = sdCapsule(x, y, z, 0, 0.62, 0, 0.09, 1.16, 0.02, 0.05);
      // leaf: flattened ellipsoid tilted away from the stem
      const lx0 = x - 0.32, ly0 = y - 1.02, lz0 = z - 0.04;
      const ca = Math.cos(0.5), sa = Math.sin(0.5), cb = Math.cos(0.35), sb = Math.sin(0.35);
      const rx = ca * lx0 + sa * ly0, ry = -sa * lx0 + ca * ly0;
      const lx = cb * rx - sb * lz0, lz = sb * rx + cb * lz0;
      const leaf = sdEllipsoid(lx, ry, lz, 0.34, 0.045, 0.15);
      _dB = e; _dA = leaf; _dS = stem;
      return smin(smin(e, stem, 0.05), leaf, 0.04);
    },
  },
  {
    id: 'phone', names: { zh: '手机', en: 'Phone' }, aliases: ['手机', '电话', '移动电话', 'phone', 'smartphone', 'mobile', 'cellphone', 'iphone'],
    note: { zh: '天天拿在手里的那块屏，也可以只是一块果冻。', en: 'The screen in your hand every day can also just be jelly.' },
    center: [0, -0.03, 0], half: [0.71, 0.19, 1.32],
    density: 1.5,   // thin: a little denser so the blue still reads
    natural: { body: [0.34, 0.5, 0.88, 0.12, 0.28, 0.74], accent: [0.22, 0.34, 0.8, 0.08, 0.18, 0.62], stem: [0.22, 0.34, 0.8, 0.08, 0.18, 0.62] },
    sdf(x, y, z) {
      const body = sdRoundBox(x, y, z, 0.64, 0.13, 1.3, 0.12);
      const cam = sdRoundBox(x + 0.3, y + 0.15, z + 0.9, 0.2, 0.04, 0.22, 0.05);
      const btn = sdRoundBox(x - 0.655, y, z - 0.25, 0.02, 0.05, 0.14, 0.018);
      _dB = body; _dA = Math.min(cam, btn); _dS = 1e9;
      return Math.min(smin(body, cam, 0.03), smin(body, btn, 0.01));
    },
  },
  {
    id: 'home', names: { zh: '小房子', en: 'Home' }, aliases: ['小房子', '房子', '家', '房屋', '屋子', 'home', 'house', 'hut'],
    note: { zh: '路上看见的，回家还能再看。——原则 03', en: 'What you saw, you can see again. — Principle 03' },
    center: [0, 0.02, 0], half: [0.98, 1.05, 0.96],
    natural: { body: [0.96, 0.88, 0.7, 0.9, 0.78, 0.52], accent: [0.86, 0.36, 0.22, 0.76, 0.22, 0.1], stem: [0.7, 0.3, 0.18, 0.56, 0.18, 0.08] },
    sdf(x, y, z) {
      const walls = sdRoundBox(x, y + 0.4, z, 0.8, 0.6, 0.7, 0.08);
      const tri = sdTriIso2(z, 1.02 - y, 0.92, 0.86) - 0.03;
      const roof = extrude(tri, x, 0.94, 0.06);
      const chimney = sdRoundBox(x - 0.45, y - 0.8, z + 0.25, 0.1, 0.22, 0.1, 0.03);
      _dB = walls; _dA = Math.min(roof, chimney); _dS = 1e9;
      return smin(smin(walls, roof, 0.03), chimney, 0.03);
    },
  },
  {
    id: 'mushroom', names: { zh: '蘑菇', en: 'Mushroom' }, aliases: ['蘑菇', '菌子', '香菇', 'mushroom', 'toadstool', 'fungus'],
    note: { zh: '雨后林子里冒出来的一朵。只看，不摘。', en: 'One that appears in the woods after rain. Look, don’t pick.' },
    center: [0, -0.09, 0], half: [1.14, 1.04, 1.14],
    natural: { body: [0.96, 0.92, 0.82, 0.9, 0.84, 0.7], accent: [0.9, 0.34, 0.17, 0.8, 0.17, 0.06], stem: [0.9, 0.86, 0.74, 0.8, 0.74, 0.58] },
    sdf(x, y, z) {
      const stem = smin(sdRoundCylinder(x, y + 0.4, z, 0.35, 0.65, 0.14), sdEllipsoid(x, y + 0.93, z, 0.46, 0.17, 0.46), 0.22);
      const cap = smax(sdEllipsoid(x, y - 0.28, z, 1.1, 0.64, 1.1), 0.12 - y, 0.1);
      _dB = stem; _dA = cap; _dS = 1e9;
      return smin(stem, cap, 0.08);
    },
  },
];
// Uniform size tweaks keep every footprint near the die's, so all objects frame alike. The SDF is
// scaled (distances too); surface details keep working in design units (see buildTypeGeometry).
for (const T of OBJECT_TYPES) {
  const s = T.scale || 1;
  if (s === 1 || !T.sdf) continue;
  const f = T.sdf;
  T.sdf = (x, y, z) => { const d = f(x / s, y / s, z / s) * s; _dB *= s; _dA *= s; _dS *= s; return d; };
  T.center = T.center.map((c) => c * s); T.half = T.half.map((h) => h * s);
}
const TYPE_INDEX = Object.fromEntries(OBJECT_TYPES.map((t, i) => [t.id, i]));
// The die's collision/lattice stand-in (its mesh comes from the superellipsoid builder).
OBJECT_TYPES[0].sdf = (x, y, z) => { const d = sdRoundBox(x, y, z, 1.02, 1.02, 1.02, 0.31); _dB = d; _dA = 1e9; _dS = 1e9; return d; };

/** Match typed text (Chinese or English, any case, extra spaces) to an object type index, or -1. */
function matchObject(text) {
  const q = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return -1;
  for (let i = 0; i < OBJECT_TYPES.length; i++) if (OBJECT_TYPES[i].aliases.some((a) => a.toLowerCase() === q)) return i;
  for (let i = 0; i < OBJECT_TYPES.length; i++) if (OBJECT_TYPES[i].aliases.some((a) => q.includes(a.toLowerCase()) || (a.length > 2 && a.toLowerCase().includes(q)))) return i;
  return -1;
}

// ---------------------------------------------------------------- meshing
const _g = new Float64Array(3);
function sdfGrad(sdf, x, y, z, e, out) {
  out[0] = sdf(x + e, y, z) - sdf(x - e, y, z);
  out[1] = sdf(x, y + e, z) - sdf(x, y - e, z);
  out[2] = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

/**
 * Naive surface nets: one vertex per sign-changing cell (average of edge
 * crossings, then projected onto the surface), one quad per crossing edge.
 * Returns positions, normals and outward-wound triangles.
 */
function surfaceNets(sdf, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    field[i + nx * (j + ny * k)] = sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [], nrm = [];
  const cv = new Float64Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[(i + (c & 1)) + nx * ((j + ((c >> 1) & 1)) + ny * (k + ((c >> 2) & 1)))];
      cv[c] = v; if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let c = 0; c < 8; c++) for (const bit of [1, 2, 4]) {
      if (c & bit) continue;
      const c2 = c | bit, a = cv[c], b = cv[c2];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      sx += (c & 1) + t * ((c2 & 1) - (c & 1));
      sy += ((c >> 1) & 1) + t * (((c2 >> 1) & 1) - ((c >> 1) & 1));
      sz += ((c >> 2) & 1) + t * (((c2 >> 2) & 1) - ((c >> 2) & 1));
      n++;
    }
    let px = lo[0] + (i + sx / n) * h, py = lo[1] + (j + sy / n) * h, pz = lo[2] + (k + sz / n) * h;
    for (let it = 0; it < 3; it++) { // project onto the zero set
      const d = sdf(px, py, pz);
      sdfGrad(sdf, px, py, pz, h * 0.25, _g);
      px -= d * _g[0]; py -= d * _g[1]; pz -= d * _g[2];
    }
    sdfGrad(sdf, px, py, pz, h * 0.2, _g);
    cell[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(px, py, pz); nrm.push(_g[0], _g[1], _g[2]);
  }
  const tris = [];
  const ci = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz ? -1 : cell[i + cx * (j + cy * k)]);
  // One quad per sign-changing grid edge. The four cells are listed counter-clockwise around
  // the edge axis (x: +x, y: -y, z: +z facing); the quad is flipped when needed so it faces
  // away from the inside end of the edge — consistent orientation by construction.
  const quad = (flip, a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    const P = (v, o) => pos[v * 3 + o];
    const dAC = (P(a, 0) - P(c, 0)) ** 2 + (P(a, 1) - P(c, 1)) ** 2 + (P(a, 2) - P(c, 2)) ** 2;
    const dBD = (P(b, 0) - P(d, 0)) ** 2 + (P(b, 1) - P(d, 1)) ** 2 + (P(b, 2) - P(d, 2)) ** 2;
    if (dAC < dBD) tris.push(a, b, c, a, c, d); else tris.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = field[i + nx * (j + ny * k)] < 0;
    if (i + 1 < nx && v0 !== (field[(i + 1) + nx * (j + ny * k)] < 0)) quad(!v0, ci(i, j - 1, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i, j - 1, k));
    if (j + 1 < ny && v0 !== (field[i + nx * ((j + 1) + ny * k)] < 0)) quad(v0, ci(i - 1, j, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i - 1, j, k));
    if (k + 1 < nz && v0 !== (field[i + nx * (j + ny * (k + 1))] < 0)) quad(!v0, ci(i - 1, j - 1, k), ci(i, j - 1, k), ci(i, j, k), ci(i - 1, j, k));
  }
  return { pos: Float64Array.from(pos), nrm: Float64Array.from(nrm), tris: Uint32Array.from(tris) };
}

/** Small SDF grid of the rest shape, for fast object/object contacts in any orientation. */
function buildSdfGrid(type) {
  const T = OBJECT_TYPES[type], pad = 0.35, dims = CFG.SDF_DIMS;
  const lo = [T.center[0] - T.half[0] - pad, T.center[1] - T.half[1] - pad, T.center[2] - T.half[2] - pad];
  const size = [2 * (T.half[0] + pad), 2 * (T.half[1] + pad), 2 * (T.half[2] + pad)];
  const step = size.map((s) => s / (dims - 1));
  const data = new Float32Array(dims * dims * dims);
  for (let k = 0; k < dims; k++) for (let j = 0; j < dims; j++) for (let i = 0; i < dims; i++)
    data[i + dims * (j + dims * k)] = T.sdf(lo[0] + i * step[0], lo[1] + j * step[1], lo[2] + k * step[2]);
  return { lo, step, inv: step.map((s) => 1 / s), dims, data };
}

/** Trilinear SDF sample with gradient; returns 1e9 outside the grid. Writes the unit gradient into g. */
function sampleSdfGrid(G, x, y, z, g) {
  const fx = (x - G.lo[0]) * G.inv[0], fy = (y - G.lo[1]) * G.inv[1], fz = (z - G.lo[2]) * G.inv[2], n = G.dims;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= n - 1 || fy >= n - 1 || fz >= n - 1) return 1e9;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k, D = G.data;
  const o = i + n * (j + n * k);
  const c000 = D[o], c100 = D[o + 1], c010 = D[o + n], c110 = D[o + n + 1];
  const c001 = D[o + n * n], c101 = D[o + n * n + 1], c011 = D[o + n * n + n], c111 = D[o + n * n + n + 1];
  const x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx, x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
  // analytic gradient of the trilinear cell
  const dx0 = (c100 - c000) + ((c110 - c010) - (c100 - c000)) * ty, dx1 = (c101 - c001) + ((c111 - c011) - (c101 - c001)) * ty;
  g[0] = (dx0 + (dx1 - dx0) * tz) * G.inv[0];
  g[1] = ((x10 - x00) + ((x11 - x01) - (x10 - x00)) * tz) * G.inv[1];
  g[2] = (y1 - y0) * G.inv[2];
  const gl = Math.hypot(g[0], g[1], g[2]) || 1; g[0] /= gl; g[1] /= gl; g[2] /= gl;
  return y0 + (y1 - y0) * tz;
}

/**
 * Contact points on the surface, spaced by local convexity: a curved patch of
 * radius R needs spacing ≲ √(0.064·R) so the surface between points dips less than
 * ~4 mm below a touching plane. Thin stems, leaf rims and roof eaves get dense
 * points; broad flat faces sparse ones. Greedy, most curved candidates first.
 */
function contactSamples(sdf, pos) {
  const n = pos.length / 3, e = 0.02, rad = new Float64Array(n), order = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const lap = (sdf(x + e, y, z) + sdf(x - e, y, z) + sdf(x, y + e, z) + sdf(x, y - e, z) + sdf(x, y, z + e) + sdf(x, y, z - e) - 6 * sdf(x, y, z)) / (e * e);
    rad[v] = clamp(Math.sqrt(0.064 / Math.max(lap, 1e-6)), 0.045, 0.17);   // Δd = κ1 + κ2 (convex > 0)
    order[v] = v;
  }
  order.sort((a, b) => rad[a] - rad[b]);
  const cellSize = 0.17, hash = new Map(), out = [];
  const key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (const v of order) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], r = rad[v];
    const ci = Math.floor(x / cellSize), cj = Math.floor(y / cellSize), ck = Math.floor(z / cellSize);
    let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let c = -1; c <= 1 && ok; c++) {
      const list = hash.get(key(ci + a, cj + b, ck + c));
      if (list) for (const q of list) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < r * r) { ok = false; break; }
    }
    if (!ok) continue;
    const p = [x, y, z], k = key(ci, cj, ck);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(p); out.push(x, y, z);
  }
  return Float64Array.from(out);
}

// ---------------------------------------------------------------- per-type geometry
const ICO = makeIcosphere();

/** Twelve seeded bubbles per slot, placed well inside the object's SDF. */
function addBubbles(geo, type, inside, toU, writeVertex) {
  const icoCount = ICO.pos.length, X = new Float64Array(3), Nn = new Float64Array(3), u = new Float64Array(3);
  const T = OBJECT_TYPES[type];
  for (let d = 0; d < CFG.MAX_DICE; d++) {
    const rnd = mulberry32(9127 + d * 7919 + type * 104729);
    const centers = [];
    for (let bI = 0; bI < CFG.BUBBLES; bI++) {
      const r = rnd() < 0.72 ? lerp(0.014, 0.032, rnd()) : lerp(0.036, 0.062, rnd());
      let c = null;
      for (let tries = 0; tries < 80 && !c; tries++) {
        const cand = [T.center[0] + (rnd() * 2 - 1) * T.half[0] * 0.85, T.center[1] + (rnd() * 2 - 1) * T.half[1] * 0.85, T.center[2] + (rnd() * 2 - 1) * T.half[2] * 0.85];
        if (!inside(cand, r)) continue;
        if (centers.every((o) => Math.hypot(o[0] - cand[0], o[1] - cand[1], o[2] - cand[2]) > o[3] + r + 0.035)) c = [...cand, r];
      }
      if (!c) c = [T.center[0], T.center[1], T.center[2], 0.001];
      centers.push(c);
      for (let k = 0; k < icoCount; k++) {
        const p = ICO.pos[k];
        X[0] = c[0] + p[0] * c[3]; X[1] = c[1] + p[1] * c[3]; X[2] = c[2] + p[2] * c[3];
        Nn[0] = p[0]; Nn[1] = p[1]; Nn[2] = p[2];
        toU(X, u);
        writeVertex(geo.surfCount + d * geo.bubbleVerts + bI * icoCount + k, u, Nn, 0, 0, [0, 0, -1, type]);
      }
    }
  }
}

/**
 * Everything the GPU and the physics need for one object type. The die keeps
 * its own surface-shell lattice; every other object is embedded in an
 * axis-aligned box lattice around its mesh, so the rest map is affine and
 * exact. Its floor and object contacts then use sample points on the real
 * surface (see SoftDice.groundSamples), and node masses follow its volume.
 */
function buildTypeGeometry(type) {
  if (type === 0) return buildDiceGeometry();
  const T = OBJECT_TYPES[type], sdf = T.sdf, S = N - 1;
  const lo0 = [T.center[0] - T.half[0] - 0.06, T.center[1] - T.half[1] - 0.06, T.center[2] - T.half[2] - 0.06];
  const hi0 = [T.center[0] + T.half[0] + 0.06, T.center[1] + T.half[1] + 0.06, T.center[2] + T.half[2] + 0.06];
  const mesh = surfaceNets(sdf, lo0, hi0, 0.03);
  const surfCount = mesh.pos.length / 3, icoCount = ICO.pos.length, bubbleVerts = CFG.BUBBLES * icoCount;

  // lattice box just around the mesh
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < surfCount; v++) for (let a = 0; a < 3; a++) {
    const c = mesh.pos[v * 3 + a];
    if (c < bmin[a]) bmin[a] = c; if (c > bmax[a]) bmax[a] = c;
  }
  const pad = 0.03, lo = bmin.map((c) => c - pad), size = bmax.map((c, a) => c - bmin[a] + 2 * pad);
  const rest = new Float64Array(NP * 3);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const o = nid(i, j, k) * 3;
    rest[o] = lo[0] + size[0] * i / S; rest[o + 1] = lo[1] + size[1] * j / S; rest[o + 2] = lo[2] + size[2] * k / S;
  }
  const restExt = new Float64Array(NEP * 3);
  extendNodes(rest, 0, restExt, 0, 3);
  const toU = (X, u) => { for (let a = 0; a < 3; a++) u[a] = (X[a] - lo[a]) / size[a] * S; return u; };
  const js = [size[0] / S, size[1] / S, size[2] / S];   // diagonal Jacobian of the rest map

  const vin = new Float32Array((surfCount + CFG.MAX_DICE * bubbleVerts) * 12);
  const writeVertex = (vi, uu, n, stemW, accW, st) => {
    const mx = js[0] * n[0], my = js[1] * n[1], mz = js[2] * n[2], ml = Math.hypot(mx, my, mz) || 1;   // m = Jᵀ n
    const o = vi * 12;
    vin[o] = uu[0]; vin[o + 1] = uu[1]; vin[o + 2] = uu[2]; vin[o + 3] = stemW;
    vin[o + 4] = mx / ml; vin[o + 5] = my / ml; vin[o + 6] = mz / ml; vin[o + 7] = accW;
    vin[o + 8] = st[0]; vin[o + 9] = st[1]; vin[o + 10] = st[2]; vin[o + 11] = st[3];
  };
  const X = new Float64Array(3), Nn = new Float64Array(3), u = new Float64Array(3);
  const soft = 0.035;   // part blend width (world units)
  for (let v = 0; v < surfCount; v++) {
    X[0] = mesh.pos[v * 3]; X[1] = mesh.pos[v * 3 + 1]; X[2] = mesh.pos[v * 3 + 2];
    Nn[0] = mesh.nrm[v * 3]; Nn[1] = mesh.nrm[v * 3 + 1]; Nn[2] = mesh.nrm[v * 3 + 2];
    sdf(X[0], X[1], X[2]);
    const wS = clamp(0.5 - (_dS - Math.min(_dB, _dA)) / (2 * soft), 0, 1);
    const wA = clamp(0.5 - (_dA - Math.min(_dB, _dS)) / (2 * soft), 0, 1) * (1 - wS);
    const ds = T.scale || 1;   // decals are drawn in design units
    writeVertex(v, toU(X, u), Nn, wS, wA, [X[0] / ds, X[1] / ds, X[2] / ds, type]);
  }
  const geo = { type, rest, restExt, vin, surfCount, bubbleVerts, perDie: surfCount + bubbleVerts, failures: 0, box: { lo, size } };
  addBubbles(geo, type, (c, r) => sdf(c[0], c[1], c[2]) < -(r + 0.09), toU, writeVertex);

  // indices: surface, then one bubble pattern (local ids) reused by every slot
  const bubbleIdx = [];
  for (let bI = 0; bI < CFG.BUBBLES; bI++) for (const [a, b, c] of ICO.tris) bubbleIdx.push(surfCount + bI * icoCount + a, surfCount + bI * icoCount + b, surfCount + bI * icoCount + c);
  geo.idx = new Uint32Array(mesh.tris.length + bubbleIdx.length);
  geo.idx.set(mesh.tris, 0); geo.idx.set(bubbleIdx, mesh.tris.length);
  geo.surfIdxCount = mesh.tris.length; geo.bubbleIdxCount = bubbleIdx.length;

  // coarse picking proxy, and a sparser set of surface points for contacts
  const pm = surfaceNets(sdf, lo0, hi0, 0.13);
  const pu = new Float64Array(pm.pos.length);
  for (let v = 0; v < pm.pos.length / 3; v++) { X[0] = pm.pos[v * 3]; X[1] = pm.pos[v * 3 + 1]; X[2] = pm.pos[v * 3 + 2]; toU(X, u); pu.set(u, v * 3); }
  geo.proxy = { u: pu, tris: pm.tris };
  const cp = contactSamples(sdf, mesh.pos);
  geo.samples = new Float64Array(cp.length);
  for (let v = 0; v < cp.length / 3; v++) { X[0] = cp[v * 3]; X[1] = cp[v * 3 + 1]; X[2] = cp[v * 3 + 2]; toU(X, u); geo.samples.set(u, v * 3); }

  // node masses follow the object's volume (4³ probes in each node's dual cell), over a uniform floor
  const occ = new Float64Array(NP), cs = js;
  let occSum = 0;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const id = nid(i, j, k), o = id * 3, a0 = [], a1 = [];
    for (let a = 0; a < 3; a++) { a0[a] = Math.max(rest[o + a] - cs[a] / 2, lo[a]); a1[a] = Math.min(rest[o + a] + cs[a] / 2, lo[a] + size[a]); }
    let inside = 0;
    for (let c = 0; c < 64; c++) {
      const px = a0[0] + (a1[0] - a0[0]) * ((c & 3) + 0.5) / 4, py = a0[1] + (a1[1] - a0[1]) * (((c >> 2) & 3) + 0.5) / 4, pz = a0[2] + (a1[2] - a0[2]) * (((c >> 4) & 3) + 0.5) / 4;
      if (sdf(px, py, pz) < 0) inside++;
    }
    occ[id] = inside / 64 * (a1[0] - a0[0]) * (a1[1] - a0[1]) * (a1[2] - a0[2]);
    occSum += occ[id];
  }
  geo.nodeMass = new Float64Array(NP);
  for (let id = 0; id < NP; id++) geo.nodeMass[id] = 0.3 / NP + 0.7 * occ[id] / occSum;
  geo.grid = buildSdfGrid(type);
  return geo;
}

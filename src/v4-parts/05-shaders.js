
// ============================================================================
// 6. WGSL SHADERS
// ============================================================================
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const wv = (v) => `vec3f(${v.map((n) => n.toFixed(5)).join(', ')})`;
function boxFrame(dir) { // orthonormal frame of a softbox centred on direction `dir`
  const c = norm3(dir);
  let u = cross3(c, [0, 1, 0]);
  if (Math.hypot(...u) < 1e-3) u = [1, 0, 0];
  u = norm3(u);
  return { c, u, v: cross3(u, c) };
}
/** Stage paper as linear RGB. A host page may set its own ground colour (JELLY_CONFIG.paper, sRGB hex); the tone map passes it through 1:1. */
const PAPER_LIN = (() => {
  const hex = window.JELLY_CONFIG && window.JELLY_CONFIG.paper;
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return [0.888, 0.846, 0.783];   // #F2EDE5
  return [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
})();
const LIGHT_DIR = norm3([-0.52, 1.0, 0.42]);           // toward the key light (upper left, front) — shadows & diffuse
// Reflection cards live in camera-yaw space (camera on +z), like a product photographer's
// softboxes that move with the camera: highlights stay flattering from any orbit angle.
const ENV_TOP = boxFrame([0.0, 0.72, -0.69]);           // large soft panel above/behind → top-face sheen
const ENV_KEY = boxFrame([-0.72, 0.55, 0.42]);          // key card, front-left
const ENV_RIM = boxFrame([0.80, 0.30, -0.52]);          // thin strip, right-back → edge glints
const ENV_FILL = boxFrame([0.60, 0.15, 0.78]);          // low fill, front-right

// Mushroom cap dots: directions on the (unit-scaled) cap dome, w = radius in world units.
const MUSHROOM_DOTS = Array.from({ length: 14 }, (_, i) => {
  const y = 1 - (i + 0.5) / 14 * 0.7, r = Math.sqrt(1 - y * y), a = i * 2.39996 + 0.3;
  return [r * Math.cos(a), y, r * Math.sin(a), 0.07 + 0.055 * ((i * 7919) % 11) / 10];
});

const WGSL_STRUCTS = /* wgsl */`
struct Frame {
  viewProj : mat4x4f,
  view : mat4x4f,
  invViewProj : mat4x4f,
  lightViewProj : mat4x4f,
  camPos : vec4f,     // xyz eye, w time
  lightDir : vec4f,   // xyz toward key light, w shadow half extent
  res : vec4f,        // px size, 1/px size
  sigma : vec4f,      // (unused: materials are per object, see Die)
  scatter : vec4f,    // (unused)
  depthInfo : vec4f,  // near, far, light depth range, light reference depth
  params : vec4f,     // object count, exposure, pip opacity, debug view
  vcount : vec4u,     // (unused)
  env : vec4f,        // cos(camera yaw), sin(camera yaw), reflection intensity, unused
};
struct Die {
  center : vec4f,     // xyz fitted mass centre, w bounding radius
  ax : vec4f, ay : vec4f, az : vec4f,   // world directions of the rest-frame axes; w: 1 / SDF grid step per axis
  rect : vec4f,       // backdrop rectangle (px)
  aoC : vec4f,        // rest-frame mass centre (xyz)
  aoH : vec4f,        // rest-frame origin of the SDF grid (xyz), w object type
  sigB : vec4f, scB : vec4f,   // body: absorption per unit (rgb) + density | in-scatter albedo + strength
  sigA : vec4f, scA : vec4f,   // accent part
  sigS : vec4f, scS : vec4f,   // stem part
};
struct VIn { u : vec4f, m : vec4f, st : vec4f };
struct VOut { pos : vec4f, nrm : vec4f, st : vec4f };   // pos.w stem weight, nrm.w accent weight, st decal coords
const VCAP = ${CFG.VCAP}u;       // deformed vertices reserved per object slot
const GD = ${CFG.SDF_DIMS}.0;       // SDF grid samples per axis (one slab per object type)
const NT = ${CFG.SDF_SLABS}.0;      // slabs in the SDF atlas
const PI = 3.14159265;
const PAPER = vec3f(${PAPER_LIN.map((v) => v.toFixed(4)).join(', ')});
const KEY = vec3f(1.0, 0.972, 0.93);
`;

// ---- compute: evaluate the C1 tricubic lattice map for every vertex ----
const WGSL_DEFORM = WGSL_STRUCTS + /* wgsl */`
struct Slot { vinBase : u32, surf : u32, bubble : u32, perDie : u32 };
@group(0) @binding(0) var<storage, read> nodes : array<vec4f>;
@group(0) @binding(1) var<storage, read> vin : array<VIn>;
@group(0) @binding(2) var<storage, read_write> vout : array<VOut>;
@group(0) @binding(3) var<uniform> slots : array<Slot, ${CFG.MAX_DICE}>;

fn crW(t : f32) -> vec4f {
  let t2 = t * t; let t3 = t2 * t;
  return 0.5 * vec4f(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2);
}
fn crD(t : f32) -> vec4f {
  let t2 = t * t;
  return 0.5 * vec4f(-3.0 * t2 + 4.0 * t - 1.0, 9.0 * t2 - 10.0 * t, -9.0 * t2 + 8.0 * t + 1.0, 3.0 * t2 - 2.0 * t);
}

@compute @workgroup_size(64)
fn deform(@builtin(global_invocation_id) gid : vec3u) {
  let li = gid.x;
  let die = gid.y;
  let S = slots[die];
  if (li >= S.perDie) { return; }
  var si = S.vinBase + li;
  if (li >= S.surf) { si = S.vinBase + S.surf + die * S.bubble + (li - S.surf); }
  let v = vin[si];
  let u = v.u.xyz;
  let c = clamp(floor(u), vec3f(0.0), vec3f(${N - 2}.0));
  let t = u - c;
  let wx = crW(t.x); let wy = crW(t.y); let wz = crW(t.z);
  let dx = crD(t.x); let dy = crD(t.y); let dz = crD(t.z);
  let ci = vec3i(c);
  let base = i32(die) * ${NEP};
  var P = vec3f(0.0); var Ju = vec3f(0.0); var Jv = vec3f(0.0); var Jw = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    var Pk = vec3f(0.0); var Uk = vec3f(0.0); var Vk = vec3f(0.0);
    for (var j = 0; j < 4; j++) {
      var Pj = vec3f(0.0); var Uj = vec3f(0.0);
      let row = base + ((ci.z + k) * ${NE} + (ci.y + j)) * ${NE} + ci.x;
      for (var i = 0; i < 4; i++) {
        let n = nodes[row + i].xyz;
        Pj += wx[i] * n;
        Uj += dx[i] * n;
      }
      Pk += wy[j] * Pj; Uk += wy[j] * Uj; Vk += dy[j] * Pj;
    }
    P += wz[k] * Pk; Ju += wz[k] * Uk; Jv += wz[k] * Vk; Jw += dz[k] * Pk;
  }
  // deformed normal = cofactor(J) · m  (m = Jrestᵀ·n_rest, stored per vertex)
  let m = v.m.xyz;
  var n = cross(Jv, Jw) * m.x + cross(Jw, Ju) * m.y + cross(Ju, Jv) * m.z;
  let nl = length(n);
  n = select(vec3f(0.0, 1.0, 0.0), n / nl, nl > 1e-12);
  vout[die * VCAP + li] = VOut(vec4f(P, v.u.w), vec4f(n, v.m.w), v.st);
}
`;

// ---- shared render declarations (group 0) ----
const WGSL_GEOM = WGSL_STRUCTS + /* wgsl */`
@group(0) @binding(0) var<uniform> F : Frame;
@group(0) @binding(1) var<storage, read> dice : array<Die>;
@group(0) @binding(2) var<storage, read> verts : array<VOut>;

struct DieVary {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) st : vec4f,
  @location(3) @interpolate(flat) die : u32,
  @location(4) parts : vec2f,   // stem, accent weights
};

fn linDepth(d : f32) -> f32 {
  let n = F.depthInfo.x; let f = F.depthInfo.y;
  return n * f / (f - d * (f - n));
}
fn ign(p : vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@vertex fn vsDie(@builtin(vertex_index) vi : u32, @builtin(instance_index) die : u32) -> DieVary {
  let o = verts[die * VCAP + vi];
  var out : DieVary;
  out.clip = F.viewProj * vec4f(o.pos.xyz, 1.0);
  out.world = o.pos.xyz;
  out.nrm = o.nrm.xyz;
  out.st = o.st;
  out.die = die;
  out.parts = vec2f(o.pos.w, o.nrm.w);
  return out;
}
@vertex fn vsLight(@builtin(vertex_index) vi : u32, @builtin(instance_index) die : u32) -> @builtin(position) vec4f {
  let o = verts[die * VCAP + vi];
  return F.lightViewProj * vec4f(o.pos.xyz, 1.0);
}
struct ThickVary { @builtin(position) clip : vec4f, @location(0) z : f32, @location(1) @interpolate(flat) sig : vec3f };
@vertex fn vsThick(@builtin(vertex_index) vi : u32, @builtin(instance_index) die : u32) -> ThickVary {
  let o = verts[die * VCAP + vi];
  let c = F.lightViewProj * vec4f(o.pos.xyz, 1.0);
  var out : ThickVary;
  out.clip = c;
  out.z = c.z * F.depthInfo.z - F.depthInfo.w;   // light-space depth in world units, near the objects ≈ 0
  out.sig = dice[die].sigB.rgb * dice[die].sigB.w;
  return out;
}
// Additive optical depth: back faces add depth·σ, front faces subtract → Σ thickness·σ along the
// light ray, so overlapping objects of different colours tint the shadow correctly.
@fragment fn fsThick(in : ThickVary, @builtin(front_facing) ff : bool) -> @location(0) vec4f {
  return vec4f(select(in.z, -in.z, ff) * in.sig, 1.0);
}

struct FullVary { @builtin(position) clip : vec4f, @location(0) uv : vec2f };
@vertex fn vsFull(@builtin(vertex_index) vi : u32) -> FullVary {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out : FullVary;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
`;

// ---- studio environment (reflections) ----
const WGSL_ENV = /* wgsl */`
fn softbox(d : vec3f, c : vec3f, ux : vec3f, uy : vec3f, hs : vec2f, rad : f32, soft : f32) -> f32 {
  let k = dot(d, c);
  if (k <= 0.05) { return 0.0; }
  let p = d / k;
  let q = abs(vec2f(dot(p, ux), dot(p, uy))) - hs + vec2f(rad);
  let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rad;
  return 1.0 - smoothstep(-soft, soft, sd);
}
fn envColor(dw : vec3f) -> vec3f {
  let cy = F.env.x; let sy = F.env.y;
  let d = vec3f(dw.x * cy - dw.z * sy, dw.y, dw.x * sy + dw.z * cy);    // world → camera-yaw space
  var c = mix(PAPER * 0.60, PAPER * 0.97, smoothstep(-0.45, 0.04, d.y));   // table bounce → horizon
  c = mix(c, vec3f(0.975, 0.968, 0.955), smoothstep(0.10, 0.85, d.y));    // pale ceiling
  var b = vec3f(1.0, 0.985, 0.96) * 1.9 * softbox(d, ${wv(ENV_TOP.c)}, ${wv(ENV_TOP.u)}, ${wv(ENV_TOP.v)}, vec2f(0.62, 0.34), 0.2, 0.1);
  b += KEY * 2.4 * softbox(d, ${wv(ENV_KEY.c)}, ${wv(ENV_KEY.u)}, ${wv(ENV_KEY.v)}, vec2f(0.34, 0.44), 0.14, 0.07);
  b += vec3f(0.95, 0.97, 1.0) * 2.6 * softbox(d, ${wv(ENV_RIM.c)}, ${wv(ENV_RIM.u)}, ${wv(ENV_RIM.v)}, vec2f(0.07, 0.55), 0.06, 0.04);
  b += KEY * 0.6 * softbox(d, ${wv(ENV_FILL.c)}, ${wv(ENV_FILL.u)}, ${wv(ENV_FILL.v)}, vec2f(0.6, 0.25), 0.2, 0.12);
  return c + b * F.env.z;
}
fn ggx(N : vec3f, V : vec3f, L : vec3f, rough : f32) -> f32 {
  let h = normalize(V + L);
  let ndh = max(dot(N, h), 0.0); let ndl = max(dot(N, L), 0.0); let ndv = max(dot(N, V), 1e-3);
  let a = rough * rough; let a2 = a * a;
  let dd = ndh * ndh * (a2 - 1.0) + 1.0;
  let k = a * 0.5;
  return a2 / (PI * dd * dd) * ndl / (ndl * (1.0 - k) + k) / (ndv * (1.0 - k) + k) * 0.25;
}
`;

// ---- jelly surface (front faces of one object) ----
const WGSL_DIE = WGSL_GEOM + WGSL_ENV + /* wgsl */`
@group(1) @binding(0) var backdrop : texture_2d<f32>;
@group(1) @binding(1) var backDepth : texture_depth_2d;
@group(1) @binding(2) var samp : sampler;

const IOR = 1.45;
var<private> DOTS : array<vec4f, ${MUSHROOM_DOTS.length}> = array<vec4f, ${MUSHROOM_DOTS.length}>(${MUSHROOM_DOTS.map((d) => `vec4f(${d.map((n) => n.toFixed(4)).join(', ')})`).join(', ')});

fn faceValue(f : i32) -> i32 { // must match FACES in JS
  switch f {
    case 0: { return 2; }
    case 1: { return 5; }
    case 2: { return 3; }
    case 3: { return 4; }
    case 4: { return 1; }
    default: { return 6; }
  }
}

/** Signed distance (face units) to the nearest pip's cream fill; negative inside. */
fn pipSD(face : i32, st : vec2f) -> f32 {
  if (face < 0 || face > 5) { return 1.0; }
  let v = faceValue(face);
  let g = ${CFG.PIP_G.toFixed(4)};
  let r = select(${CFG.PIP_R.toFixed(4)}, ${CFG.PIP_R1.toFixed(4)}, v == 1) * ${CFG.PIP_FILL.toFixed(3)};
  var d = 10.0;
  if (v == 1 || v == 3 || v == 5) { d = min(d, length(st)); }
  if (v >= 2) { d = min(d, min(length(st - vec2f(-g, -g)), length(st - vec2f(g, g)))); }
  if (v >= 4) { d = min(d, min(length(st - vec2f(g, -g)), length(st - vec2f(-g, g)))); }
  if (v == 6) { d = min(d, min(length(st - vec2f(-g, 0.0)), length(st - vec2f(g, 0.0)))); }
  return d - r;
}

fn sdRect2(p : vec2f, h : vec2f, r : f32) -> f32 {
  let q = abs(p) - h + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/** A decal layer: signed distance (negative inside), colour, max opacity, emission (0 = lit like candy). */
struct Deco { sd : f32, col : vec3f, alpha : f32, emit : f32 };

/**
 * Per-object surface details, evaluated in rest space (so they follow every deformation).
 * No derivatives in here: the caller anti-aliases with fwidth() in uniform control flow.
 */
fn decal(kind : i32, st : vec4f, parts : vec2f) -> Deco {
  var o = Deco(1.0, vec3f(0.0), 0.0, 0.0);
  let p = st.xyz;
  switch kind {
    case 0: {   // die: milky cream pips
      o = Deco(pipSD(i32(floor(st.z + 0.5)), st.xy), vec3f(0.935, 0.91, 0.865), F.params.z, 0.0);
    }
    case 1: {   // pine cone: darker seams between the scales (same lattice as the shape's bumps)
      let th = atan2(p.z, p.x);
      let u1 = (8.0 * th + 15.0 * p.y) / 6.2831853; let u2 = (13.0 * th - 15.0 * p.y) / 6.2831853;
      let cd = abs(fract(u1) - 0.5) + abs(fract(u2) - 0.5);
      let fade = 1.0 - smoothstep(0.85, 1.2, abs(p.y + 0.05));
      o = Deco((0.76 - cd) * 0.35, vec3f(0.06, 0.03, 0.012), 0.36 * fade * (1.0 - parts.x), 0.0);
    }
    case 2: {   // gourd: a thin red cord tied at the waist
      o = Deco(abs(p.y - 0.23) - 0.03, vec3f(0.55, 0.035, 0.03), 0.96 * (1.0 - parts.x), 0.0);
    }
    case 3: {   // ginkgo: fine veins fanning out from the stalk
      let q = vec2f(p.x, p.z + 0.8);
      let r = length(q);
      let v = abs(fract(atan2(q.x, q.y) / 0.072) - 0.5);
      o = Deco((v - 0.09) * 0.072 * r, vec3f(0.05, 0.035, 0.0), 0.3 * smoothstep(0.25, 0.45, r) * (1.0 - parts.y), 0.0);
    }
    case 4: {   // acorn: scaly texture on the cap
      let th = atan2(p.z, p.x);
      let s = sin(18.0 * th) * sin(24.0 * p.y);
      o = Deco((s + 0.35) * 0.04, vec3f(0.07, 0.035, 0.015), 0.4 * parts.y, 0.0);
    }
    case 5: {   // pebble: a quartz vein, plus a hairline beside it
      let d = dot(p - vec3f(0.0, 0.03, 0.0), normalize(vec3f(0.35, 0.85, 0.4)));
      o = Deco(min(abs(d - 0.12) - 0.03, abs(d + 0.2) - 0.009), vec3f(0.93, 0.92, 0.885), 0.9, 0.0);
    }
    case 7: {   // phone: dark glass screen on the front, two camera lenses on the back
      // masks are distances too (max), so the anti-aliasing width never jumps
      let screen = max(sdRect2(p.xz, vec2f(0.55, 1.19), 0.1), 0.1 - p.y);
      let lens = max(min(length(p.xz - vec2f(-0.4, -0.8)), length(p.xz - vec2f(-0.2, -1.0))) - 0.07, p.y + 0.165);
      o = Deco(min(screen, lens), vec3f(0.012, 0.014, 0.018), select(0.95, 0.93, screen < lens), 0.0);
    }
    case 8: {   // home: warm lit windows and a wooden door (face masks as distances: no seams)
      let door = max(sdRect2(p.xy - vec2f(0.27, -0.72), vec2f(0.15, 0.29), 0.05), 0.6 - p.z);
      let wf = max(sdRect2(p.xy - vec2f(-0.36, -0.42), vec2f(0.16, 0.14), 0.03), 0.6 - p.z);
      let wb = max(sdRect2(p.xy - vec2f(0.05, -0.42), vec2f(0.17, 0.14), 0.03), p.z + 0.6);
      let ws = max(sdRect2(p.zy - vec2f(0.0, -0.42), vec2f(0.15, 0.14), 0.03), 0.7 - abs(p.x));
      let w = min(wf, min(wb, ws));
      if (door < w) { o = Deco(door, vec3f(0.2, 0.09, 0.04), 0.9, 0.0); }
      else { o = Deco(w, vec3f(1.0, 0.66, 0.3), 0.92, 1.0); }
    }
    case 9: {   // mushroom: white dots on the cap, fine gills underneath (masks as distances)
      let q = normalize(vec3f(p.x / 1.1, (p.y - 0.28) / 0.64, p.z / 1.1));
      var d = 10.0;
      for (var i = 0; i < ${MUSHROOM_DOTS.length}; i++) {
        d = min(d, acos(clamp(dot(q, DOTS[i].xyz), -1.0, 1.0)) * 1.0 - DOTS[i].w);
      }
      let dots = max(d, 0.16 - p.y);
      let g = abs(fract(atan2(p.z, p.x) * 46.0 / 6.2831853) - 0.5);
      let gills = max((g - 0.18) * 0.2 * length(p.xz), p.y - 0.16);
      if (dots < gills) { o = Deco(dots, vec3f(0.95, 0.94, 0.9), 0.95 * parts.y, 0.0); }
      else { o = Deco(gills, vec3f(0.3, 0.2, 0.12), 0.35 * parts.y * smoothstep(0.35, 0.55, length(p.xz)), 0.0); }
    }
    default: {}
  }
  return o;
}

@fragment fn fsDie(in : DieVary, @builtin(front_facing) ff : bool) -> @location(0) vec4f {
  let dd = dice[in.die];
  // decal coverage first: derivatives must stay in uniform control flow
  let dc = decal(i32(dd.aoH.w + 0.5), in.st, in.parts);
  let aa = max(fwidth(dc.sd), 1e-4);
  let cover = (1.0 - smoothstep(-aa, aa, dc.sd)) * dc.alpha;

  var N = normalize(in.nrm);
  if (!ff) { N = -N; }
  let P = in.world;
  let V = normalize(F.camPos.xyz - P);
  let NdV = clamp(dot(N, V), 0.0, 1.0);
  let L = F.lightDir.xyz;
  let NdL = dot(N, L);

  // this fragment's material: body, accent and stem blend by the part weights
  let wS = clamp(in.parts.x, 0.0, 1.0); let wA = clamp(in.parts.y, 0.0, 1.0);
  let sg = mix(mix(dd.sigB, dd.sigA, wA), dd.sigS, wS);
  let sc = mix(mix(dd.scB, dd.scA, wA), dd.scS, wS);
  let sig = sg.rgb * sg.w;

  // thickness along the view ray from this object's own back faces
  let bd = textureLoad(backDepth, vec2i(in.clip.xy), 0);
  let front = linDepth(in.clip.z);
  var thick = select(0.0, max(linDepth(bd) - front, 0.0), bd > 0.0);
  thick = min(thick, 3.4);

  // refraction: approximate the exit point and read what lies behind this object
  let T = refract(-V, N, 1.0 / IOR);
  let ep = F.viewProj * vec4f(P + T * (thick * 0.72 + 0.04), 1.0);
  let lo = dd.rect.xy + vec2f(1.5);
  let hi = dd.rect.zw - vec2f(1.5);
  let uv = clamp(vec2f(ep.x / ep.w * 0.5 + 0.5, 0.5 - ep.y / ep.w * 0.5) * F.res.xy, lo, hi);
  // thickness-scaled blur ≈ soft internal scattering (thin edges stay clear)
  let blurPx = (0.6 + thick * 4.0) * (F.res.y / 1100.0);
  let rot = ign(in.clip.xy) * 6.2831853;
  var bg = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    let r = sqrt((f32(i) + 0.5) / 8.0) * blurPx;
    let a = f32(i) * 2.3999632 + rot;
    let q = clamp(uv + vec2f(cos(a), sin(a)) * r, lo, hi);
    bg += textureSampleLevel(backdrop, samp, q * F.res.zw, 0.0).rgb;
  }
  bg *= 0.125;

  // Beer–Lambert absorption + in-scattering: thick = deep colour, thin = light passes
  let trans = exp(-sig * thick);
  let amb = mix(PAPER * 0.52, vec3f(0.985, 0.975, 0.96), N.y * 0.5 + 0.5);
  let wrap = clamp((NdL + 0.6) / 1.6, 0.0, 1.0);
  let inLight = amb * 0.8 + KEY * wrap * 0.55;
  // in-scatter builds up with depth, but light deep inside is itself absorbed:
  // clear thin edges → glowing mid-depths → deep saturated core
  let deep = 0.2 + 0.8 * exp(-sig * thick * 0.35);
  let scat = sc.rgb * inLight * (vec3f(1.0) - exp(-sig * thick * 0.9)) * deep * sc.w;
  // key light glowing through thin parts toward the eye
  let bl = pow(clamp(dot(V, -normalize(L + N * 0.5)), 0.0, 1.0), 3.0);
  let glow = KEY * sc.rgb * bl * exp(-sig * thick * 0.55) * 1.1;
  var body = bg * trans + scat + glow;

  // decal layer: a soft opaque candy coat (pips, cord, screen …) or a warm emissive window
  let lit = dc.col * (amb * 0.9 + KEY * max(NdL, 0.0) * 0.52);
  body = mix(body, mix(lit, dc.col * 1.25, dc.emit), cover);

  // glossy coat: studio reflections with Fresnel, plus a soft key sheen
  let fres = 0.034 + 0.966 * pow(1.0 - NdV, 5.0);
  let env = envColor(reflect(-V, N));
  let spec = KEY * ggx(N, V, L, 0.24) * 0.55;
  let col = body * (1.0 - fres) + env * fres + spec;
  if (F.params.w > 0.5) { return vec4f(vec3f(thick / 2.5), 1.0); }   // debug: thickness view
  return vec4f(col * F.params.y, 1.0);
}
`;

// ---- tiny air bubbles, drawn after the object's surface with the right absorption ----
const WGSL_BUBBLE = WGSL_GEOM + /* wgsl */`
@group(1) @binding(0) var sceneDepth : texture_depth_2d;

@vertex fn vsBubble(@builtin(vertex_index) vi : u32, @builtin(instance_index) die : u32) -> DieVary {
  let o = verts[die * VCAP + vi];
  var out : DieVary;
  out.clip = F.viewProj * vec4f(o.pos.xyz, 1.0);
  out.world = o.pos.xyz;
  out.nrm = o.nrm.xyz;
  out.st = vec4f(0.0, 0.0, -1.0, 0.0);
  out.die = die;
  out.parts = vec2f(0.0);
  return out;
}
@fragment fn fsBubble(in : DieVary) -> @location(0) vec4f {
  let N = normalize(in.nrm);
  let V = normalize(F.camPos.xyz - in.world);
  let ndv = abs(dot(N, V));
  let L = F.lightDir.xyz;
  let fd = textureLoad(sceneDepth, vec2i(in.clip.xy), 0);
  let inside = max(linDepth(in.clip.z) - linDepth(fd), 0.0);
  let sg = dice[in.die].sigB;
  let tr = exp(-sg.rgb * sg.w * inside);       // light from the bubble crosses candy to the eye
  let rim = pow(1.0 - ndv, 1.7);
  let hl = pow(max(dot(N, normalize(L + V)), 0.0), 80.0);
  let a = clamp(rim * 0.55, 0.0, 0.55) * (0.3 + 0.7 * dot(tr, vec3f(0.3333)));
  let c = vec3f(0.02, 0.025, 0.03) * a + (KEY * 1.7 * hl + vec3f(0.92, 0.94, 0.96) * rim * 0.14) * tr;
  return vec4f(c * F.params.y, clamp(a + hl * 0.5, 0.0, 0.85));
}
`;

// ---- floor: seamless paper sweep, coloured soft shadows, contact occlusion ----
const WGSL_FLOOR = WGSL_GEOM + /* wgsl */`
@group(1) @binding(0) var shadowDepth : texture_depth_2d;
@group(1) @binding(1) var shadowThick : texture_2d<f32>;
@group(1) @binding(2) var cmpSamp : sampler_comparison;
@group(1) @binding(3) var linSamp : sampler;
@group(1) @binding(4) var sdfAtlas : texture_3d<f32>;

// Signed distance to an object's rest shape, carried by its fitted rigid frame: one trilinear
// sample of its slab in the SDF atlas (outside the grid: distance to the grid box added).
fn sdDie(p : vec3f, d : Die) -> f32 {
  let rel = p - d.center.xyz;
  let q = vec3f(dot(rel, d.ax.xyz), dot(rel, d.ay.xyz), dot(rel, d.az.xyz)) + d.aoC.xyz;
  let inv = vec3f(d.ax.w, d.ay.w, d.az.w);
  let f = (q - d.aoH.xyz) * inv;
  let fc = clamp(f, vec3f(0.0), vec3f(GD - 1.0));
  let outside = length((f - fc) / inv);
  let uvw = vec3f((fc.xy + 0.5) / GD, (floor(d.aoH.w + 0.5) * GD + fc.z + 0.5) / (GD * NT));
  return textureSampleLevel(sdfAtlas, linSamp, uvw, 0.0).r + outside;
}

fn keyShadow(P : vec3f, jitter : f32) -> vec3f {
  let L = F.lightDir.xyz;
  // cheap reject: is any object's light-projected footprint near this point?
  var near = false;
  for (var i = 0u; i < u32(F.params.x); i++) {
    let c = dice[i].center;
    let fp = c.xyz - L * (c.y / L.y);
    if (distance(fp.xz, P.xz) < c.w * 1.9 + 1.2) { near = true; }
  }
  if (!near) { return vec3f(1.0); }
  let lp = F.lightViewProj * vec4f(P, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let zr = lp.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec3f(1.0); }
  let size = vec2f(textureDimensions(shadowDepth));
  // 1) blocker search (PCSS): average occluder depth near this point
  var bsum = 0.0; var bcnt = 0.0;
  for (var i = 0; i < 16; i++) {
    let a = f32(i) * 2.3999632 + jitter * 6.2831853;
    let o = vec2f(cos(a), sin(a)) * sqrt((f32(i) + 0.5) / 16.0) * 0.034;
    let d = textureLoad(shadowDepth, vec2i(clamp((uv + o) * size, vec2f(0.0), size - 1.0)), 0);
    if (d < zr - 0.0004) { bsum += d; bcnt += 1.0; }
  }
  if (bcnt < 0.5) { return vec3f(1.0); }
  let distW = (zr - bsum / bcnt) * F.depthInfo.z;      // receiver → occluder, world units
  let penUV = (0.03 + distW * 0.2) / (2.0 * F.lightDir.w);
  // 2) filtered, coloured visibility: light that crosses candy keeps its colour
  var acc = vec3f(0.0);
  for (var i = 0; i < 20; i++) {
    let a = f32(i) * 2.3999632 + jitter * 6.2831853;
    let q = uv + vec2f(cos(a), sin(a)) * sqrt((f32(i) + 0.5) / 20.0) * penUV;
    let vis = textureSampleCompareLevel(shadowDepth, cmpSamp, q, zr - 0.0004);
    let od = max(textureSampleLevel(shadowThick, linSamp, q, 0.0).rgb, vec3f(0.0));
    acc += mix(exp(-od * 0.62), vec3f(1.0), vis);
  }
  return acc / 20.0;
}

// Distance-field ambient occlusion of the floor: probe upward, compare free space with probe height.
fn contactAO(P : vec3f) -> vec3f {
  var nearAny = false;
  for (var i = 0u; i < u32(F.params.x); i++) {
    let rel = P.xz - dice[i].center.xz;
    if (dot(rel, rel) < 16.0) { nearAny = true; }
  }
  if (!nearAny) { return vec3f(1.0); }
  var occ = 0.0;
  var w = 1.0;
  var nearest = 0u;
  for (var k = 1; k <= 5; k++) {
    let h = 0.06 + 0.075 * f32(k * k);                 // 0.135 … 1.935 world units
    let q = P + vec3f(0.0, h, 0.0);
    var sd = 99.0;
    for (var i = 0u; i < u32(F.params.x); i++) {
      let s = sdDie(q, dice[i]);
      if (s < sd) { sd = s; if (k == 1) { nearest = i; } }
    }
    occ += w * clamp((h - sd) / h, 0.0, 1.0);
    w *= 0.6;
  }
  occ /= 2.3056;                                       // Σ weights → occ ∈ [0, 1]
  let sg = dice[nearest].sigB;
  let tint = vec3f(1.0) - exp(-sg.rgb * sg.w * 0.9) * 0.55;   // candy lets tinted light through
  return clamp(vec3f(1.0) - occ * occ * (3.0 - 2.0 * occ) * tint * 0.9, vec3f(0.0), vec3f(1.0));
}

struct FloorOut { @location(0) color : vec4f, @builtin(frag_depth) depth : f32 };
@fragment fn fsFloor(in : FullVary) -> FloorOut {
  var out : FloorOut;
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let fh = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  let ro = F.camPos.xyz;
  let rd = normalize(fh.xyz / fh.w - ro);
  if (rd.y > -1e-4) { out.color = vec4f(PAPER * F.params.y, 1.0); out.depth = 1.0; return out; }
  let t = -ro.y / rd.y;
  let P = ro + rd * t;
  let cp = F.viewProj * vec4f(P, 1.0);
  out.depth = clamp(cp.z / cp.w, 0.0, 1.0);
  let jitter = ign(in.clip.xy);
  let sh = keyShadow(P, jitter);
  let ao = contactAO(P);
  // normalised lighting: open floor is exactly the paper colour
  var col = PAPER * (0.56 * ao + 0.44 * sh);
  col = mix(col, PAPER, smoothstep(20.0, 42.0, t));   // dissolve into the paper backdrop
  if (F.params.w > 1.5 && F.params.w < 2.5) { col = ao; }        // debug: contact AO
  if (F.params.w > 2.5) { col = sh; }                             // debug: key shadow
  out.color = vec4f(col * F.params.y, 1.0);
  return out;
}
`;

// ---- post: FXAA on tone-mapped colour, highlight roll-off, sRGB, dither ----
const WGSL_POST = WGSL_STRUCTS + /* wgsl */`
@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var<uniform> F : Frame;

struct FullVary { @builtin(position) clip : vec4f, @location(0) uv : vec2f };
@vertex fn vsFull(@builtin(vertex_index) vi : u32) -> FullVary {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out : FullVary;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
// Linear below 0.9 (paper stays exact), smooth shoulder above, gentle desaturation of hot spots.
fn tonemap(c0 : vec3f) -> vec3f {
  let c = max(c0, vec3f(0.0));
  let peak = max(c.r, max(c.g, c.b));
  let K = 0.9;
  if (peak <= K) { return c; }
  let np = K + (1.0 - K) * (1.0 - exp(-(peak - K) / (1.0 - K)));
  let g = 1.0 - 1.0 / (0.5 * (peak - np) + 1.0);
  return mix(c * (np / peak), vec3f(np), g);
}
fn tm(uv : vec2f) -> vec3f { return tonemap(textureSampleLevel(sceneTex, samp, uv, 0.0).rgb); }
fn luma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
fn hash12(p : vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn toSrgb(c : vec3f) -> vec3f {
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, c * 12.92, c <= vec3f(0.0031308));
}
@fragment fn fsPost(in : FullVary) -> @location(0) vec4f {
  let px = F.res.zw;
  let uv = in.uv;
  let cM = tm(uv);
  let cNW = tm(uv + vec2f(-1.0, -1.0) * px); let cNE = tm(uv + vec2f(1.0, -1.0) * px);
  let cSW = tm(uv + vec2f(-1.0, 1.0) * px);  let cSE = tm(uv + vec2f(1.0, 1.0) * px);
  let lM = luma(cM); let lNW = luma(cNW); let lNE = luma(cNE); let lSW = luma(cSW); let lSE = luma(cSE);
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  var col = cM;
  if (lMax - lMin > 0.03) {
    var dir = vec2f(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    let reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * px;
    let cA = 0.5 * (tm(uv + dir * (1.0 / 3.0 - 0.5)) + tm(uv + dir * (2.0 / 3.0 - 0.5)));
    let cB = cA * 0.5 + 0.25 * (tm(uv - dir * 0.5) + tm(uv + dir * 0.5));
    let lB = luma(cB);
    col = select(cB, cA, lB < lMin || lB > lMax);
  }
  let n = (hash12(in.clip.xy) + hash12(in.clip.xy + vec2f(17.0, 31.0)) - 1.0) / 255.0;
  return vec4f(toSrgb(col) + vec3f(n), 1.0);
}
`;

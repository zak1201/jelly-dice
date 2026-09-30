// Headless checks of the object library: geometry build + embedding accuracy + physics drop tests.
// Usage: node geo-test.mjs [parts-dir] [types...]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'v4-parts');
const only = process.argv.slice(3).map(Number);
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const api = new Function(`${src}\nreturn { CFG, TUNE, OBJECT_TYPES, buildTypeGeometry, SoftDice, crEval, extendNodes, NP, NEP, N, randomQuat, mulberry32, sampleSdfGrid };`)();
const { OBJECT_TYPES, buildTypeGeometry, SoftDice, crEval, extendNodes, NP, NEP, randomQuat, mulberry32, CFG, sampleSdfGrid } = api;

/** Negative SDF values on the meshing box boundary would mean a clipped (open) mesh. */
function boundaryInside(T) {
  if (!T.sdf || !T.half) return 0;
  const lo = T.center.map((c, a) => c - T.half[a] - 0.06), hi = T.center.map((c, a) => c + T.half[a] + 0.06);
  let neg = 0;
  for (let a = 0; a < 3; a++) for (const side of [lo[a], hi[a]]) for (let i = 0; i <= 30; i++) for (let j = 0; j <= 30; j++) {
    const b = (a + 1) % 3, c = (a + 2) % 3, p = [0, 0, 0];
    p[a] = side; p[b] = lo[b] + (hi[b] - lo[b]) * i / 30; p[c] = lo[c] + (hi[c] - lo[c]) * j / 30;
    if (T.sdf(p[0], p[1], p[2]) < 0) neg++;
  }
  return neg;
}

const types = only.length ? only : OBJECT_TYPES.map((_, i) => i);
const results = [];
for (const t of types) {
  const T = OBJECT_TYPES[t];
  const t0 = performance.now();
  const geo = buildTypeGeometry(t);
  const buildMs = performance.now() - t0;
  // embedding accuracy: re-evaluate every surface vertex through the rest map
  const P = new Float64Array(3);
  let maxErr = 0, uMin = Infinity, uMax = -Infinity;
  for (let v = 0; v < geo.surfCount; v++) {
    const o = v * 12, u = [geo.vin[o], geo.vin[o + 1], geo.vin[o + 2]];
    crEval(geo.restExt, 0, 3, u[0], u[1], u[2], P, null);
    uMin = Math.min(uMin, ...u); uMax = Math.max(uMax, ...u);
    if (t !== 0) {
      const e = Math.hypot(P[0] - geo.vin[o + 8], P[1] - geo.vin[o + 9], P[2] - geo.vin[o + 10]);
      if (e > maxErr) maxErr = e;
    }
  }
  // rest surface extent and part weights
  let yMin = Infinity, stemN = 0, accN = 0;
  for (let v = 0; v < geo.surfCount; v++) {
    const o = v * 12;
    crEval(geo.restExt, 0, 3, geo.vin[o], geo.vin[o + 1], geo.vin[o + 2], P, null);
    yMin = Math.min(yMin, P[1]);
    if (geo.vin[o + 3] > 0.5) stemN++;
    if (geo.vin[o + 7] > 0.5) accN++;
  }
  // physics: drop 3 of this type, random orientations, run 7 s
  const sim = new SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const td = sim.prepareType(geo);
  const rnd = mulberry32(1234 + t);
  const spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
  for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
  sim.setCount(3);
  let settle = -1, maxSpeed = 0, nan = false;
  const tp0 = performance.now();
  for (let k = 0; k < 120 * 7; k++) {
    sim.step(CFG.STEP);
    let moving = false;
    for (let s = 0; s < 3; s++) {
      const D = sim.dice[s];
      if (!Number.isFinite(D.speed)) nan = true;
      maxSpeed = Math.max(maxSpeed, D.speed);
      if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) moving = true;
    }
    if (!moving && settle < 0) settle = k / 120;
    if (moving) settle = -1;
  }
  const physMsPerStep = (performance.now() - tp0) / (120 * 7);
  // final penetration of the render surface into the floor, using the live lattice of slot 0..2
  const ext = new Float64Array(NEP * 3);
  let minY = Infinity;
  for (let s = 0; s < 3; s++) {
    extendNodes(sim.x, s * NP * 3, ext, 0, 3);
    for (let v = 0; v < geo.surfCount; v += 3) {
      const o = v * 12;
      crEval(ext, 0, 3, geo.vin[o], geo.vin[o + 1], geo.vin[o + 2], P, null);
      minY = Math.min(minY, P[1]);
    }
  }
  const final = sim.dice.slice(0, 3).map((D) => ({ c: [...D.cm].map((v) => +v.toFixed(2)), up: +D.R[4].toFixed(2), stretch: +D.maxStretch.toFixed(2) }));
  results.push({
    t, id: T.id, clip: boundaryInside(T), samples: geo.samples ? geo.samples.length / 3 : 0, buildMs: Math.round(buildMs), surf: geo.surfCount, tris: geo.surfIdxCount / 3, perDie: geo.perDie,
    fail: geo.failures, maxErr: +maxErr.toExponential(1), u: [+uMin.toFixed(2), +uMax.toFixed(2)], yMin: +yMin.toFixed(3),
    stemN, accN, proxyTris: geo.proxy.tris.length / 3, settle, nan, physMs: +physMsPerStep.toFixed(2), floorPen: +minY.toFixed(3), final,
  });
  console.log(JSON.stringify(results[results.length - 1]));
}

// ---- mixed drop: five different objects close together (object/object contacts in every pairing)
{
  const mix = [0, 6, 9, 7, 8];
  const sim = new SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const geos = mix.map((t) => buildTypeGeometry(t)), tds = geos.map((g) => sim.prepareType(g));
  const rnd = mulberry32(77);
  const spots = [[-1.3, 0], [0, 0.2], [1.3, -0.1], [-0.6, 1.2], [0.7, -1.1]];
  mix.forEach((t, s) => sim.spawn(s, [spots[s][0], 1.6 + s * 0.9, spots[s][1]], randomQuat(rnd), [0, -2, 0], [(rnd() - 0.5) * 6, 0, (rnd() - 0.5) * 6], tds[s]));
  sim.setCount(5);
  let settle = -1, nan = false, worst = 0;
  const t0 = performance.now();
  for (let k = 0; k < 120 * 8; k++) {
    sim.step(CFG.STEP);
    let moving = false;
    for (let s = 0; s < 5; s++) { const D = sim.dice[s]; if (!Number.isFinite(D.speed)) nan = true; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) moving = true; }
    if (!moving && settle < 0) settle = k / 120; if (moving) settle = -1;
  }
  const ms = (performance.now() - t0) / (120 * 8);
  // deepest penetration of any object's render surface into another object's rest SDF (rigid frame)
  const P = new Float64Array(3), g = new Float64Array(3), ext = new Float64Array(NEP * 3);
  for (let a = 0; a < 5; a++) {
    extendNodes(sim.x, a * NP * 3, ext, 0, 3);
    for (let v = 0; v < geos[a].surfCount; v += 5) {
      const o = v * 12; crEval(ext, 0, 3, geos[a].vin[o], geos[a].vin[o + 1], geos[a].vin[o + 2], P, null);
      for (let b = 0; b < 5; b++) {
        if (b === a) continue;
        const B = sim.dice[b], R = B.R, c = B.c, com = tds[b].com, rx = P[0] - c[0], ry = P[1] - c[1], rz = P[2] - c[2];
        const sd = sampleSdfGrid(tds[b].grid, R[0] * rx + R[3] * ry + R[6] * rz + com[0], R[1] * rx + R[4] * ry + R[7] * rz + com[1], R[2] * rx + R[5] * ry + R[8] * rz + com[2], g);
        if (sd < worst) worst = sd;
      }
    }
  }
  console.log(JSON.stringify({ mixed: mix.map((t) => OBJECT_TYPES[t].id), settle, nan, physMsPerStep: +ms.toFixed(2), worstPenetration: +worst.toFixed(3),
    final: sim.dice.slice(0, 5).map((D) => [...D.cm].map((v) => +v.toFixed(2))) }));
}

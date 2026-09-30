import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, NEP, crEval, extendNodes, randomQuat, mulberry32, sampleSdfGrid };`)();
const geos = A.OBJECT_TYPES.map((_, t) => A.buildTypeGeometry(t));
function settleRun(sim, n, secs) {
  let settle = -1, nan = false, sleepAt = [];
  for (let k = 1; k <= 120 * secs; k++) {
    sim.step(A.CFG.STEP);
    let mov = false;
    for (let s = 0; s < n; s++) { const D = sim.dice[s]; if (!Number.isFinite(D.speed)) nan = true; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) mov = true; if (D.asleep && sleepAt[s] == null) sleepAt[s] = k / 120; }
    if (!mov && settle < 0) settle = k / 120; if (mov) settle = -1;
  }
  return { settle, nan, sleepAt };
}
function floorPen(sim, s, geo) {
  const ext = new Float64Array(A.NEP * 3), P = new Float64Array(3); let m = Infinity;
  A.extendNodes(sim.x, s * A.NP * 3, ext, 0, 3);
  for (let v = 0; v < geo.surfCount; v += 2) { const o = v * 12; A.crEval(ext, 0, 3, geo.vin[o], geo.vin[o + 1], geo.vin[o + 2], P, null); if (P[1] < m) m = P[1]; }
  return m;
}
let worstSettle = 0, worstPen = 0, anyNaN = false;
for (let t = 0; t < geos.length; t++) {
  const row = [];
  for (const seed of [1234, 99, 7]) {
    const sim = new A.SoftDice(); sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
    const td = sim.prepareType(geos[t]), rnd = A.mulberry32(seed + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
    for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
    sim.setCount(3);
    const r = settleRun(sim, 3, 9);
    const pen = Math.min(...[0, 1, 2].map((s) => floorPen(sim, s, geos[t])));
    worstSettle = Math.max(worstSettle, r.settle < 0 ? 99 : r.settle); worstPen = Math.min(worstPen, pen); anyNaN ||= r.nan;
    row.push(`${r.settle.toFixed(1)}s pen${pen.toFixed(3)}${r.nan ? ' NaN' : ''}`);
  }
  console.log(A.OBJECT_TYPES[t].id.padEnd(9), row.join(' | '));
}
// mixed pile, twice
for (const seed of [77, 5]) {
  const mix = [0, 6, 9, 7, 8].map((t, i) => (seed === 5 ? [1, 2, 3, 4, 5][i] : t));
  const sim = new A.SoftDice(); sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const tds = mix.map((t) => sim.prepareType(geos[t])), rnd = A.mulberry32(seed);
  const spots = [[-1.3, 0], [0, 0.2], [1.3, -0.1], [-0.6, 1.2], [0.7, -1.1]];
  mix.forEach((t, s) => sim.spawn(s, [spots[s][0], 1.6 + s * 0.9, spots[s][1]], A.randomQuat(rnd), [0, -2, 0], [(rnd() - 0.5) * 6, 0, (rnd() - 0.5) * 6], tds[s]));
  sim.setCount(5);
  const t0 = performance.now(); const r = settleRun(sim, 5, 9); const ms = (performance.now() - t0) / (120 * 9);
  const P = new Float64Array(3), g = new Float64Array(3), ext = new Float64Array(A.NEP * 3); let worst = 0;
  for (let a = 0; a < 5; a++) {
    A.extendNodes(sim.x, a * A.NP * 3, ext, 0, 3);
    for (let v = 0; v < geos[mix[a]].surfCount; v += 5) {
      const o = v * 12; A.crEval(ext, 0, 3, geos[mix[a]].vin[o], geos[mix[a]].vin[o + 1], geos[mix[a]].vin[o + 2], P, null);
      for (let b = 0; b < 5; b++) { if (b === a) continue; const B = sim.dice[b], R = B.R, c = B.c, com = tds[b].com, rx = P[0] - c[0], ry = P[1] - c[1], rz = P[2] - c[2];
        const sd = A.sampleSdfGrid(tds[b].grid, R[0] * rx + R[3] * ry + R[6] * rz + com[0], R[1] * rx + R[4] * ry + R[7] * rz + com[1], R[2] * rx + R[5] * ry + R[8] * rz + com[2], g); if (sd < worst) worst = sd; }
    }
  }
  console.log('mixed', mix.map((t) => A.OBJECT_TYPES[t].id).join(','), JSON.stringify({ settle: r.settle, nan: r.nan, sleepAt: r.sleepAt, physMsPerStep: +ms.toFixed(2), worstInterPen: +worst.toFixed(3) }));
}
console.log('SUMMARY worstSettle', worstSettle, 'worstFloorPen', worstPen.toFixed(3), 'NaN', anyNaN);

import fs from 'node:fs';
const read = (f) => fs.readFileSync('src/v4-parts/' + f, 'utf8');
const lastReplace = (s, a, b) => { const i = s.lastIndexOf(a); if (i < 0) throw new Error('missing ' + a); return s.slice(0, i) + b + s.slice(i + a.length); };
function build(even) {
  let phys = read('03-physics.js');
  if (even) { phys = lastReplace(phys, 'den += wt * wt * w[base + k];', 'den += wt * wt;'); phys = lastReplace(phys, 'f = S.wt[s * 8 + l] * w[base + k] * inv', 'f = S.wt[s * 8 + l] * inv'); }
  return new Function(`${read('02-core.js')}\n${read('02b-objects.js')}\n${phys}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
}
for (const even of [false, true]) for (const t of [7, 8, 5, 0]) {
  const A = build(even), geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const td = sim.prepareType(geo), rnd = A.mulberry32(1234 + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
  for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
  sim.setCount(3);
  let settleSub = -1, settleStep = -1, maxStepWob = 0; const cm5 = [];
  for (let k = 1; k <= 120 * 9; k++) {
    sim.step(A.CFG.STEP);
    let movSub = false, movStep = false;
    for (let s = 0; s < 3; s++) {
      const D = sim.dice[s], base = s * A.NP;
      // displacement-based wobble over the whole fixed step (rigid part removed)
      let acc = 0;
      for (let i = 0; i < A.NP; i++) {
        const o = (base + i) * 3, rx = sim.x[o] - D.cm[0], ry = sim.x[o + 1] - D.cm[1], rz = sim.x[o + 2] - D.cm[2];
        const vx = (sim.x[o] - sim.xs[o]) * 120 - D.vcm[0] - (D.om[1] * rz - D.om[2] * ry);
        const vy = (sim.x[o + 1] - sim.xs[o + 1]) * 120 - D.vcm[1] - (D.om[2] * rx - D.om[0] * rz);
        const vz = (sim.x[o + 2] - sim.xs[o + 2]) * 120 - D.vcm[2] - (D.om[0] * ry - D.om[1] * rx);
        acc += vx * vx + vy * vy + vz * vz;
      }
      const wStep = Math.sqrt(acc / A.NP);
      if (k > 120 * 4) maxStepWob = Math.max(maxStepWob, wStep);
      if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) movSub = true;
      if (D.speed > 0.1 || D.spin > 0.25 || wStep > 0.16) movStep = true;
      if (k === 120 * 5) cm5[s] = [...D.cm];
    }
    if (!movSub && settleSub < 0) settleSub = k / 120; if (movSub) settleSub = -1;
    if (!movStep && settleStep < 0) settleStep = k / 120; if (movStep) settleStep = -1;
  }
  const drift = sim.dice.slice(0, 3).map((D, s) => +Math.hypot(D.cm[0] - cm5[s][0], D.cm[1] - cm5[s][1], D.cm[2] - cm5[s][2]).toFixed(4));
  console.log(even ? 'even' : 'mass', A.OBJECT_TYPES[t].id.padEnd(8), JSON.stringify({ settleSub, settleStep, maxStepWobAfter4s: +maxStepWob.toFixed(3), drift5to9s: drift }));
}

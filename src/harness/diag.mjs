import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, crEval, extendNodes, NP, NEP, randomQuat, mulberry32 };`)();
for (const t of [6, 8, 7]) {
  const geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const td = sim.prepareType(geo), rnd = A.mulberry32(1234 + t);
  const spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
  for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
  sim.setCount(3);
  const log = [];
  for (let k = 1; k <= 120 * 8; k++) {
    sim.step(A.CFG.STEP);
    if (k % 60 === 0) log.push(`${(k / 120).toFixed(1)}s ` + sim.dice.slice(0, 3).map((D) => `v${D.speed.toFixed(2)} w${D.spin.toFixed(2)} wb${D.wobble.toFixed(2)}`).join(' | '));
  }
  console.log('==', A.OBJECT_TYPES[t].id); console.log(log.slice(4, 16).join('\n'));
  // deepest render vertices below the floor, with their part weights and rest positions
  const ext = new Float64Array(A.NEP * 3), P = new Float64Array(3), worst = [];
  for (let s = 0; s < 3; s++) {
    A.extendNodes(sim.x, s * A.NP * 3, ext, 0, 3);
    for (let v = 0; v < geo.surfCount; v++) {
      const o = v * 12; A.crEval(ext, 0, 3, geo.vin[o], geo.vin[o + 1], geo.vin[o + 2], P, null);
      if (P[1] < -0.03) worst.push([+P[1].toFixed(3), s, +geo.vin[o + 3].toFixed(2), +geo.vin[o + 7].toFixed(2), [geo.vin[o + 8], geo.vin[o + 9], geo.vin[o + 10]].map((c) => +c.toFixed(2))]);
    }
  }
  worst.sort((a, b) => a[0] - b[0]);
  console.log('below -0.03:', worst.length, JSON.stringify(worst.slice(0, 6)));
}

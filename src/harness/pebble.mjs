import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
const t = +(process.argv[2] || 5), seed = +(process.argv[3] || 99);
const geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
const td = sim.prepareType(geo), rnd = A.mulberry32(seed + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
sim.setCount(3);
for (let k = 1; k <= 120 * 9; k++) {
  sim.step(A.CFG.STEP);
  if (k >= 360 && k % 60 === 0) console.log((k / 120).toFixed(1) + 's', sim.dice.slice(0, 3).map((D) => `c(${[...D.cm].map((v) => v.toFixed(3))}) v${D.speed.toFixed(3)} w${D.spin.toFixed(3)} om(${[...D.om].map((v) => v.toFixed(2))}) wb${D.wobble.toFixed(3)} n${D.contact} up${D.R[4].toFixed(2)}`).join(' | '));
}

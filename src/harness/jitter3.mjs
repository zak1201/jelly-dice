import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { CFG, TUNE, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, N, nid, randomQuat, mulberry32, quatAxisAngle };`)();
const geo = A.buildTypeGeometry(7), sim = new A.SoftDice();
sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
const td = sim.prepareType(geo);
// phone lying flat, screen up, placed just above the floor with no spin
sim.spawn(0, [0, 0.35, 0], [0, 0, 0, 1], [0, 0, 0], [0, 0, 0], td); sim.setCount(1);
const D = sim.dice[0];
const rows = [];
for (let k = 1; k <= 120 * 6; k++) {
  sim.step(A.CFG.STEP);
  if (k % 120 === 0) rows.push(`${k / 120}s speed ${D.speed.toFixed(3)} spin ${D.spin.toFixed(3)} wob ${D.wobble.toFixed(3)} contact ${D.contact} cm ${[...D.cm].map((v) => v.toFixed(3))}`);
}
console.log(rows.join('\n'));
// per layer (j) RMS of node speed at the end
const v = sim.v, byJ = [];
for (let j = 0; j < A.N; j++) { let s = 0, n = 0; for (let k = 0; k < A.N; k++) for (let i = 0; i < A.N; i++) { const o = A.nid(i, j, k) * 3; s += v[o] ** 2 + v[o + 1] ** 2 + v[o + 2] ** 2; n++; } byJ.push(Math.sqrt(s / n).toFixed(4)); }
console.log('node speed RMS by layer j (bottom→top):', byJ.join(' '));
console.log('masses layer j=0 corner vs centre:', sim.m[A.nid(0, 0, 0)].toFixed(4), sim.m[A.nid(2, 2, 2)].toFixed(4), 'box', JSON.stringify(geo.box));

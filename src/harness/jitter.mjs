import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
function run(t, variant) {
  const A = new Function(`${src}\nreturn { CFG, TUNE, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
  const geo = A.buildTypeGeometry(t);
  if (variant === 'uniformMass') geo.nodeMass = null;
  const sim = new A.SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  if (variant === 'damp2') sim.intDamp *= 2;
  if (variant === 'noFriction') { A.TUNE.muS = 0; A.TUNE.muK = 0; }
  if (variant === 'noShape') { sim.smAlpha = 0; }
  const td = sim.prepareType(geo), rnd = A.mulberry32(1234 + t);
  const spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
  for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
  sim.setCount(3);
  let wob = 0, n = 0, settle = -1;
  for (let k = 1; k <= 120 * 9; k++) {
    sim.step(A.CFG.STEP);
    let moving = false;
    for (let s = 0; s < 3; s++) { const D = sim.dice[s]; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) moving = true; if (k > 120 * 5) { wob += D.wobble; n++; } }
    if (!moving && settle < 0) settle = k / 120; if (moving) settle = -1;
  }
  return { settle, meanWobble5to9: +(wob / n).toFixed(4), ups: sim.dice.slice(0, 3).map((D) => +D.R[4].toFixed(2)) };
}
for (const t of [7, 8]) for (const v of ['base', 'uniformMass', 'damp2', 'noFriction']) console.log(t, v, JSON.stringify(run(t, v)));

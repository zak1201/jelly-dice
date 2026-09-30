import fs from 'node:fs';
const read = (f) => fs.readFileSync('src/v4-parts/' + f, 'utf8');
function build(omega) {
  let phys = read('03-physics.js');
  const a = 'if (cnt[i] > 0) { const k = 1 / cnt[i];';
  if (!phys.includes(a)) throw new Error('missing');
  phys = phys.replace(a, `if (cnt[i] > 0) { const k = ${omega} / cnt[i];`);
  return new Function(`${read('02-core.js')}\n${read('02b-objects.js')}\n${phys}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
}
const out = {};
for (const omega of [1, 1.5, 2, 3]) {
  const A = build(omega); const row = [];
  for (const t of [3, 5, 9, 7, 8, 6]) for (const seed of [1234, 99]) {
    const geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
    sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
    const td = sim.prepareType(geo), rnd = A.mulberry32(seed + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
    for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
    sim.setCount(3);
    let settle = -1, wob = 0, n = 0, nan = false; const cm5 = [];
    for (let k = 1; k <= 120 * 9; k++) {
      sim.step(A.CFG.STEP);
      let mov = false;
      for (let s = 0; s < 3; s++) { const D = sim.dice[s]; if (!Number.isFinite(D.speed)) nan = true; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) mov = true; if (k > 600) { wob += D.wobble; n++; } if (k === 600) cm5[s] = [...D.cm]; }
      if (!mov && settle < 0) settle = k / 120; if (mov) settle = -1;
    }
    const drift = Math.max(...sim.dice.slice(0, 3).map((D, s) => Math.hypot(D.cm[0] - cm5[s][0], D.cm[1] - cm5[s][1], D.cm[2] - cm5[s][2])));
    row.push(`${A.OBJECT_TYPES[t].id}:${settle.toFixed(1)}s/w${(wob / n).toFixed(3)}/d${drift.toFixed(3)}${nan ? '/NaN' : ''}`);
  }
  console.log('omega', omega, row.join('  '));
}

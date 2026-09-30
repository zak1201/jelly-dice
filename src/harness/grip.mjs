import fs from 'node:fs';
const read = (f) => fs.readFileSync('src/v4-parts/' + f, 'utf8');
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error('missing ' + a.slice(0, 70)); return s.replace(a, b); };
function build(v) {
  let phys = read('03-physics.js');
  phys = rep(phys, 'D.calmT = !isDie && calm > 0.5 ? D.calmT + h : 0;',
    'const slow = sp < 0.5 * sp0 && om < 0.5 * om0;\n      D.calmT = !isDie && !grabbed && slow ? (D.contact > 0 ? D.calmT + h : D.calmT) : 0;');
  if (v.release != null) phys = rep(phys, 'fx = sp[si * 2] - px; fz = sp[si * 2 + 1] - pz;',
    `fx = sp[si * 2] - px; fz = sp[si * 2 + 1] - pz;\n        if (fx * fx + fz * fz > ${v.release * v.release}) { stick[si] = 0; fx = -sx; fz = -sz; }`);
  if (v.noStick) phys = rep(phys, 'fx = sp[si * 2] - px; fz = sp[si * 2 + 1] - pz;', 'fx = -sx; fz = -sz;');
  return new Function(`${read('02-core.js')}\n${read('02b-objects.js')}\n${phys}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
}
for (const [name, v] of Object.entries({ calmFix: {}, release5mm: { release: 0.005 }, release2mm: { release: 0.002 }, noStick: { noStick: true } })) {
  const A = build(v); let worst = 0, drift = 0, bad = [];
  for (const t of [1, 3, 5, 2, 6, 7, 8, 9, 4]) for (const seed of [1234, 99, 7]) {
    const geo = A.buildTypeGeometry(t), sim = new A.SoftDice(); sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
    const td = sim.prepareType(geo), rnd = A.mulberry32(seed + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
    for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
    sim.setCount(3);
    let settle = -1; const cm4 = [];
    for (let k = 1; k <= 120 * 9; k++) {
      sim.step(A.CFG.STEP); let mov = false;
      for (let s = 0; s < 3; s++) { const D = sim.dice[s]; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) mov = true; if (k === 480) cm4[s] = [...D.cm]; }
      if (!mov && settle < 0) settle = k / 120; if (mov) settle = -1;
    }
    const d = Math.max(...sim.dice.slice(0, 3).map((D, s) => Math.hypot(D.cm[0] - cm4[s][0], D.cm[2] - cm4[s][2])));
    drift = Math.max(drift, d); const st = settle < 0 ? 99 : settle; worst = Math.max(worst, st);
    if (st > 5 || d > 0.02) bad.push(`${A.OBJECT_TYPES[t].id}/${seed}:${settle.toFixed(1)}s d${d.toFixed(3)}`);
  }
  console.log(name.padEnd(11), 'worstSettle', worst.toFixed(1), 'maxDrift4-9s', drift.toFixed(3), '|', bad.join('  ') || 'all good');
}

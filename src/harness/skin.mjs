import fs from 'node:fs';
const read = (f) => fs.readFileSync('src/v4-parts/' + f, 'utf8');
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error('missing ' + a.slice(0, 60)); return s.replace(a, b); };
function build(v) {
  let phys = read('03-physics.js');
  if (v.skin) phys = rep(phys, `        if (py - lift > 0.07) this.anchorS[aBase + s] = 0;
      }`, `        if (py - lift > 0.07) this.anchorS[aBase + s] = 0;
      } else if (py < ${v.skin} && stick[aBase + s]) {
        load = CFG.GRAVITY * h * h; contacts++;   // keep an existing grip while hovering within the contact skin
      }`);
  if (v.sleep) {
    phys = rep(phys, `const kr = Math.exp(-(rotK + calm * TUNE.restAssist) * h), ki = Math.exp(-this.intDamp * h);`,
      `D.calmT = calm > 0.5 && this.slotData[d].samples ? (D.calmT || 0) + h : 0;
      const sleep = clamp((D.calmT - ${v.sleep[0]}) / ${v.sleep[1]}, 0, 1) * ${v.sleep[2]};
      const kr = Math.exp(-(rotK + calm * TUNE.restAssist + sleep) * h), ki = Math.exp(-(this.intDamp + sleep) * h);`);
  }
  return new Function(`${read('02-core.js')}\n${read('02b-objects.js')}\n${phys}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
}
const variants = { anchor: {}, skin2mm: { skin: 0.002 }, sleep: { sleep: [0.4, 0.5, 25] }, skinSleep: { skin: 0.002, sleep: [0.4, 0.5, 25] } };
for (const [name, v] of Object.entries(variants)) {
  const A = build(v), row = [];
  let worst = 0;
  for (const t of [5, 3, 9, 7, 8, 6, 1, 2, 4]) for (const seed of [1234, 99, 7]) {
    const geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
    sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
    const td = sim.prepareType(geo), rnd = A.mulberry32(seed + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
    for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
    sim.setCount(3);
    let settle = -1, wob = 0, n = 0; const cm5 = [];
    for (let k = 1; k <= 120 * 9; k++) {
      sim.step(A.CFG.STEP);
      let mov = false;
      for (let s = 0; s < 3; s++) { const D = sim.dice[s]; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) mov = true; if (k > 600) { wob += D.wobble; n++; } if (k === 600) cm5[s] = [...D.cm]; }
      if (!mov && settle < 0) settle = k / 120; if (mov) settle = -1;
    }
    const drift = Math.max(...sim.dice.slice(0, 3).map((D, s) => Math.hypot(D.cm[0] - cm5[s][0], D.cm[1] - cm5[s][1], D.cm[2] - cm5[s][2])));
    const s = settle < 0 ? 99 : settle; worst = Math.max(worst, s);
    if (settle < 0 || settle > 5 || drift > 0.01 || wob / n > 0.02) row.push(`${A.OBJECT_TYPES[t].id}/${seed}:${settle.toFixed(1)}s w${(wob / n).toFixed(3)} d${drift.toFixed(3)}`);
  }
  console.log(name.padEnd(10), 'worst settle', worst.toFixed(1), '| problems:', row.join('  ') || 'none');
}

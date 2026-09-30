import fs from 'node:fs';
const read = (f) => fs.readFileSync('src/v4-parts/' + f, 'utf8');
const rep = (s, a, b, last) => { const i = last ? s.lastIndexOf(a) : s.indexOf(a); if (i < 0) throw new Error('missing ' + a); return s.slice(0, i) + b + s.slice(i + a.length); };
function build(v) {
  let obj = read('02b-objects.js'), phys = read('03-physics.js');
  if (v.pad != null) obj = rep(obj, 'const pad = 0.03, lo = bmin', `const pad = ${v.pad}, lo = bmin`);
  if (v.minLoad) phys = rep(phys, "      if (load <= 0) continue;\n      const sx = px - qx", `      if (load <= 0) continue;\n      load = Math.max(load, ${v.minLoad} * CFG.GRAVITY * h * h);\n      const sx = px - qx`);
  if (v.stickAll) phys = rep(phys, 'if (sl >= muS * load) {', 'if (false) {');
  return new Function(`${read('02-core.js')}\n${obj}\n${phys}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
}
const variants = { jacobi: {}, stickAll: { stickAll: true } };
for (const t of [7, 8, 5, 6, 9, 1, 2, 3, 4]) for (const [name, v] of Object.entries(variants)) {
  const A = build(v), geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const td = sim.prepareType(geo); if (v.nodes) td.samples = null;
  const rnd = A.mulberry32(1234 + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
  for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
  sim.setCount(3);
  let settle = -1, wob = 0, n = 0; const cm5 = [];
  for (let k = 1; k <= 120 * 9; k++) {
    sim.step(A.CFG.STEP);
    let mov = false;
    for (let s = 0; s < 3; s++) { const D = sim.dice[s]; if (D.speed > 0.1 || D.spin > 0.25 || D.wobble > 0.16) mov = true; if (k > 600) { wob += D.wobble; n++; } if (k === 600) cm5[s] = [...D.cm]; }
    if (!mov && settle < 0) settle = k / 120; if (mov) settle = -1;
  }
  const drift = sim.dice.slice(0, 3).map((D, s) => +Math.hypot(D.cm[0] - cm5[s][0], D.cm[1] - cm5[s][1], D.cm[2] - cm5[s][2]).toFixed(4));
  console.log(A.OBJECT_TYPES[t].id.padEnd(6), name.padEnd(10), JSON.stringify({ settle: +settle.toFixed(2), wob: +(wob / n).toFixed(4), drift, ups: sim.dice.slice(0, 3).map((D) => +D.R[4].toFixed(2)) }));
}

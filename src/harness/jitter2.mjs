import fs from 'node:fs';
const read = (f) => fs.readFileSync('src/v4-parts/' + f, 'utf8');
const lastReplace = (s, a, b) => { const i = s.lastIndexOf(a); if (i < 0) throw new Error('missing ' + a); return s.slice(0, i) + b + s.slice(i + a.length); };
function build(variant) {
  let core = read('02-core.js'), obj = read('02b-objects.js'), phys = read('03-physics.js');
  if (variant.mass) obj = obj.replace('0.3 / NP + 0.7 * occ[id] / occSum', `${variant.mass} / NP + ${1 - variant.mass} * occ[id] / occSum`);
  if (variant.even) {
    phys = lastReplace(phys, 'den += wt * wt * w[base + k];', 'den += wt * wt;');
    phys = lastReplace(phys, 'f = S.wt[s * 8 + l] * w[base + k] * inv', 'f = S.wt[s * 8 + l] * inv');
  }
  return new Function(`${core}\n${obj}\n${phys}\nreturn { CFG, TUNE, OBJECT_TYPES, buildTypeGeometry, SoftDice, NP, randomQuat, mulberry32 };`)();
}
function run(t, variant, seed = 1234) {
  const A = build(variant), geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
  sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
  const td = sim.prepareType(geo), rnd = A.mulberry32(seed + t);
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
  const com = sim.slotData[0].com, box = geo.box;
  return { settle: +settle.toFixed(2), wob: +(wob / n).toFixed(4), ups: sim.dice.slice(0, 3).map((D) => +D.R[4].toFixed(2)) };
}
const variants = { base: {}, even: { even: true }, mass05: { mass: 0.5 }, even_mass05: { even: true, mass: 0.5 } };
for (const t of [7, 8, 6, 9, 1]) for (const [k, v] of Object.entries(variants)) {
  const r = [run(t, v, 1234), run(t, v, 99)];
  console.log(t, k.padEnd(12), JSON.stringify(r));
}

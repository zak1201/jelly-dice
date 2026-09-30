import fs from 'node:fs';
let phys = fs.readFileSync('src/v4-parts/03-physics.js', 'utf8');
phys = phys.replace('wake(slot) { const D = this.dice[slot];', 'wake(slot) { if (this.dice[slot].asleep && globalThis.__log) globalThis.__log.push([this.time.toFixed(3), slot, new Error().stack.split("\\n")[2].trim()]); const D = this.dice[slot];');
phys = phys.replace('if (D.calmT > 1.2) {', 'if (D.calmT > 1.2) { if (globalThis.__log) globalThis.__log.push([this.time.toFixed(3), d, "SLEEP"]);');
const src = fs.readFileSync('src/v4-parts/02-core.js', 'utf8') + '\n' + fs.readFileSync('src/v4-parts/02b-objects.js', 'utf8') + '\n' + phys;
const A = new Function(`${src}\nreturn { CFG, buildTypeGeometry, SoftDice, randomQuat, mulberry32 };`)();
globalThis.__log = [];
const t = +(process.argv[2] || 5), seed = +(process.argv[3] || 99), geo = A.buildTypeGeometry(t), sim = new A.SoftDice();
sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
const td = sim.prepareType(geo), rnd = A.mulberry32(seed + t), spots = [[-2.6, 0.2], [0.1, -0.5], [2.7, 0.3]];
for (let s = 0; s < 3; s++) sim.spawn(s, [spots[s][0], 2.4 + s * 0.4, spots[s][1]], A.randomQuat(rnd), [0, -1, 0], [(rnd() - 0.5) * 6, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6], td);
sim.setCount(3);
const resets = [];
let prev = [0, 0, 0];
for (let k = 1; k <= 120 * 7; k++) {
  sim.step(A.CFG.STEP);
  for (let s = 0; s < 3; s++) { const c = sim.dice[s].calmT; if (c < prev[s] - 0.05 && resets.length < 12) resets.push([ (k / 120).toFixed(3), s, prev[s].toFixed(3), sim.dice[s].speed.toFixed(3), sim.dice[s].spin.toFixed(3), sim.dice[s].asleep ]); prev[s] = c; }
}
console.log('events', JSON.stringify(globalThis.__log.slice(0, 12)));
console.log('calm resets [t, slot, calmBefore, speed, spin, asleep]', JSON.stringify(resets));

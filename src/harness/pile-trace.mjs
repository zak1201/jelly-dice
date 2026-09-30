// Node trace of mixed pile #2 (pine cone, gourd, ginkgo, acorn, pebble): what keeps the pine cone awake?
import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js', '03-physics.js'].map((f) => fs.readFileSync(new URL('../v4-parts/' + f, import.meta.url), 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { CFG, OBJECT_TYPES, buildTypeGeometry, SoftDice, randomQuat, mulberry32 };`)();
const mix = [1, 2, 3, 4, 5], geos = mix.map((t) => A.buildTypeGeometry(t));
const sim = new A.SoftDice(); sim.firmness = 0.55; sim.dampingAmt = 0.4; sim.applySettings();
const tds = geos.map((g) => sim.prepareType(g)), rnd = A.mulberry32(5);
const spots = [[-1.3, 0], [0, 0.2], [1.3, -0.1], [-0.6, 1.2], [0.7, -1.1]];
mix.forEach((t, s) => sim.spawn(s, [spots[s][0], 1.6 + s * 0.9, spots[s][1]], A.randomQuat(rnd), [0, -2, 0], [(rnd() - 0.5) * 6, 0, (rnd() - 0.5) * 6], tds[s]));
sim.setCount(5);
const M = A.CFG.MAX_DICE;
for (let k = 1; k <= 120 * 8; k++) {
  sim.step(A.CFG.STEP);
  if (k % 60 === 0 && k >= 240) {
    const D = sim.dice[0];
    const touch = [1, 2, 3, 4].filter((b) => sim.time - sim.touchT[b] < 0.1).map((b) => A.OBJECT_TYPES[mix[b]].id + (sim.dice[b].asleep ? '(z)' : ''));
    console.log((k / 120).toFixed(1) + 's pine v' + D.speed.toFixed(2), 'w' + D.spin.toFixed(2), 'wb' + D.wobble.toFixed(2), 'n' + D.contact,
      'calm' + D.calmT.toFixed(2), 'asleep', D.asleep, 'touching', touch.join(',') || '-');
  }
}

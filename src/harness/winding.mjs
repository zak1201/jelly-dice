import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { OBJECT_TYPES, buildTypeGeometry, crEval, surfaceNets, sdfGrad };`)();
for (let t = 1; t < 10; t++) {
  const geo = A.buildTypeGeometry(t), T = A.OBJECT_TYPES[t];
  const P = (v) => { const o = v * 12, p = new Float64Array(3); A.crEval(geo.restExt, 0, 3, geo.vin[o], geo.vin[o + 1], geo.vin[o + 2], p, null); return p; };
  const pos = []; for (let v = 0; v < geo.surfCount; v++) pos.push(P(v));
  let flipped = 0, degenerate = 0, small = 0; const g = new Float64Array(3);
  const n = geo.surfIdxCount / 3;
  for (let k = 0; k < n; k++) {
    const a = pos[geo.idx[k * 3]], b = pos[geo.idx[k * 3 + 1]], c = pos[geo.idx[k * 3 + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) { degenerate++; continue; }
    if (l < 1e-5) small++;
    A.sdfGrad(T.sdf, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3, 0.005, g);
    if ((nx * g[0] + ny * g[1] + nz * g[2]) / l < -0.2) flipped++;
  }
  console.log(T.id.padEnd(9), 'tris', n, 'flipped', flipped, 'degenerate', degenerate, 'tiny', small);
}

import fs from 'node:fs';
const src = ['02-core.js', '02b-objects.js'].map((f) => fs.readFileSync('src/v4-parts/' + f, 'utf8')).join('\n');
const A = new Function(`${src}\nreturn { OBJECT_TYPES, surfaceNets };`)();
const T = A.OBJECT_TYPES[+(process.argv[2] || 6)];
const lo = T.center.map((c, a) => c - T.half[a] - 0.06), hi = T.center.map((c, a) => c + T.half[a] + 0.06);
const m = A.surfaceNets(T.sdf, lo, hi, 0.03);
const nv = m.pos.length / 3, nt = m.tris.length / 3;
let deg = 0, sameIdx = 0;
for (let k = 0; k < nt; k++) {
  const a = m.tris[k * 3], b = m.tris[k * 3 + 1], c = m.tris[k * 3 + 2];
  if (a === b || b === c || a === c) sameIdx++;
  const P = (v, o) => m.pos[v * 3 + o];
  const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2), vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
  if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-10) deg++;
}
// edge manifoldness: every undirected edge should be shared by exactly 2 triangles, with opposite directions
const E = new Map();
for (let k = 0; k < nt; k++) for (let e = 0; e < 3; e++) {
  const a = m.tris[k * 3 + e], b = m.tris[k * 3 + (e + 1) % 3], key = a < b ? a * 1e7 + b : b * 1e7 + a;
  const r = E.get(key) || { n: 0, dir: 0 }; r.n++; r.dir += a < b ? 1 : -1; E.set(key, r);
}
let boundary = 0, nonManifold = 0, sameDir = 0;
for (const r of E.values()) { if (r.n === 1) boundary++; else if (r.n > 2) nonManifold++; else if (r.dir !== 0) sameDir++; }
console.log({ verts: nv, tris: nt, degenerate: deg, sameIndexTris: sameIdx, edges: E.size, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentPairs: sameDir });

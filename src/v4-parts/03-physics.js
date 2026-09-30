
// ============================================================================
// 4. SOFT-BODY PHYSICS
// ----------------------------------------------------------------------------
// Per die: 125 nodes. Each fixed step (1/120 s) runs 8 XPBD substeps:
//   grab force → integrate → lattice edges (with hard stretch limits) →
//   cell volumes → weak global shape matching → die/die → floor & walls →
//   velocities → damping split (rigid rotation vs. internal deformation).
// ============================================================================
const _cg = new Float64Array(3);        // scratch gradient for object/object contacts

class SoftDice {
  constructor() {
    const M3 = CFG.MAX_DICE * NP * 3;
    this.slotData = new Array(CFG.MAX_DICE).fill(null);   // per slot: rest data of its object type
    this.x = new Float64Array(M3);     // positions
    this.p = new Float64Array(M3);     // positions at substep start
    this.v = new Float64Array(M3);     // velocities
    this.xs = new Float64Array(M3);    // positions at previous fixed step (render interpolation)
    this.f = new Float64Array(M3);     // external forces (grab)
    this.anchor = new Uint8Array(CFG.MAX_DICE * NP);
    this.count = 0;
    this.time = 0;
    this.grab = null;
    this.pending = [];
    this.firmness = 0.55;
    this.dampingAmt = 0.4;
    this.applySettings();

    // --- masses, per slot (each object type brings its own distribution); total mass 1 ---
    this.m = new Float64Array(CFG.MAX_DICE * NP); this.w = new Float64Array(CFG.MAX_DICE * NP);
    this.mDie = new Float64Array(NP);   // the die: half uniform, half lattice-volume weighted
    const wAxis = (i) => (i === 0 || i === N - 1 ? 0.5 : 1);
    let vsum = 0;
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) vsum += wAxis(i) * wAxis(j) * wAxis(k);
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      this.mDie[nid(i, j, k)] = 0.5 / NP + 0.5 * wAxis(i) * wAxis(j) * wAxis(k) / vsum;
    }
    this.maxSamples = 4096;   // contact samples per object (box-lattice objects only)
    this.anchorS = new Uint8Array(CFG.MAX_DICE * this.maxSamples);        // grab adhesion
    this.stickS = new Uint8Array(CFG.MAX_DICE * this.maxSamples);         // static-friction grip …
    this.stickP = new Float64Array(CFG.MAX_DICE * this.maxSamples * 2);   // … and where it gripped (x, z)

    // --- topology: every node pair inside a cell (edges, face & body diagonals) ---
    const pairs = new Map(), cells = [];
    for (let k = 0; k < N - 1; k++) for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const c = [];
      for (let l = 0; l < 8; l++) c.push(nid(i + (l & 1), j + ((l >> 1) & 1), k + ((l >> 2) & 1)));
      cells.push(c);
      for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
        const lo = Math.min(c[a], c[b]), hi = Math.max(c[a], c[b]), key = lo * 1024 + hi;
        if (!pairs.has(key)) pairs.set(key, [lo, hi, [0, 1, 1, 2, 1, 2, 2, 3][a ^ b]]);
      }
    }
    const P = [...pairs.values()];
    this.nC = P.length;
    this.cA = new Int32Array(this.nC); this.cB = new Int32Array(this.nC);
    this.cType = new Uint8Array(this.nC);
    P.forEach(([a, b, t], i) => { this.cA[i] = a; this.cB[i] = b; this.cType[i] = t; });
    this.nCells = cells.length;
    this.cell = new Int32Array(this.nCells * 8);
    cells.forEach((c, i) => this.cell.set(c, i * 8));
    const lp = new Float64Array(24), lg = new Float64Array(24);
    const surf = [];
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
      if (i === 0 || j === 0 || k === 0 || i === N - 1 || j === N - 1 || k === N - 1) surf.push(nid(i, j, k));
    this.surface = Int32Array.from(surf);
    this.grid = new Float64Array(NP * 3); // lattice coordinates of every node
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const id = nid(i, j, k) * 3; this.grid[id] = i; this.grid[id + 1] = j; this.grid[id + 2] = k;
    }
    this._lp = lp; this._lg = lg;
    this._A = new Float64Array(9);
    this._cellAct = new Uint8Array(this.nCells);
    this._acc = new Float64Array(NP * 3); this._cnt = new Float64Array(NP);   // Jacobi accumulators for sample contacts
    this.touchT = new Float64Array(CFG.MAX_DICE * CFG.MAX_DICE).fill(-1e9);   // when each pair last touched

    this.dice = [];
    for (let s = 0; s < CFG.MAX_DICE; s++) this.dice.push({
      slot: s, q: new Float64Array([0, 0, 0, 1]), R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      c: new Float64Array(3), cm: new Float64Array(3), vcm: new Float64Array(3), om: new Float64Array(3),
      invI: new Float64Array(9), radius: 1.9, speed: 0, spin: 0, wobble: 0, contact: 0, impactV: 0,
      floorImpact: 0, diceImpact: 0, maxStretch: 1, grabStretch: 1, asleep: false, calmT: 0,
    });
  }

  /**
   * Rest data of one object type, shared by every slot holding it: offsets from the
   * rest centre of mass, edge lengths, cell volumes and the collision field.
   */
  prepareType(geo) {
    const rest = geo.rest, m = Float64Array.from(geo.nodeMass || this.mDie), t = {
      type: geo.type, rest, grid: geo.grid, r0: new Float64Array(NP * 3), com: new Float64Array(3),
      edgeRest: new Float64Array(this.nC), cellV0: new Float64Array(this.nCells),
      m, w: m.map((v) => 1 / v), samples: null,
    };
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < NP; i++) { cx += m[i] * rest[i * 3]; cy += m[i] * rest[i * 3 + 1]; cz += m[i] * rest[i * 3 + 2]; }
    t.com[0] = cx; t.com[1] = cy; t.com[2] = cz;
    for (let i = 0; i < NP; i++) { t.r0[i * 3] = rest[i * 3] - cx; t.r0[i * 3 + 1] = rest[i * 3 + 1] - cy; t.r0[i * 3 + 2] = rest[i * 3 + 2] - cz; }
    for (let c = 0; c < this.nC; c++) {
      const a = this.cA[c] * 3, b = this.cB[c] * 3;
      t.edgeRest[c] = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]);
    }
    const lp = this._lp, lg = this._lg;
    for (let c = 0; c < this.nCells; c++) {
      for (let l = 0; l < 8; l++) { const n = this.cell[c * 8 + l] * 3; lp[l * 3] = rest[n]; lp[l * 3 + 1] = rest[n + 1]; lp[l * 3 + 2] = rest[n + 2]; }
      t.cellV0[c] = cellVolume(lp, lg);
    }
    if (geo.samples) { // surface contact points: cell index + trilinear weights of its 8 nodes
      const n = geo.samples.length / 3, U = geo.samples;
      if (n > this.maxSamples) throw new Error(`too many contact samples (${n})`);
      const S = { n, cell: new Int32Array(n), node: new Int32Array(n * 8), wt: new Float64Array(n * 8) };
      for (let s = 0; s < n; s++) {
        const cu = clamp(Math.floor(U[s * 3]), 0, N - 2), cv = clamp(Math.floor(U[s * 3 + 1]), 0, N - 2), cc = clamp(Math.floor(U[s * 3 + 2]), 0, N - 2);
        const fu = clamp(U[s * 3] - cu, 0, 1), fv = clamp(U[s * 3 + 1] - cv, 0, 1), fw = clamp(U[s * 3 + 2] - cc, 0, 1);
        S.cell[s] = cu + (N - 1) * (cv + (N - 1) * cc);
        for (let l = 0; l < 8; l++) {
          const lx = l & 1, ly = (l >> 1) & 1, lz = (l >> 2) & 1;
          S.node[s * 8 + l] = nid(cu + lx, cv + ly, cc + lz);
          S.wt[s * 8 + l] = (lx ? fu : 1 - fu) * (ly ? fv : 1 - fv) * (lz ? fw : 1 - fw);
        }
      }
      t.samples = S;
    }
    return t;
  }

  /** Map UI sliders (0..1) onto solver constants. Never resets the simulation. */
  applySettings() {
    const f = this.firmness;
    this.smAlpha = lerp(TUNE.smMin, TUNE.smMax, f * f);
    const hs = CFG.STEP / CFG.SUBSTEPS;
    this.smCap = lerp(TUNE.smCapSoft, TUNE.smCapFirm, f) * CFG.GRAVITY * hs * hs;
    this.edgeCompliance = Math.exp(lerp(Math.log(TUNE.edgeSoft), Math.log(TUNE.edgeFirm), f));
    this.intDamp = lerp(TUNE.intDampMin, TUNE.intDampMax, Math.pow(this.dampingAmt, 1.4));
  }

  /** Place object `slot` with rigid transform (centre of mass, quaternion) and rigid velocity; optionally switch its type. */
  spawn(slot, center, q, vel = [0, 0, 0], omega = [0, 0, 0], typeData = null) {
    if (typeData) this.slotData[slot] = typeData;
    const D = this.dice[slot], R = quatToMat(q, D.R), base = slot * NP, td = this.slotData[slot], r0 = td.r0;
    this.m.set(td.m, base); this.w.set(td.w, base);
    this.anchorS.fill(0, slot * this.maxSamples, (slot + 1) * this.maxSamples); this.stickS.fill(0, slot * this.maxSamples, (slot + 1) * this.maxSamples);
    D.q.set(q);
    for (let i = 0; i < NP; i++) {
      const o = (base + i) * 3, rx = r0[i * 3], ry = r0[i * 3 + 1], rz = r0[i * 3 + 2];
      const wx = R[0] * rx + R[1] * ry + R[2] * rz, wy = R[3] * rx + R[4] * ry + R[5] * rz, wz = R[6] * rx + R[7] * ry + R[8] * rz;
      this.x[o] = center[0] + wx; this.x[o + 1] = center[1] + wy; this.x[o + 2] = center[2] + wz;
      this.v[o] = vel[0] + omega[1] * wz - omega[2] * wy;
      this.v[o + 1] = vel[1] + omega[2] * wx - omega[0] * wz;
      this.v[o + 2] = vel[2] + omega[0] * wy - omega[1] * wx;
      this.p[o] = this.xs[o] = this.x[o]; this.p[o + 1] = this.xs[o + 1] = this.x[o + 1]; this.p[o + 2] = this.xs[o + 2] = this.x[o + 2];
      this.f[o] = this.f[o + 1] = this.f[o + 2] = 0;
      this.anchor[base + i] = 0;
    }
    D.c.set(center); D.cm.set(center); D.speed = 1; D.spin = 1; D.wobble = 0; D.maxStretch = 1;
    D.asleep = false; D.calmT = 0;
  }

  /**
   * Box-lattice objects fall asleep after resting calmly for a while: their many
   * surface contacts otherwise keep a sub-pixel hum. A sleeping object is frozen
   * (and static for others) until it is grabbed, poked, tossed or hit.
   */
  wake(slot) { const D = this.dice[slot]; D.asleep = false; D.calmT = 0; }

  setCount(n) {
    this.count = n;
    if (this.grab && this.grab.slot >= n) this.endGrab();
    this.pending = this.pending.filter((t) => t.slot < n);
  }

  // ---------------------------------------------------------------- stepping
  step(dt) {
    const n3 = this.count * NP * 3;
    for (let i = 0; i < n3; i++) this.xs[i] = this.x[i];
    for (let d = 0; d < this.count; d++) { const D = this.dice[d]; D.floorImpact = 0; D.diceImpact = 0; D.maxStretch = 1; }
    this.runPending();
    if (this.grab) { // target velocity for grab damping (pointer motion)
      const g = this.grab;
      for (let a = 0; a < 3; a++) { g.tvel[a] = lerp(g.tvel[a], (g.target[a] - g.prevTarget[a]) / dt, 0.5); g.prevTarget[a] = g.target[a]; }
      g.adh = Math.max(0, g.adh - dt * Math.max(0, g.pull - 0.55) * 1.1);
    }
    const h = dt / CFG.SUBSTEPS;
    for (let s = 0; s < CFG.SUBSTEPS; s++) {
      this.computeGrabForce();
      this.integrate(h);
      this.solveEdges(h);
      this.solveVolumes(h);
      this.shapeMatch();
      this.collideDice(h);
      this.collideGround(h);
      this.finishSubstep(h);
    }
    this.time += dt;
    for (let d = 0; d < this.count; d++) { // stability guard: never let a NaN escape
      const D = this.dice[d];
      if (!Number.isFinite(D.speed) || !Number.isFinite(D.cm[0]) || !Number.isFinite(D.cm[1])) {
        const c = Number.isFinite(D.c[0]) ? [D.c[0], Math.max(D.c[1], 1.2), D.c[2]] : [0, 2, 0];
        this.spawn(d, c, [0, 0, 0, 1]);
        this.nanResets = (this.nanResets || 0) + 1;
      }
    }
  }

  integrate(h) {
    const { x, p, v, f, w } = this, g = CFG.GRAVITY;
    for (let d = 0; d < this.count; d++) {
      if (this.dice[d].asleep) continue;
      const base = d * NP;
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3, wi = w[base + i];
        v[o] += h * f[o] * wi; v[o + 1] += h * (f[o + 1] * wi - g); v[o + 2] += h * f[o + 2] * wi;
        p[o] = x[o]; p[o + 1] = x[o + 1]; p[o + 2] = x[o + 2];
        x[o] += h * v[o]; x[o + 1] += h * v[o + 1]; x[o + 2] += h * v[o + 2];
      }
    }
  }

  /** XPBD lattice edges. Beyond the stretch limits the edge becomes rigid. */
  solveEdges(h) {
    const { x, w, cA, cB, cType } = this, nC = this.nC;
    const soft = this.edgeCompliance / (h * h);
    const maxR = TUNE.maxStretch, minR = TUNE.minStretch;
    const typeScale = [1, 1, 1.35, 1.8];
    for (let d = 0; d < this.count; d++) {
      if (this.dice[d].asleep) continue;
      const base = d * NP, cRest = this.slotData[d].edgeRest;
      let peak = 1;
      for (let c = 0; c < nC; c++) {
        const ia = cA[c], ib = cB[c], a = (base + ia) * 3, b = (base + ib) * 3;
        let dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        const r = cRest[c], ratio = len / r;
        if (ratio > peak) peak = ratio;
        let C, at;
        if (ratio > maxR) { C = len - maxR * r; at = 0; }
        else if (ratio < minR) { C = len - minR * r; at = 0; }
        else { C = len - r; at = soft * r * typeScale[cType[c]]; }
        const wa = w[base + ia], wb = w[base + ib];
        const k = -C / (wa + wb + at) / len;
        dx *= k; dy *= k; dz *= k;
        x[a] -= wa * dx; x[a + 1] -= wa * dy; x[a + 2] -= wa * dz;
        x[b] += wb * dx; x[b + 1] += wb * dy; x[b + 2] += wb * dz;
      }
      const D = this.dice[d];
      if (peak > D.maxStretch) D.maxStretch = peak;
      if (this.grab && this.grab.slot === d && peak > D.grabStretch) D.grabStretch = peak;
    }
  }

  /** XPBD cell volume constraints (sum of 8 corner tetrahedra) — local incompressibility. */
  solveVolumes(h) {
    const { x, w, cell, _lp: lp, _lg: lg } = this;
    const at = TUNE.volCompliance / (h * h);
    for (let d = 0; d < this.count; d++) {
      if (this.dice[d].asleep) continue;
      const base = d * NP, cellV0 = this.slotData[d].cellV0;
      for (let c = 0; c < this.nCells; c++) {
        for (let l = 0; l < 8; l++) { const o = (base + cell[c * 8 + l]) * 3; lp[l * 3] = x[o]; lp[l * 3 + 1] = x[o + 1]; lp[l * 3 + 2] = x[o + 2]; }
        const C = cellVolume(lp, lg) - cellV0[c];
        let den = at;
        for (let l = 0; l < 8; l++) den += w[base + cell[c * 8 + l]] * (lg[l * 3] ** 2 + lg[l * 3 + 1] ** 2 + lg[l * 3 + 2] ** 2);
        if (den < 1e-12) continue;
        const dl = -C / den;
        for (let l = 0; l < 8; l++) {
          const id = cell[c * 8 + l], o = (base + id) * 3, k = w[base + id] * dl;
          x[o] += k * lg[l * 3]; x[o + 1] += k * lg[l * 3 + 1]; x[o + 2] += k * lg[l * 3 + 2];
        }
      }
    }
  }

  /**
   * Weak global shape matching: fit the best rigid transform (R, c) to the
   * nodes and pull each node slightly toward its rigid goal. It keeps the
   * candy's memory of its shape (heavy, not slime) and provides the rotation
   * used for damping split, contacts and reading the result.
   */
  shapeMatch() {
    const { x, m } = this, A = this._A, alpha = this.smAlpha;
    for (let d = 0; d < this.count; d++) {
      if (this.dice[d].asleep) continue;
      const D = this.dice[d], base = d * NP, r0 = this.slotData[d].r0;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < NP; i++) { const o = (base + i) * 3, mi = m[base + i]; cx += mi * x[o]; cy += mi * x[o + 1]; cz += mi * x[o + 2]; }
      A.fill(0);
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3, mi = m[base + i];
        const px = (x[o] - cx) * mi, py = (x[o + 1] - cy) * mi, pz = (x[o + 2] - cz) * mi;
        const rx = r0[i * 3], ry = r0[i * 3 + 1], rz = r0[i * 3 + 2];
        A[0] += px * rx; A[1] += px * ry; A[2] += px * rz;
        A[3] += py * rx; A[4] += py * ry; A[5] += py * rz;
        A[6] += pz * rx; A[7] += pz * ry; A[8] += pz * rz;
      }
      extractRotation(A, D.q, 3);
      const R = quatToMat(D.q, D.R);
      D.c[0] = cx; D.c[1] = cy; D.c[2] = cz;
      // strain-softening: linear for small offsets (own weight, pokes), capped restoring
      // acceleration for big concentrated pulls so a strong drag draws the candy out
      const cap = this.grab && this.grab.slot === d ? this.smCap : Infinity, cap2 = cap * cap;
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3, rx = r0[i * 3], ry = r0[i * 3 + 1], rz = r0[i * 3 + 2];
        let dx = alpha * (cx + R[0] * rx + R[1] * ry + R[2] * rz - x[o]);
        let dy = alpha * (cy + R[3] * rx + R[4] * ry + R[5] * rz - x[o + 1]);
        let dz = alpha * (cz + R[6] * rx + R[7] * ry + R[8] * rz - x[o + 2]);
        const m2 = dx * dx + dy * dy + dz * dz;
        if (m2 > cap2) { const k = cap / Math.sqrt(m2); dx *= k; dy *= k; dz *= k; }
        x[o] += dx; x[o + 1] += dy; x[o + 2] += dz;
      }
    }
  }

  /** Object/object: surface nodes of A are pushed out of B's rest-shape SDF (in B's fitted frame); B takes the reaction rigidly. */
  collideDice(h) {
    for (let a = 0; a < this.count; a++) for (let b = a + 1; b < this.count; b++) {
      const A = this.dice[a], B = this.dice[b];
      if (A.asleep && B.asleep) continue;
      const dx = A.c[0] - B.c[0], dy = A.c[1] - B.c[1], dz = A.c[2] - B.c[2], rr = A.radius + B.radius;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      if (!A.asleep) this.collideOneWay(a, b, h);
      if (!B.asleep) this.collideOneWay(b, a, h);
    }
  }

  collideOneWay(ai, bi, h) {
    if (this.slotData[ai].samples) { this.collideSamples(ai, bi, h); return; }
    const { x, p, m } = this, B = this.dice[bi], R = B.R, c = B.c;
    const G = this.slotData[bi].grid, com = this.slotData[bi].com, margin = 0.012, mu = TUNE.muDice;
    let lx = 0, ly = 0, lz = 0, tx = 0, ty = 0, tz = 0, hits = 0, impact = 0;
    const bv = B.vcm, bw = B.om;
    for (let s = 0; s < this.surface.length; s++) {
      const i = this.surface[s], o = (ai * NP + i) * 3;
      const px = x[o] - c[0], py = x[o + 1] - c[1], pz = x[o + 2] - c[2];
      // node position in B's rest frame (Rᵀ·p + rest centre of mass)
      const qx = R[0] * px + R[3] * py + R[6] * pz + com[0], qy = R[1] * px + R[4] * py + R[7] * pz + com[1], qz = R[2] * px + R[5] * py + R[8] * pz + com[2];
      const sd = sampleSdfGrid(G, qx, qy, qz, _cg) - margin;
      if (sd >= 0) continue;
      const nx = _cg[0], ny = _cg[1], nz = _cg[2];
      const wx = R[0] * nx + R[1] * ny + R[2] * nz, wy = R[3] * nx + R[4] * ny + R[5] * nz, wz = R[6] * nx + R[7] * ny + R[8] * nz;
      // relative velocity of the node against B's surface (for friction + impact sound)
      const vbx = bv[0] + bw[1] * pz - bw[2] * py, vby = bv[1] + bw[2] * px - bw[0] * pz, vbz = bv[2] + bw[0] * py - bw[1] * px;
      const rvx = (x[o] - p[o]) / h - vbx, rvy = (x[o + 1] - p[o + 1]) / h - vby, rvz = (x[o + 2] - p[o + 2]) / h - vbz;
      const vn = rvx * wx + rvy * wy + rvz * wz;
      if (-vn > impact) impact = -vn;
      const pen = -sd * 0.5;
      x[o] += wx * pen; x[o + 1] += wy * pen; x[o + 2] += wz * pen;
      // Coulomb friction on the tangential slip of this substep
      const sx = (rvx - vn * wx) * h, sy = (rvy - vn * wy) * h, sz = (rvz - vn * wz) * h, sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-12) { const k = Math.min(1, mu * pen / sl); x[o] -= sx * k; x[o + 1] -= sy * k; x[o + 2] -= sz * k; }
      // equal and opposite reaction, accumulated as a rigid correction of B
      const mi = m[ai * NP + i] * pen;
      lx -= wx * mi; ly -= wy * mi; lz -= wz * mi;
      tx -= py * wz * mi - pz * wy * mi; ty -= pz * wx * mi - px * wz * mi; tz -= px * wy * mi - py * wx * mi;
      hits++;
    }
    if (hits) this.react(ai, bi, impact, lx, ly, lz, tx, ty, tz);
  }

  /** Box-lattice object A: its surface samples are pushed out of B; corrections spread over each sample's 8 nodes. */
  collideSamples(ai, bi, h) {
    const { x, p, w } = this, B = this.dice[bi], R = B.R, c = B.c, cell = this.cell, act = this._cellAct;
    const S = this.slotData[ai].samples, G = this.slotData[bi].grid, com = this.slotData[bi].com, margin = 0.012, mu = TUNE.muDice;
    const base = ai * NP, rB = B.radius + 0.05, rB2 = rB * rB;
    // only cells of A whose node sphere reaches B's bounding sphere can hold touching samples
    for (let k = 0; k < this.nCells; k++) {
      let mx = 0, my = 0, mz = 0, r2 = 0;
      for (let l = 0; l < 8; l++) { const o = (base + cell[k * 8 + l]) * 3; mx += x[o]; my += x[o + 1]; mz += x[o + 2]; }
      mx *= 0.125; my *= 0.125; mz *= 0.125;
      for (let l = 0; l < 8; l++) { const o = (base + cell[k * 8 + l]) * 3, d2 = (x[o] - mx) ** 2 + (x[o + 1] - my) ** 2 + (x[o + 2] - mz) ** 2; if (d2 > r2) r2 = d2; }
      act[k] = Math.hypot(mx - c[0], my - c[1], mz - c[2]) < Math.sqrt(r2) + rB ? 1 : 0;
    }
    let lx = 0, ly = 0, lz = 0, tx = 0, ty = 0, tz = 0, hits = 0, impact = 0;
    const bv = B.vcm, bw = B.om;
    for (let s = 0; s < S.n; s++) {
      if (!act[S.cell[s]]) continue;
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, den = 0;
      for (let l = 0; l < 8; l++) {
        const k = S.node[s * 8 + l], wt = S.wt[s * 8 + l], o = (base + k) * 3;
        px += wt * x[o]; py += wt * x[o + 1]; pz += wt * x[o + 2];
        qx += wt * p[o]; qy += wt * p[o + 1]; qz += wt * p[o + 2];
        den += wt * wt * w[base + k];
      }
      const rx = px - c[0], ry = py - c[1], rz = pz - c[2];
      if (rx * rx + ry * ry + rz * rz > rB2) continue;
      const bx = R[0] * rx + R[3] * ry + R[6] * rz + com[0], by = R[1] * rx + R[4] * ry + R[7] * rz + com[1], bz = R[2] * rx + R[5] * ry + R[8] * rz + com[2];
      const sd = sampleSdfGrid(G, bx, by, bz, _cg) - margin;
      if (sd >= 0) continue;
      const nx = R[0] * _cg[0] + R[1] * _cg[1] + R[2] * _cg[2], ny = R[3] * _cg[0] + R[4] * _cg[1] + R[5] * _cg[2], nz = R[6] * _cg[0] + R[7] * _cg[1] + R[8] * _cg[2];
      const vbx = bv[0] + bw[1] * rz - bw[2] * ry, vby = bv[1] + bw[2] * rx - bw[0] * rz, vbz = bv[2] + bw[0] * ry - bw[1] * rx;
      const rvx = (px - qx) / h - vbx, rvy = (py - qy) / h - vby, rvz = (pz - qz) / h - vbz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (-vn > impact) impact = -vn;
      const pen = -sd * 0.5;
      let cx = nx * pen, cy = ny * pen, cz = nz * pen;
      const sx = (rvx - vn * nx) * h, sy = (rvy - vn * ny) * h, sz = (rvz - vn * nz) * h, sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-12) { const k = Math.min(1, mu * pen / sl); cx -= sx * k; cy -= sy * k; cz -= sz * k; }
      const inv = 1 / den;
      for (let l = 0; l < 8; l++) {
        const k = S.node[s * 8 + l], f = S.wt[s * 8 + l] * w[base + k] * inv, o = (base + k) * 3;
        x[o] += cx * f; x[o + 1] += cy * f; x[o + 2] += cz * f;
      }
      const mi = pen * inv;   // the sample's effective mass is 1 / Σ wt²·w
      lx -= nx * mi; ly -= ny * mi; lz -= nz * mi;
      tx -= ry * nz * mi - rz * ny * mi; ty -= rz * nx * mi - rx * nz * mi; tz -= rx * ny * mi - ry * nx * mi;
      hits++;
    }
    if (hits) this.react(ai, bi, impact, lx, ly, lz, tx, ty, tz);
  }

  /**
   * Objects resting against each other fall asleep together, and only when every one of
   * them is calm (a die in the group must simply be at rest): if one froze alone, its
   * neighbour would lose half of its two-way contact support, shift, and wake it again.
   */
  trySleep(d) {
    const M = CFG.MAX_DICE, group = [d], seen = new Uint8Array(M);
    seen[d] = 1;
    for (let k = 0; k < group.length; k++) {
      const a = group[k];
      for (let b = 0; b < this.count; b++) {
        if (seen[b] || this.time - this.touchT[a * M + b] > 0.1) continue;
        seen[b] = 1;
        const B = this.dice[b];
        if (B.asleep) continue;
        if (this.slotData[b].type === 0) { if (B.speed > 0.1 || B.spin > 0.25) return false; continue; }
        if (B.calmT < 1.0) return false;
        group.push(b);
      }
    }
    for (const g of group) { // freeze exactly where they rest
      const G = this.dice[g], base = g * NP;
      for (let i = 0; i < NP; i++) { const o = (base + i) * 3; this.v[o] = this.v[o + 1] = this.v[o + 2] = 0; }
      G.asleep = true; G.speed = G.spin = G.wobble = 0;
      G.vcm.fill(0); G.om.fill(0);
    }
    return true;
  }

  /** Apply the accumulated contact reaction to B as a rigid correction (total mass 1). */
  react(ai, bi, impact, lx, ly, lz, tx, ty, tz) {
    const x = this.x, A = this.dice[ai], B = this.dice[bi], c = B.c;
    this.touchT[ai * CFG.MAX_DICE + bi] = this.touchT[bi * CFG.MAX_DICE + ai] = this.time;
    if (impact > A.diceImpact) A.diceImpact = impact;
    if (impact > B.diceImpact) B.diceImpact = impact;
    if (B.asleep) { // a real hit or the object in hand wakes it; resting neighbours leave it asleep (static)
      const hit = impact > 0.3 && (A.speed > 0.35 || A.spin > 0.6);
      if (hit || (this.grab && this.grab.slot === ai)) this.wake(bi); else return;
    }
    const I = B.invI, base = bi * NP;
    const ax = I[0] * tx + I[1] * ty + I[2] * tz, ay = I[3] * tx + I[4] * ty + I[5] * tz, az = I[6] * tx + I[7] * ty + I[8] * tz;
    for (let j = 0; j < NP; j++) {
      const o = (base + j) * 3, rx = x[o] - c[0], ry = x[o + 1] - c[1], rz = x[o + 2] - c[2];
      x[o] += lx + ay * rz - az * ry; x[o + 1] += ly + az * rx - ax * rz; x[o + 2] += lz + ax * ry - ay * rx;
    }
  }

  /** Floor (y = 0) with Coulomb friction, round table edge, and peelable stickiness for a grabbed object. */
  collideGround(h) {
    const { x, p } = this, muS = TUNE.muS, muK = TUNE.muK;
    const adh = TUNE.adhesion * (this.grab ? this.grab.adh : 0) * CFG.GRAVITY * h * h, W2 = CFG.WALL_R * CFG.WALL_R;
    const gslot = this.grab ? this.grab.slot : -1;
    for (let d = 0; d < this.count; d++) {
      if (this.dice[d].asleep) continue;
      if (this.slotData[d].samples) { this.groundSamples(d, h, d === gslot ? adh : 0, d === gslot); continue; }
      const D = this.dice[d], base = d * NP;
      let impact = 0, contacts = 0;
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3, y = x[o + 1];
        const anch = d === gslot && this.anchor[base + i] === 1;
        let load = -1;
        if (y < 0) {
          const vy = (p[o + 1] - y) / h;
          if (vy > impact) impact = vy;
          x[o + 1] = 0; load = -y + (anch ? adh : 0); contacts++;
        } else if (anch) {
          // finite stickiness: remove at most `adh` of lift per substep; peel once truly lifted
          const ny = y - Math.min(y, adh);
          x[o + 1] = ny; load = adh; contacts++;
          if (ny > 0.07) this.anchor[base + i] = 0;
        }
        if (load > 0) {
          const dx = x[o] - p[o], dz = x[o + 2] - p[o + 2], sl = Math.sqrt(dx * dx + dz * dz);
          if (sl < muS * load) { x[o] = p[o]; x[o + 2] = p[o + 2]; }
          else { const k = Math.min(1, muK * load / sl); x[o] -= dx * k; x[o + 2] -= dz * k; }
        }
        const r2 = x[o] * x[o] + x[o + 2] * x[o + 2];
        if (r2 > W2) { const k = CFG.WALL_R / Math.sqrt(r2); x[o] *= k; x[o + 2] *= k; }
      }
      if (impact > D.floorImpact) D.floorImpact = impact;
      D.contact = contacts;
    }
  }

  /**
   * Floor contact of a box-lattice object through its surface samples. A sample is a
   * convex combination of its cell's 8 nodes, so cells whose lowest node is well above
   * the floor are skipped. Each sample's correction (lift + friction) would move it
   * exactly, spread over its nodes by weight / mass; the corrections are accumulated
   * and averaged per node (Jacobi), because neighbouring samples share nodes and
   * sequential full corrections fight each other and make the resting object buzz.
   */
  groundSamples(d, h, adh, grabbed) {
    const { x, p, w } = this, D = this.dice[d], base = d * NP, S = this.slotData[d].samples, cell = this.cell, act = this._cellAct;
    const muS = TUNE.muS, muK = TUNE.muK, W = CFG.WALL_R, W2 = W * W, aBase = d * this.maxSamples;
    const acc = this._acc, cnt = this._cnt;
    acc.fill(0); cnt.fill(0);
    for (let k = 0; k < this.nCells; k++) {
      let mn = Infinity;
      for (let l = 0; l < 8; l++) { const y = x[(base + cell[k * 8 + l]) * 3 + 1]; if (y < mn) mn = y; }
      act[k] = mn < 0.02 ? 1 : 0;
    }
    let impact = 0, contacts = 0;
    const stick = this.stickS, sp = this.stickP;
    for (let s = 0; s < S.n; s++) {
      const anch = grabbed && this.anchorS[aBase + s] === 1;
      if (!act[S.cell[s]] && !anch) { stick[aBase + s] = 0; continue; }
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, den = 0;
      for (let l = 0; l < 8; l++) {
        const k = S.node[s * 8 + l], wt = S.wt[s * 8 + l], o = (base + k) * 3;
        px += wt * x[o]; py += wt * x[o + 1]; pz += wt * x[o + 2];
        qx += wt * p[o]; qy += wt * p[o + 1]; qz += wt * p[o + 2];
        den += wt * wt * w[base + k];
      }
      let dy = 0, load = -1;
      if (py < 0) {
        const vy = (qy - py) / h;
        if (vy > impact) impact = vy;
        dy = -py; load = -py + (anch ? adh : 0); contacts++;
      } else if (anch) {
        // finite stickiness: remove at most `adh` of lift per substep; peel once truly lifted
        const lift = Math.min(py, adh);
        dy = -lift; load = adh; contacts++;
        if (py - lift > 0.07) this.anchorS[aBase + s] = 0;
      }
      const si = aBase + s;
      if (load <= 0) { stick[si] = 0; continue; }
      // static friction holds the sample where it first gripped (no slow creep); kinetic slides it
      const sx = px - qx, sz = pz - qz, sl = Math.hypot(sx, sz);
      let fx, fz;
      if (sl < muS * load) {
        if (!stick[si]) { stick[si] = 1; sp[si * 2] = qx; sp[si * 2 + 1] = qz; }
        fx = sp[si * 2] - px; fz = sp[si * 2 + 1] - pz;
        if (fx * fx + fz * fz > 2.5e-5) { stick[si] = 0; fx = -sx; fz = -sz; }   // dragged > 5 mm from its grip: let go
      } else {
        const k = Math.min(1, muK * load / sl);
        fx = -sx * k; fz = -sz * k; stick[si] = 0;
      }
      const inv = 1 / den;
      for (let l = 0; l < 8; l++) {
        const wt = S.wt[s * 8 + l];
        if (wt < 1e-6) continue;
        const k = S.node[s * 8 + l], f = wt * w[base + k] * inv;
        acc[k * 3] += fx * f; acc[k * 3 + 1] += dy * f; acc[k * 3 + 2] += fz * f; cnt[k]++;
      }
    }
    for (let i = 0; i < NP; i++) {
      const o = (base + i) * 3;
      if (cnt[i] > 0) { const k = 1 / cnt[i]; x[o] += acc[i * 3] * k; x[o + 1] += acc[i * 3 + 1] * k; x[o + 2] += acc[i * 3 + 2] * k; }
      const r2 = x[o] * x[o] + x[o + 2] * x[o + 2]; // round table edge keeps the whole lattice in frame
      if (r2 > W2) { const k = W / Math.sqrt(r2); x[o] *= k; x[o + 2] *= k; }
    }
    if (impact > D.floorImpact) D.floorImpact = impact;
    D.contact = contacts;
  }

  /** Velocities from positions, then split damping: rigid spin vs. internal wobble. */
  finishSubstep(h) {
    const { x, p, v, m } = this, ih = 1 / h, vmax = TUNE.vmax;
    for (let d = 0; d < this.count; d++) {
      const D = this.dice[d], base = d * NP;
      if (D.asleep) { D.speed = D.spin = D.wobble = 0; D.contact = 1; continue; }
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3, mi = m[base + i];
        const ux = (x[o] - p[o]) * ih, uy = (x[o + 1] - p[o + 1]) * ih, uz = (x[o + 2] - p[o + 2]) * ih;
        v[o] = ux; v[o + 1] = uy; v[o + 2] = uz;
        cx += mi * x[o]; cy += mi * x[o + 1]; cz += mi * x[o + 2]; vx += mi * ux; vy += mi * uy; vz += mi * uz;
      }
      let Lx = 0, Ly = 0, Lz = 0, Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0, r2max = 0;
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3, mi = m[base + i];
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const ux = v[o] - vx, uy = v[o + 1] - vy, uz = v[o + 2] - vz;
        Lx += mi * (ry * uz - rz * uy); Ly += mi * (rz * ux - rx * uz); Lz += mi * (rx * uy - ry * ux);
        const rr = rx * rx + ry * ry + rz * rz; if (rr > r2max) r2max = rr;
        Ixx += mi * (rr - rx * rx); Iyy += mi * (rr - ry * ry); Izz += mi * (rr - rz * rz);
        Ixy -= mi * rx * ry; Ixz -= mi * rx * rz; Iyz -= mi * ry * rz;
      }
      // Restrained rebound: while touching the floor the rigid upward speed may not exceed
      // restitution × impact speed. The squash and internal wobble are untouched.
      if (!(this.grab && this.grab.slot === d)) {
        if (D.contact === 0) { if (vy < 0) D.impactV = -vy; }
        else if (vy > TUNE.restitution * D.impactV + 0.05) {
          const dv = vy - (TUNE.restitution * D.impactV + 0.05);
          for (let i = 0; i < NP; i++) v[(base + i) * 3 + 1] -= dv;
          vy -= dv;
        }
      }
      const I = D.invI;
      invSym3(Ixx, Iyy, Izz, Ixy, Ixz, Iyz, I);
      const wx = I[0] * Lx + I[1] * Ly + I[2] * Lz, wy = I[3] * Lx + I[4] * Ly + I[5] * Lz, wz = I[6] * Lx + I[7] * Ly + I[8] * Lz;
      const grabbed = this.grab && this.grab.slot === d;
      const rotK = grabbed ? TUNE.rotDampGrab : D.contact > 0 ? TUNE.rotDampContact : TUNE.rotDampAir;
      // rest assist: a grounded object that is almost still comes to rest instead of creeping
      // (a die only when a face points up, so one balanced on an edge still tips over naturally;
      // other objects only when nearly motionless, so a tipping object keeps tipping)
      const sp = Math.hypot(vx, vy, vz), om = Math.hypot(wx, wy, wz), Rd = D.R, isDie = this.slotData[d].type === 0;
      const flat = !isDie || Math.max(Math.abs(Rd[3]), Math.abs(Rd[4]), Math.abs(Rd[5])) > 0.965;
      const sp0 = isDie ? 0.45 : 0.25, om0 = isDie ? 0.7 : 0.35;
      const calm = !grabbed && flat && D.contact > 0 ? clamp(1 - Math.max(sp / sp0, om / om0), 0, 1) : 0;
      // time the rigid motion has been calm on the floor (the jelly may still jiggle); a contact
      // flickering for a substep on a point-supported object only pauses the clock
      // (the whole rest-assist band counts: a knobbly object can hover just above half of it while
      // its contacts chatter; the sleep ramp below then damps any slow roll out smoothly)
      const slow = sp < sp0 && om < om0;
      D.calmT = !isDie && !grabbed && slow ? (D.contact > 0 ? D.calmT + h : D.calmT) : 0;
      const sleep = clamp((D.calmT - 0.6) / 0.4, 0, 1) * 25;
      const kr = Math.exp(-(rotK + calm * TUNE.restAssist + sleep) * h), ki = Math.exp(-(this.intDamp + sleep) * h);
      const kl = Math.exp(-(TUNE.linDamp + calm * TUNE.restAssist + sleep) * h);
      let wob = 0;
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3;
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const sx = wy * rz - wz * ry, sy = wz * rx - wx * rz, sz = wx * ry - wy * rx;
        const dx = v[o] - vx - sx, dy = v[o + 1] - vy - sy, dz = v[o + 2] - vz - sz;
        wob += dx * dx + dy * dy + dz * dz;
        let nx = vx * kl + sx * kr + dx * ki, ny = vy * kl + sy * kr + dy * ki, nz = vz * kl + sz * kr + dz * ki;
        const s2 = nx * nx + ny * ny + nz * nz;
        if (s2 > vmax * vmax) { const k = vmax / Math.sqrt(s2); nx *= k; ny *= k; nz *= k; }
        v[o] = nx; v[o + 1] = ny; v[o + 2] = nz;
      }
      D.cm[0] = cx; D.cm[1] = cy; D.cm[2] = cz;
      D.vcm[0] = vx; D.vcm[1] = vy; D.vcm[2] = vz;
      D.om[0] = wx; D.om[1] = wy; D.om[2] = wz;
      D.speed = Math.hypot(vx, vy, vz); D.spin = Math.hypot(wx, wy, wz);
      D.wobble = Math.sqrt(wob / NP); D.radius = Math.sqrt(r2max) + 0.1;
      if (D.calmT > 1.2) this.trySleep(d);
    }
  }

  // ---------------------------------------------------------------- interaction
  /** Start pulling die `slot` at lattice coords u (exact picked surface point). */
  beginGrab(slot, u, restPoint, worldPoint) {
    const g = {
      slot, u: Float64Array.from(u), target: Float64Array.from(worldPoint), prevTarget: Float64Array.from(worldPoint),
      tvel: new Float64Array(3), cell: new Int32Array(8), cw: new Float64Array(8), off: new Float64Array(3),
      gi: [], gw: [], point: Float64Array.from(worldPoint), pull: 0,
      adh: 1, // table stickiness; fades while the pull stays strong so sustained pulls peel the die off
    };
    const cu = clamp(Math.floor(u[0]), 0, N - 2), cv = clamp(Math.floor(u[1]), 0, N - 2), cc = clamp(Math.floor(u[2]), 0, N - 2);
    const fu = clamp(u[0] - cu, 0, 1), fv = clamp(u[1] - cv, 0, 1), fw = clamp(u[2] - cc, 0, 1);
    let tx = 0, ty = 0, tz = 0;
    const r0 = this.slotData[slot].r0, com = this.slotData[slot].com;
    for (let l = 0; l < 8; l++) {
      const lx = l & 1, ly = (l >> 1) & 1, lz = (l >> 2) & 1;
      const id = nid(cu + lx, cv + ly, cc + lz), wgt = (lx ? fu : 1 - fu) * (ly ? fv : 1 - fv) * (lz ? fw : 1 - fw);
      g.cell[l] = id; g.cw[l] = wgt;
      tx += wgt * r0[id * 3]; ty += wgt * r0[id * 3 + 1]; tz += wgt * r0[id * 3 + 2];
    }
    // offset from the trilinear proxy to the exact surface point, in the object's rest frame
    g.off[0] = restPoint[0] - com[0] - tx; g.off[1] = restPoint[1] - com[1] - ty; g.off[2] = restPoint[2] - com[2] - tz;
    // Gaussian force footprint: the pulled region stretches first, the rest follows
    const s2 = 2 * TUNE.grabSigma * TUNE.grabSigma;
    let sum = 0;
    for (let i = 0; i < NP; i++) {
      const d2 = (this.grid[i * 3] - u[0]) ** 2 + (this.grid[i * 3 + 1] - u[1]) ** 2 + (this.grid[i * 3 + 2] - u[2]) ** 2;
      const wgt = Math.exp(-d2 / s2);
      if (wgt > 0.03) { g.gi.push(i); g.gw.push(wgt); sum += wgt; }
    }
    g.gw = g.gw.map((q) => q / sum);
    // grounded contact points stick to the table while pulled (peelable), so the object resists tipping
    const base = slot * NP, S = this.slotData[slot].samples;
    if (S) {
      const aBase = slot * this.maxSamples;
      for (let s = 0; s < S.n; s++) {
        let py = 0;
        for (let l = 0; l < 8; l++) py += S.wt[s * 8 + l] * this.x[(base + S.node[s * 8 + l]) * 3 + 1];
        this.anchorS[aBase + s] = py < 0.04 ? 1 : 0;
      }
    } else {
      // (the slightly domed bottom settles flat onto the table: ≤ 0.03 units, invisible)
      for (let i = 0; i < NP; i++) {
        const o = (base + i) * 3;
        if (this.x[o + 1] < 0.04) { this.anchor[base + i] = 1; this.x[o + 1] = 0; this.p[o + 1] = 0; this.v[o + 1] = 0; }
        else this.anchor[base + i] = 0;
      }
    }
    this.dice[slot].grabStretch = 1;
    this.wake(slot);
    this.grab = g;
    return g;
  }

  setGrabTarget(p) {
    if (!this.grab) return;
    const t = this.grab.target;
    t[0] = p[0]; t[1] = Math.max(p[1], 0.12); t[2] = p[2];
    const r = Math.hypot(t[0], t[2]), lim = CFG.WALL_R - 0.6;
    if (r > lim) { t[0] *= lim / r; t[2] *= lim / r; }
  }

  /** Ends the grab; returns how stretched the die was (1 = relaxed). */
  endGrab() {
    const g = this.grab;
    if (!g) return 1;
    const base = g.slot * NP;
    for (let i = 0; i < NP; i++) this.anchor[base + i] = 0;
    this.anchorS.fill(0, g.slot * this.maxSamples, (g.slot + 1) * this.maxSamples);
    for (const i of g.gi) { const o = (base + i) * 3; this.f[o] = this.f[o + 1] = this.f[o + 2] = 0; }
    this.grab = null;
    return this.dice[g.slot].grabStretch;
  }

  /** Bounded spring-damper from the exact grab point to the pointer target. */
  computeGrabForce() {
    const g = this.grab;
    if (!g) return;
    const { x, v, f } = this, base = g.slot * NP, R = this.dice[g.slot].R;
    let gx = 0, gy = 0, gz = 0;
    for (let l = 0; l < 8; l++) { const o = (base + g.cell[l]) * 3, w = g.cw[l]; gx += w * x[o]; gy += w * x[o + 1]; gz += w * x[o + 2]; }
    gx += R[0] * g.off[0] + R[1] * g.off[1] + R[2] * g.off[2];
    gy += R[3] * g.off[0] + R[4] * g.off[1] + R[5] * g.off[2];
    gz += R[6] * g.off[0] + R[7] * g.off[1] + R[8] * g.off[2];
    let vx = 0, vy = 0, vz = 0;
    for (let k = 0; k < g.gi.length; k++) { const o = (base + g.gi[k]) * 3, w = g.gw[k]; vx += w * v[o]; vy += w * v[o + 1]; vz += w * v[o + 2]; }
    const ex = g.target[0] - gx, ey = g.target[1] - gy, ez = g.target[2] - gz;
    let Fx = TUNE.grabK * ex - TUNE.grabC * (vx - g.tvel[0]);
    let Fy = TUNE.grabK * ey - TUNE.grabC * (vy - g.tvel[1]);
    let Fz = TUNE.grabK * ez - TUNE.grabC * (vz - g.tvel[2]);
    const Fm = Math.hypot(Fx, Fy, Fz), Fmax = TUNE.grabFmax * CFG.GRAVITY; // total mass is 1
    if (Fm > Fmax) { const k = Fmax / Fm; Fx *= k; Fy *= k; Fz *= k; }
    for (let k = 0; k < g.gi.length; k++) {
      const o = (base + g.gi[k]) * 3, w = g.gw[k];
      f[o] = w * Fx; f[o + 1] = w * Fy; f[o + 2] = w * Fz;
    }
    g.point[0] = gx; g.point[1] = gy; g.point[2] = gz;
    g.pull = Math.hypot(ex, ey, ez);
  }

  /** A quick tap: local inward velocity impulse around the tapped point. */
  poke(slot, u, n, strength) {
    const base = slot * NP, s2 = 2 * 0.62 * 0.62;
    this.wake(slot);
    for (let i = 0; i < NP; i++) {
      const d2 = (this.grid[i * 3] - u[0]) ** 2 + (this.grid[i * 3 + 1] - u[1]) ** 2 + (this.grid[i * 3 + 2] - u[2]) ** 2;
      const wgt = Math.exp(-d2 / s2);
      if (wgt < 0.02) continue;
      const o = (base + i) * 3;
      this.v[o] -= n[0] * strength * wgt; this.v[o + 1] -= n[1] * strength * wgt; this.v[o + 2] -= n[2] * strength * wgt;
    }
  }

  /** Throw die `slot` so it lands near `target` after ~tf seconds, spinning with ω. */
  toss(slot, target, tf, omega) {
    const D = this.dice[slot], base = slot * NP, c = D.cm;
    this.wake(slot);
    const vx = (target[0] - c[0]) / tf, vz = (target[2] - c[2]) / tf;
    const vy = (CFG.H * 1.05 - c[1]) / tf + 0.5 * CFG.GRAVITY * tf;
    for (let i = 0; i < NP; i++) {
      const o = (base + i) * 3, rx = this.x[o] - c[0], ry = this.x[o + 1] - c[1], rz = this.x[o + 2] - c[2];
      this.v[o] = vx + omega[1] * rz - omega[2] * ry;
      this.v[o + 1] = vy + omega[2] * rx - omega[0] * rz;
      this.v[o + 2] = vz + omega[0] * ry - omega[1] * rx;
      this.x[o + 1] += 0.03; this.p[o + 1] = this.x[o + 1];
      this.anchor[base + i] = 0;
    }
    this.anchorS.fill(0, slot * this.maxSamples, (slot + 1) * this.maxSamples); this.stickS.fill(0, slot * this.maxSamples, (slot + 1) * this.maxSamples);
  }

  schedule(slot, delay, fn) { this.pending.push({ slot, at: this.time + delay, fn }); }
  runPending() {
    if (!this.pending.length) return;
    const keep = [];
    for (const t of this.pending) (this.time >= t.at ? t.fn() : keep.push(t));
    this.pending = keep;
  }

  /** Face value on top, read from the die's actual fitted rotation (dice only). */
  upFace(slot) {
    if (!this.slotData[slot] || this.slotData[slot].type !== 0) return { value: 0, face: -1, confidence: 1 };
    const R = this.dice[slot].R;
    const ux = R[3], uy = R[4], uz = R[5]; // world up expressed in the die's rest frame (Rᵀ·ŷ)
    let best = 0, bestDot = -2;
    for (let f = 0; f < 6; f++) {
      const n = FACES[f].n, dot = n[0] * ux + n[1] * uy + n[2] * uz;
      if (dot > bestDot) { bestDot = dot; best = f; }
    }
    return { value: FACES[best].value, face: best, confidence: bestDot };
  }
}

/** Signed volume of a hexahedral cell as the sum of its 8 corner tetrahedra; writes gradients. */
const CORNER_SIGN = [1, -1, -1, 1, -1, 1, 1, -1];
function cellVolume(p, g) {
  g.fill(0);
  let V = 0;
  for (let a = 0; a < 8; a++) {
    const b = a ^ 1, c = a ^ 2, d = a ^ 4, s = CORNER_SIGN[a] / 6;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const e3x = p[d * 3] - ax, e3y = p[d * 3 + 1] - ay, e3z = p[d * 3 + 2] - az;
    const c23x = e2y * e3z - e2z * e3y, c23y = e2z * e3x - e2x * e3z, c23z = e2x * e3y - e2y * e3x;
    const c31x = e3y * e1z - e3z * e1y, c31y = e3z * e1x - e3x * e1z, c31z = e3x * e1y - e3y * e1x;
    const c12x = e1y * e2z - e1z * e2y, c12y = e1z * e2x - e1x * e2z, c12z = e1x * e2y - e1y * e2x;
    V += s * (e1x * c23x + e1y * c23y + e1z * c23z);
    g[b * 3] += s * c23x; g[b * 3 + 1] += s * c23y; g[b * 3 + 2] += s * c23z;
    g[c * 3] += s * c31x; g[c * 3 + 1] += s * c31y; g[c * 3 + 2] += s * c31z;
    g[d * 3] += s * c12x; g[d * 3 + 1] += s * c12y; g[d * 3 + 2] += s * c12z;
    g[a * 3] -= s * (c23x + c31x + c12x); g[a * 3 + 1] -= s * (c23y + c31y + c12y); g[a * 3 + 2] -= s * (c23z + c31z + c12z);
  }
  return V;
}

/** Rotation part of A (row-major) by Müller et al. 2016, warm-started from q. */
const _qa = new Float64Array(4), _qr = new Float64Array(9);
function extractRotation(A, q, iters) {
  for (let it = 0; it < iters; it++) {
    const R = quatToMat(q, _qr);
    let ox = 0, oy = 0, oz = 0, dd = 0;
    for (let j = 0; j < 3; j++) {
      const rx = R[j], ry = R[3 + j], rz = R[6 + j], ax = A[j], ay = A[3 + j], az = A[6 + j];
      ox += ry * az - rz * ay; oy += rz * ax - rx * az; oz += rx * ay - ry * ax;
      dd += rx * ax + ry * ay + rz * az;
    }
    const s = 1 / (Math.abs(dd) + 1e-9);
    ox *= s; oy *= s; oz *= s;
    const wl = Math.hypot(ox, oy, oz);
    if (wl < 1e-9) break;
    quatAxisAngle(ox, oy, oz, wl, _qa);
    quatMul(_qa, q, q);
    quatNormalize(q);
  }
}

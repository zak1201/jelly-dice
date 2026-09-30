
// ============================================================================
// 7. WEBGPU RENDERER
// ----------------------------------------------------------------------------
// Per frame: 1 compute (deform every object) → key-light depth + optical-depth
// maps → floor (paper, coloured soft shadows, contact AO) → for each object,
// far to near: copy the scene behind it, render its back-face depth, shade its
// front surface (thickness absorption + refraction), add its bubbles → post
// (FXAA, highlight roll-off, sRGB, dither). Object types are uploaded lazily
// into two shared buffers (static vertex records, indices); each slot draws
// its own type's range.
// ============================================================================
const DIE_FLOATS = 52;   // floats per object record (WGSL struct Die)

/** float32 → IEEE half bits (round to nearest; enough for distances of a few units). */
const _hf = new Float32Array(1), _hu = new Uint32Array(_hf.buffer);
function toHalf(v) {
  _hf[0] = v;
  const x = _hu[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? sign : sign | (((m | 0x800000) >> (1 - e)) + 0x1000) >> 13;
  if (e >= 31) return sign | 0x7c00;
  return sign | ((e << 10) + ((m + 0x1000) >> 13));
}

class Renderer {
  constructor(device, context, format) {
    this.device = device; this.context = context; this.format = format;
    this.frame = new Float32Array(100);   // matches WGSL struct Frame (400 bytes)
    this.frameU = new Uint32Array(this.frame.buffer);
    this.dieData = new Float32Array(CFG.MAX_DICE * DIE_FLOATS);
    this.nodeData = new Float32Array(CFG.MAX_DICE * NEP * 4);
    this.slotInfo = new Uint32Array(CFG.MAX_DICE * 4);   // per slot: vin base, surface verts, bubble verts, verts
    this.vinUsed = 0; this.idxUsed = 0;                   // bump allocators (records, indices)
    this.w = 0; this.h = 0;
    this.gpuErrors = [];
    device.addEventListener('uncapturederror', (e) => {
      this.gpuErrors.push(String(e.error && e.error.message));
      console.error('WebGPU error:', e.error && e.error.message);
    });
  }

  async init() {
    const d = this.device, BU = GPUBufferUsage, TU = GPUTextureUsage;
    d.pushErrorScope('validation');
    const buf = (size, usage) => d.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage });
    this.vinBuf = buf(CFG.VIN_CAP * 48, BU.STORAGE | BU.COPY_DST);
    this.idxBuf = buf(CFG.IDX_CAP * 4, BU.INDEX | BU.COPY_DST);
    this.voutBuf = buf(CFG.MAX_DICE * CFG.VCAP * 48, BU.STORAGE);
    this.nodeBuf = buf(this.nodeData.byteLength, BU.STORAGE | BU.COPY_DST);
    this.frameBuf = buf(400, BU.UNIFORM | BU.COPY_DST);
    this.diceBuf = buf(this.dieData.byteLength, BU.STORAGE | BU.COPY_DST);
    this.slotBuf = buf(this.slotInfo.byteLength, BU.UNIFORM | BU.COPY_DST);

    this.linSamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.cmpSamp = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    const S = CFG.SHADOW_SIZE, TS = CFG.THICK_SIZE;
    this.shadowDepth = d.createTexture({ size: [S, S], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
    this.shadowThick = d.createTexture({ size: [TS, TS], format: 'rgba16float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
    this.shadowDepthView = this.shadowDepth.createView();
    this.shadowThickView = this.shadowThick.createView();
    const GDm = CFG.SDF_DIMS;
    this.sdfAtlas = d.createTexture({ size: [GDm, GDm, GDm * CFG.SDF_SLABS], dimension: '3d', format: 'r16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });

    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE;
    const bgl = (entries) => d.createBindGroupLayout({ entries });
    this.bglGeom = bgl([
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V | F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
    ]);
    this.bglFront = bgl([
      { binding: 0, visibility: F, texture: { sampleType: 'float' } },
      { binding: 1, visibility: F, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: F, sampler: { type: 'filtering' } },
    ]);
    this.bglBubble = bgl([{ binding: 0, visibility: F, texture: { sampleType: 'depth' } }]);
    this.bglFloor = bgl([
      { binding: 0, visibility: F, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: F, texture: { sampleType: 'float' } },
      { binding: 2, visibility: F, sampler: { type: 'comparison' } },
      { binding: 3, visibility: F, sampler: { type: 'filtering' } },
      { binding: 4, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
    ]);
    this.bglPost = bgl([
      { binding: 0, visibility: F, texture: { sampleType: 'float' } },
      { binding: 1, visibility: F, sampler: { type: 'filtering' } },
      { binding: 2, visibility: F, buffer: { type: 'uniform' } },
    ]);
    this.bglDeform = bgl([
      { binding: 0, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'uniform' } },
    ]);
    const bg = (layout, res) => d.createBindGroup({ layout, entries: res.map((r, i) => ({ binding: i, resource: r })) });
    this.geomBG = bg(this.bglGeom, [{ buffer: this.frameBuf }, { buffer: this.diceBuf }, { buffer: this.voutBuf }]);
    this.deformBG = bg(this.bglDeform, [{ buffer: this.nodeBuf }, { buffer: this.vinBuf }, { buffer: this.voutBuf }, { buffer: this.slotBuf }]);
    this.floorBG = bg(this.bglFloor, [this.shadowDepthView, this.shadowThickView, this.cmpSamp, this.linSamp, this.sdfAtlas.createView({ dimension: '3d' })]);
    this._bg = bg;

    const modules = {};
    for (const [name, code] of Object.entries({ deform: WGSL_DEFORM, geom: WGSL_GEOM, die: WGSL_DIE, bubble: WGSL_BUBBLE, floor: WGSL_FLOOR, post: WGSL_POST })) {
      const m = d.createShaderModule({ label: name, code });
      // compile messages are advisory: never let a slow report block start-up
      const info = await Promise.race([m.getCompilationInfo(), new Promise((r) => setTimeout(() => r({ messages: [] }), 4000))]);
      const errs = info.messages.filter((x) => x.type === 'error');
      if (errs.length) throw new Error(`WGSL (${name}) line ${errs[0].lineNum}: ${errs[0].message}`);
      modules[name] = m;
    }
    const layout = (...l) => d.createPipelineLayout({ bindGroupLayouts: l });
    const pipe = (label, pl, module, vs, fs, targets, depth, cullMode = 'none') => d.createRenderPipeline({
      label, layout: pl,
      vertex: { module, entryPoint: vs },
      fragment: fs ? { module, entryPoint: fs, targets } : undefined,
      primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      depthStencil: depth,
    });
    const HDR = 'rgba16float';
    const plGeom = layout(this.bglGeom);
    this.deformPipe = d.createComputePipeline({ layout: layout(this.bglDeform), compute: { module: modules.deform, entryPoint: 'deform' } });
    this.shadowDepthPipe = pipe('shadowDepth', plGeom, modules.geom, 'vsLight', null, null,
      { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' });
    const add = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
    this.shadowThickPipe = pipe('shadowThick', plGeom, modules.geom, 'vsThick', 'fsThick', [{ format: 'rgba16float', blend: { color: add, alpha: add } }]);
    this.floorPipe = pipe('floor', layout(this.bglGeom, this.bglFloor), modules.floor, 'vsFull', 'fsFloor', [{ format: HDR }],
      { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' });
    this.backPipe = pipe('backFaces', plGeom, modules.geom, 'vsDie', null, null,
      { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' }, 'front');
    this.frontPipe = pipe('jelly', layout(this.bglGeom, this.bglFront), modules.die, 'vsDie', 'fsDie', [{ format: HDR }],
      { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
    const over = { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' };
    this.bubblePipe = pipe('bubbles', layout(this.bglGeom, this.bglBubble), modules.bubble, 'vsBubble', 'fsBubble', [{ format: HDR, blend: { color: over, alpha: over } }]);
    this.postPipe = pipe('post', layout(this.bglPost), modules.post, 'vsFull', 'fsPost', [{ format: this.format }]);
    const err = await d.popErrorScope();
    if (err) throw new Error(err.message);
  }

  /** Upload one object type's static vertex records and indices; returns where it lives on the GPU. */
  uploadType(geo) {
    const records = geo.vin.length / 12;
    if (geo.perDie > CFG.VCAP) throw new Error(`object type ${geo.type} has ${geo.perDie} vertices (> ${CFG.VCAP})`);
    if (this.vinUsed + records > CFG.VIN_CAP || this.idxUsed + geo.idx.length > CFG.IDX_CAP) throw new Error('GPU geometry buffers are full');
    const t = {
      vinBase: this.vinUsed, firstIndex: this.idxUsed, surfIdxCount: geo.surfIdxCount, bubbleIdxCount: geo.bubbleIdxCount,
      surfCount: geo.surfCount, bubbleVerts: geo.bubbleVerts, perDie: geo.perDie,
    };
    this.device.queue.writeBuffer(this.vinBuf, this.vinUsed * 48, geo.vin);
    // this type's signed-distance slab (half floats) for the floor's contact occlusion
    const G = geo.grid, n = G.dims, h16 = new Uint16Array(n * n * n);
    if (n !== CFG.SDF_DIMS) throw new Error('SDF grid size mismatch');
    for (let i = 0; i < h16.length; i++) h16[i] = toHalf(G.data[i]);
    this.device.queue.writeTexture({ texture: this.sdfAtlas, origin: { x: 0, y: 0, z: geo.type * n } }, h16, { bytesPerRow: n * 2, rowsPerImage: n }, { width: n, height: n, depthOrArrayLayers: n });
    this.device.queue.writeBuffer(this.idxBuf, this.idxUsed * 4, geo.idx);
    this.vinUsed += records; this.idxUsed += geo.idx.length;
    return t;
  }

  /** (Re)create screen-size targets. Called on resize only. */
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const d = this.device, TU = GPUTextureUsage;
    for (const t of [this.sceneColor, this.backdrop, this.depthMain, this.backDepth]) if (t) t.destroy();
    this.w = w; this.h = h;
    this.sceneColor = d.createTexture({ size: [w, h], format: 'rgba16float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_SRC });
    this.backdrop = d.createTexture({ size: [w, h], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
    this.depthMain = d.createTexture({ size: [w, h], format: 'depth24plus', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
    this.backDepth = d.createTexture({ size: [w, h], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
    this.sceneView = this.sceneColor.createView();
    this.depthMainView = this.depthMain.createView();
    this.backDepthView = this.backDepth.createView();
    this.frontBG = this._bg(this.bglFront, [this.backdrop.createView(), this.backDepthView, this.linSamp]);
    this.bubbleBG = this._bg(this.bglBubble, [this.depthMainView]);
    this.postBG = this._bg(this.bglPost, [this.sceneView, this.linSamp, { buffer: this.frameBuf }]);
  }

  /** Upload interpolated lattice nodes (with ghost layer) and the per-slot type ranges. */
  uploadNodes(positions, count, slotGpu) {
    for (let s = 0; s < count; s++) {
      extendNodes(positions, s * NP * 3, this.nodeData, s * NEP * 4, 4);
      const t = slotGpu[s], o = s * 4;
      this.slotInfo[o] = t.vinBase; this.slotInfo[o + 1] = t.surfCount; this.slotInfo[o + 2] = t.bubbleVerts; this.slotInfo[o + 3] = t.perDie;
    }
    this.device.queue.writeBuffer(this.nodeBuf, 0, this.nodeData, 0, count * NEP * 4);
    this.device.queue.writeBuffer(this.slotBuf, 0, this.slotInfo);
  }

  uploadFrame() { this.device.queue.writeBuffer(this.frameBuf, 0, this.frame); }
  uploadDice(count) { this.device.queue.writeBuffer(this.diceBuf, 0, this.dieData, 0, Math.max(1, count) * DIE_FLOATS); }

  render(count, order, rects, slotGpu) {
    const d = this.device;
    const enc = d.createCommandEncoder();
    let maxVerts = 1;
    for (let s = 0; s < count; s++) maxVerts = Math.max(maxVerts, slotGpu[s].perDie);
    const cp = enc.beginComputePass();
    cp.setPipeline(this.deformPipe);
    cp.setBindGroup(0, this.deformBG);
    if (count > 0) cp.dispatchWorkgroups(Math.ceil(maxVerts / 64), count);
    cp.end();

    const surfaces = (p) => { for (let s = 0; s < count; s++) { const t = slotGpu[s]; p.drawIndexed(t.surfIdxCount, 1, t.firstIndex, 0, s); } };
    let p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowDepthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    p.setPipeline(this.shadowDepthPipe); p.setBindGroup(0, this.geomBG); p.setIndexBuffer(this.idxBuf, 'uint32');
    surfaces(p); p.end();

    p = enc.beginRenderPass({ colorAttachments: [{ view: this.shadowThickView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.shadowThickPipe); p.setBindGroup(0, this.geomBG); p.setIndexBuffer(this.idxBuf, 'uint32');
    surfaces(p); p.end();

    p = enc.beginRenderPass({
      colorAttachments: [{ view: this.sceneView, clearValue: [...PAPER_LIN, 1], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthMainView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    p.setPipeline(this.floorPipe); p.setBindGroup(0, this.geomBG); p.setBindGroup(1, this.floorBG); p.draw(3); p.end();

    for (const s of order) {
      const r = rects[s], t = slotGpu[s];
      if (!r) continue;
      enc.copyTextureToTexture({ texture: this.sceneColor, origin: { x: r[0], y: r[1] } }, { texture: this.backdrop, origin: { x: r[0], y: r[1] } },
        { width: r[2] - r[0], height: r[3] - r[1] });
      p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.backDepthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setPipeline(this.backPipe); p.setBindGroup(0, this.geomBG); p.setIndexBuffer(this.idxBuf, 'uint32');
      p.drawIndexed(t.surfIdxCount, 1, t.firstIndex, 0, s); p.end();

      p = enc.beginRenderPass({
        colorAttachments: [{ view: this.sceneView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depthMainView, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      p.setPipeline(this.frontPipe); p.setBindGroup(0, this.geomBG); p.setBindGroup(1, this.frontBG); p.setIndexBuffer(this.idxBuf, 'uint32');
      p.drawIndexed(t.surfIdxCount, 1, t.firstIndex, 0, s); p.end();

      p = enc.beginRenderPass({ colorAttachments: [{ view: this.sceneView, loadOp: 'load', storeOp: 'store' }] });
      p.setPipeline(this.bubblePipe); p.setBindGroup(0, this.geomBG); p.setBindGroup(1, this.bubbleBG); p.setIndexBuffer(this.idxBuf, 'uint32');
      p.drawIndexed(t.bubbleIdxCount, 1, t.firstIndex + t.surfIdxCount, 0, s); p.end();
    }

    p = enc.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: [0.95, 0.93, 0.9, 1], loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.postPipe); p.setBindGroup(0, this.postBG); p.draw(3); p.end();
    d.queue.submit([enc.finish()]);
  }
}

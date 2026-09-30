
// ============================================================================
// 5. SOUND — original, quiet Web Audio effects (no files, no music)
// ----------------------------------------------------------------------------
// Every voice = short filtered-noise click + low triangle tone whose pitch
// drops quickly. One shared noise buffer, a voice cap, per-key throttling,
// and every node is disconnected when its voice ends. The AudioContext is
// created only inside the user's "Sound on" click.
// ============================================================================
class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.active = 0;
    this.maxVoices = 10;
    this.last = new Map();
    this.played = 0;   // counters for self-tests
    this.skipped = 0;
  }

  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
      this.master = c.createGain();
      this.master.gain.value = 0.8;
      this.soft = c.createBiquadFilter();     // gentle top-end roll-off: nothing harsh
      this.soft.type = 'lowpass'; this.soft.frequency.value = 6200; this.soft.Q.value = 0.4;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -20; this.comp.knee.value = 12; this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003; this.comp.release.value = 0.12;
      this.master.connect(this.soft).connect(this.comp).connect(c.destination);
      const len = Math.floor(c.sampleRate * 0.5);
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const ch = this.noise.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) { const wn = Math.random() * 2 - 1; b = 0.72 * b + 0.28 * wn; ch[i] = b * 1.6; } // slightly darkened noise
    }
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* ignored */ } }
    this.on = true;
    return true;
  }

  disable() {
    this.on = false;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  /** Low-level voice. All times in seconds, gains linear. */
  voice(o) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return false;
    if (this.active >= this.maxVoices) { this.skipped++; return false; }
    const c = this.ctx, t = c.currentTime + 0.004 + (o.delay || 0);
    const out = c.createGain();
    out.gain.value = o.gain;
    out.connect(this.master);

    const src = c.createBufferSource();
    src.buffer = this.noise;
    const flt = c.createBiquadFilter();
    flt.type = o.clickType || 'bandpass'; flt.frequency.value = o.clickFreq; flt.Q.value = o.clickQ || 0.8;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(o.click, t + 0.0025);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + o.clickDecay);
    src.connect(flt).connect(cg).connect(out);
    src.start(t, Math.random() * 0.4, o.clickDecay + 0.02);

    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.toneDecay * 0.75);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(o.tone, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + o.toneDecay);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + o.toneDecay + 0.03);

    this.active++; this.played++;
    const nodes = [src, flt, cg, osc, og, out];
    osc.onended = () => {
      for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } }
      this.active--;
    };
    return true;
  }

  /** kind: toss | land | clack | poke | release; strength 0..1 scales loudness and brightness. */
  play(kind, strength, key = kind, delay = 0) {
    if (!this.on || !this.ctx) return false;
    const now = performance.now(), gap = kind === 'land' || kind === 'clack' ? 85 : 45;
    if (now - (this.last.get(key) || -1e9) < gap) return false;
    this.last.set(key, now);
    const s = clamp(strength, 0, 1);
    const vary = (amt) => 1 + (Math.random() * 2 - 1) * amt;   // subtle random variation per voice
    switch (kind) {
      case 'land': return this.voice({
        delay, gain: (0.05 + 0.32 * Math.pow(s, 1.25)) * vary(0.15),
        clickType: 'lowpass', clickFreq: (700 + 2300 * s) * vary(0.1), clickQ: 0.7, click: 0.55, clickDecay: 0.028 + 0.02 * s,
        f0: (135 + 85 * s) * vary(0.06), f1: (52 + 18 * s) * vary(0.05), tone: 0.8, toneDecay: 0.085 + 0.07 * s,
      });
      case 'clack': return this.voice({
        delay, gain: (0.04 + 0.22 * s) * vary(0.15),
        clickType: 'bandpass', clickFreq: (1300 + 1500 * s) * vary(0.12), clickQ: 1.1, click: 0.6, clickDecay: 0.022,
        f0: (240 + 90 * s) * vary(0.07), f1: 120 * vary(0.06), tone: 0.55, toneDecay: 0.06 + 0.03 * s,
      });
      case 'poke': return this.voice({
        delay, gain: 0.13 * vary(0.12),
        clickType: 'bandpass', clickFreq: 1700 * vary(0.12), clickQ: 1.2, click: 0.35, clickDecay: 0.02,
        f0: 330 * vary(0.06), f1: 150 * vary(0.05), tone: 0.8, toneDecay: 0.075,
      });
      case 'release': return this.voice({
        delay, gain: (0.06 + 0.18 * s) * vary(0.12),
        clickType: 'lowpass', clickFreq: 1300 * vary(0.1), clickQ: 0.6, click: 0.35, clickDecay: 0.035,
        f0: (190 + 70 * s) * vary(0.06), f1: 88 * vary(0.05), tone: 0.9, toneDecay: 0.14 + 0.06 * s,
      });
      case 'toss': return this.voice({
        delay, gain: 0.06 * vary(0.2),
        clickType: 'bandpass', clickFreq: 2100 * vary(0.15), clickQ: 0.9, click: 0.5, clickDecay: 0.05,
        f0: 250 * vary(0.08), f1: 135 * vary(0.06), tone: 0.45, toneDecay: 0.07,
      });
      default: return false;
    }
  }
}

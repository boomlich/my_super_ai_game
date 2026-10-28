// ZONE ZERO: Procedural audio engine (Web Audio, no assets)
//
// Signal flow:  voice bus -> [panner + air-absorption filter] -> sfx bus -+
//                         \-> reverb send -> convolver -------------------+-> compressor -> master -> underwater filter -> out
//               ambience layers -> ambience bus ---------------------------+
//
// Every effect is built from layered noise bursts and short tones with small random pitch/gain variation so
// repeated sounds (gunfire, footsteps, chops) never sound like the same sample twice. Sounds that originate in
// the world accept a `pos` and are panned / attenuated / low-passed relative to the listener.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const jitter = (v, amount) => v * (1 + (Math.random() - 0.5) * 2 * amount);

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.isUnderwater = false;
    this.listener = { x: 0, y: 0, z: 0 };
    this.timers = { bird: 3, heart: 0, fire: 0, drip: 2 };
    this.stepAlt = false;
  }

  // ---------- setup ----------

  init() {
    if (this.initialized) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AudioContext());
    const now = ctx.currentTime;

    this.underwaterFilter = ctx.createBiquadFilter();
    this.underwaterFilter.type = 'lowpass';
    this.underwaterFilter.frequency.value = 20000;
    this.underwaterFilter.connect(ctx.destination);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.underwaterFilter);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 14;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.22;
    this.compressor.connect(this.masterGain);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.compressor);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.compressor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4, 3.0);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.7;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.compressor);

    this.white = this.makeNoise(3, false);
    this.pink = this.makeNoise(4, true);

    this.initAmbience(now);
    this.initialized = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setUnderwater(isUnder) {
    if (!this.ctx || this.isUnderwater === isUnder) return;
    this.isUnderwater = isUnder;
    const now = this.ctx.currentTime;
    this.underwaterFilter.frequency.setTargetAtTime(isUnder ? 380 : 20000, now, 0.07);
    this.underGain.gain.setTargetAtTime(isUnder ? 0.5 : 0, now, 0.3);
  }

  setListener(x, y, z, fx, fy, fz) {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  makeNoise(seconds, pink) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (!pink) {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  // Stereo exponentially decaying noise: a cheap outdoor "slap-back" reverb
  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      const pre = Math.floor(ctx.sampleRate * 0.018);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.25 + 0.75 * (1 - t));
        d[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  // ---------- voice building blocks ----------

  // Voice bus: optional 3D placement + reverb send. Returns the node a voice should connect to.
  bus(pos, { rev = 0.12, gain = 1 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;

    let tail = g;
    if (pos) {
      const dx = pos.x - this.listener.x;
      const dy = pos.y - this.listener.y;
      const dz = pos.z - this.listener.z;
      const dist = Math.hypot(dx, dy, dz);

      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = clamp(16000 / (1 + dist / 35), 900, 16000);
      g.connect(air);

      const panner = new PannerNode(ctx, {
        panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 7, maxDistance: 500, rolloffFactor: 1.25,
        positionX: pos.x, positionY: pos.y, positionZ: pos.z
      });
      air.connect(panner);
      tail = panner;
      rev = rev * (1 + Math.min(1.5, dist / 60));
    }
    tail.connect(this.sfxBus);

    if (rev > 0.001) {
      const send = ctx.createGain();
      send.gain.value = rev;
      tail.connect(send);
      send.connect(this.reverb);
    }
    return g;
  }

  // Short tone with exponential pitch sweep and amplitude envelope
  tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.5, attack = 0.002, out, delay = 0, curve = 0.5 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur * curve * 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return { osc, g };
  }

  // Filtered noise burst. filter: { type, f0, f1, q }
  noise({ dur = 0.1, gain = 0.5, attack = 0.001, filter, out, delay = 0, pink = false, decay = 1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = pink ? this.pink : this.white;
    const offset = Math.random() * (src.buffer.duration - dur - 0.1);

    let node = src;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.Q.value = filter.q ?? 0.7;
      f.frequency.setValueAtTime(filter.f0, t);
      if (filter.f1 && filter.f1 !== filter.f0) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / decay);
    node.connect(g);
    g.connect(out);
    src.start(t, offset, dur + 0.05);
    src.stop(t + dur + 0.05);
    return g;
  }

  // ---------- gunfire ----------

  playRifleShot(pos = null, enemy = false) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: enemy ? 0.3 : 0.16, gain: enemy ? 0.75 : 1 });
    const p = jitter(1, 0.06);
    // Crack, body, thump: three layers with different decay times
    this.noise({ dur: 0.012, gain: 0.9, filter: { type: 'highpass', f0: 3500 * p }, out });
    this.noise({ dur: 0.07, gain: 0.8, filter: { type: 'bandpass', f0: 2600 * p, f1: 1100, q: 1.1 }, out });
    this.noise({ dur: 0.2, gain: 0.55, filter: { type: 'lowpass', f0: 1500 * p, f1: 260 }, out, decay: 1.2 });
    this.tone({ f0: 150 * p, f1: 48, dur: 0.14, gain: 0.85, out });
    if (!enemy) this.tone({ type: 'triangle', f0: 90 * p, f1: 40, dur: 0.2, gain: 0.35, out, delay: 0.005 });
  }

  playShotgunShot(pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.22 });
    const p = jitter(1, 0.05);
    this.noise({ dur: 0.015, gain: 1, filter: { type: 'highpass', f0: 2200 * p }, out });
    this.noise({ dur: 0.12, gain: 0.95, filter: { type: 'bandpass', f0: 1700 * p, f1: 500, q: 0.8 }, out });
    this.noise({ dur: 0.38, gain: 0.8, filter: { type: 'lowpass', f0: 1100 * p, f1: 150 }, out, decay: 1.3 });
    this.tone({ f0: 110 * p, f1: 32, dur: 0.3, gain: 1.0, out });
    // Pump-action cycle: forend back then forward
    this.mechClack(out, 0.42, 1.0, 0.7);
    this.mechClack(out, 0.62, 0.8, 0.9);
  }

  playSniperShot(pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.5 });
    this.noise({ dur: 0.02, gain: 1, filter: { type: 'highpass', f0: 3000 }, out });
    this.noise({ dur: 0.18, gain: 1, filter: { type: 'bandpass', f0: 3800, f1: 700, q: 0.9 }, out });
    this.noise({ dur: 0.9, gain: 0.7, filter: { type: 'lowpass', f0: 1300, f1: 90 }, out, decay: 1.4 });
    this.tone({ f0: 85, f1: 24, dur: 0.55, gain: 1.1, out });
    this.tone({ type: 'triangle', f0: 190, f1: 60, dur: 0.15, gain: 0.5, out });
    // Bolt cycling a moment later
    this.mechClack(out, 0.72, 0.8, 0.8);
    this.mechClack(out, 0.9, 0.9, 1.1);
    this.mechClack(out, 1.08, 0.7, 0.9);
  }

  // Metallic click used for bolts, pumps, magazine latches
  mechClack(out, delay = 0, gain = 0.6, pitch = 1) {
    this.noise({ dur: 0.012, gain: 0.55 * gain, filter: { type: 'bandpass', f0: 3000 * pitch, q: 2 }, out, delay });
    this.tone({ type: 'square', f0: 1400 * pitch, f1: 520 * pitch, dur: 0.035, gain: 0.12 * gain, out, delay });
    this.tone({ f0: 210 * pitch, f1: 110 * pitch, dur: 0.05, gain: 0.35 * gain, out, delay: delay + 0.004 });
  }

  playBulletWhizz(pos) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.05, gain: 0.7 });
    this.noise({ dur: 0.16, gain: 0.45, filter: { type: 'bandpass', f0: 3600, f1: 1400, q: 3 }, out, attack: 0.04 });
  }

  playDryFire() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.02 });
    this.mechClack(out, 0, 0.5, 1.3);
  }

  // Reload sequence matched to the 1.5 s reload timer
  playReload(type = 'rifle') {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.04, gain: 0.85 });
    if (type === 'shotgun') {
      for (let i = 0; i < 4; i++) {
        this.mechClack(out, 0.1 + i * 0.32, 0.7, 1.4 + i * 0.05);
        this.noise({ dur: 0.04, gain: 0.2, filter: { type: 'lowpass', f0: 900 }, out, delay: 0.12 + i * 0.32 });
      }
      this.mechClack(out, 1.45, 1.0, 0.8);
      return;
    }
    // Magazine out, magazine in, bolt release
    this.mechClack(out, 0.05, 0.8, 1.1);
    this.noise({ dur: 0.18, gain: 0.18, filter: { type: 'bandpass', f0: 900, q: 1 }, out, delay: 0.1 });
    this.noise({ dur: 0.05, gain: 0.5, filter: { type: 'lowpass', f0: 700 }, out, delay: 0.75 });
    this.mechClack(out, 0.78, 1.0, 0.9);
    this.mechClack(out, type === 'sniper' ? 1.25 : 1.2, 0.9, 0.7);
    this.mechClack(out, type === 'sniper' ? 1.4 : 1.33, 0.6, 1.2);
  }

  playPinPull() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.04 });
    this.tone({ f0: 2600, f1: 1800, dur: 0.06, gain: 0.18, type: 'triangle', out });
    this.mechClack(out, 0.07, 0.7, 1.6);
    this.noise({ dur: 0.18, gain: 0.12, filter: { type: 'bandpass', f0: 1800, f1: 900, q: 1 }, out, delay: 0.12 });
  }

  playExplosion(pos = null, volume = 1) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.9, gain: volume });
    this.tone({ f0: 78, f1: 22, dur: 1.4, gain: 1.4, out });
    this.tone({ type: 'triangle', f0: 160, f1: 40, dur: 0.5, gain: 0.8, out });
    this.noise({ dur: 0.05, gain: 1, filter: { type: 'highpass', f0: 1500 }, out });
    this.noise({ dur: 1.6, gain: 1.1, filter: { type: 'lowpass', f0: 3200, f1: 120 }, out, decay: 1.5 });
    // Falling debris
    for (let i = 0; i < 14; i++) {
      this.noise({
        dur: rnd(0.03, 0.09), gain: rnd(0.12, 0.35),
        filter: { type: 'bandpass', f0: rnd(500, 3000), q: 1.5 }, out, delay: 0.25 + Math.random() * 1.1
      });
    }
    // Duck the ambience so the blast actually hits
    if (this.ambBus) {
      const now = this.ctx.currentTime;
      this.ambBus.gain.cancelScheduledValues(now);
      this.ambBus.gain.setValueAtTime(0.12, now);
      this.ambBus.gain.setTargetAtTime(0.5, now + 0.4, 0.8);
    }
  }

  playThunder(delay = 1.2) {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.8, gain: 0.9 });
    this.noise({ dur: 3.2, gain: 0.7, attack: 0.25, filter: { type: 'lowpass', f0: 420, f1: 70 }, out, delay, pink: true, decay: 1.4 });
    this.tone({ f0: 55, f1: 28, dur: 2.2, gain: 0.5, attack: 0.3, out, delay });
    for (let i = 0; i < 5; i++) {
      this.noise({ dur: 0.35, gain: rnd(0.2, 0.4), attack: 0.08, filter: { type: 'lowpass', f0: rnd(200, 500) }, out, delay: delay + 0.3 + i * rnd(0.3, 0.6), pink: true });
    }
  }

  // ---------- impacts, tools, building ----------

  playImpact(material = 'dirt', pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.1, gain: 0.8 });
    const p = jitter(1, 0.15);
    switch (material) {
      case 'flesh':
        this.tone({ f0: 130 * p, f1: 55, dur: 0.1, gain: 0.7, out });
        this.noise({ dur: 0.07, gain: 0.5, filter: { type: 'lowpass', f0: 1100 }, out });
        break;
      case 'wood':
        this.tone({ type: 'triangle', f0: 240 * p, f1: 110, dur: 0.1, gain: 0.6, out });
        this.noise({ dur: 0.06, gain: 0.5, filter: { type: 'bandpass', f0: 800 * p, q: 1.2 }, out });
        break;
      case 'rock':
        this.noise({ dur: 0.03, gain: 0.7, filter: { type: 'highpass', f0: 2500 }, out });
        this.tone({ f0: 900 * p, f1: 420, dur: 0.05, gain: 0.3, out });
        this.noise({ dur: 0.15, gain: 0.25, filter: { type: 'bandpass', f0: 1500, q: 2 }, out, delay: 0.02 });
        break;
      case 'metal':
        this.noise({ dur: 0.02, gain: 0.6, filter: { type: 'highpass', f0: 3000 }, out });
        [1180, 1760, 2640].forEach((f, i) => this.tone({ f0: f * p, dur: 0.3 - i * 0.07, gain: 0.22 / (i + 1), out }));
        break;
      case 'water':
        this.noise({ dur: 0.14, gain: 0.45, filter: { type: 'bandpass', f0: 1400, f1: 500, q: 1 }, out });
        break;
      default:
        this.noise({ dur: 0.08, gain: 0.5, filter: { type: 'lowpass', f0: 600 * p }, out });
        this.tone({ f0: 100 * p, f1: 50, dur: 0.08, gain: 0.35, out });
    }
  }

  playSwing() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.02, gain: 0.7 });
    this.noise({ dur: 0.22, gain: 0.3, attack: 0.06, filter: { type: 'bandpass', f0: 450, f1: 1700, q: 0.9 }, out, pink: true });
  }

  // Hatchet biting into wood
  playAxeChop(pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.14 });
    const p = jitter(1, 0.1);
    this.noise({ dur: 0.012, gain: 0.6, filter: { type: 'highpass', f0: 2500 }, out });
    this.tone({ type: 'triangle', f0: 230 * p, f1: 85, dur: 0.14, gain: 0.8, out });
    this.noise({ dur: 0.1, gain: 0.6, filter: { type: 'bandpass', f0: 900 * p, f1: 450, q: 1 }, out });
    this.tone({ f0: 70, f1: 40, dur: 0.18, gain: 0.5, out });
  }

  // Pickaxe on stone / ore / crystal
  playMineHit(kind = 'stone', pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.25 });
    const p = jitter(1, 0.08);
    this.noise({ dur: 0.01, gain: 0.8, filter: { type: 'highpass', f0: 3500 }, out });
    this.tone({ f0: 140 * p, f1: 55, dur: 0.16, gain: 0.8, out });
    this.noise({ dur: 0.09, gain: 0.5, filter: { type: 'bandpass', f0: 1900 * p, f1: 800, q: 1.4 }, out });
    if (kind === 'iron') {
      [1050, 1620, 2450].forEach((f, i) => this.tone({ f0: f * p, dur: 0.4 - i * 0.1, gain: 0.3 / (i + 1), out }));
    } else if (kind === 'crystal') {
      [2300, 3100, 4600].forEach((f, i) => this.tone({ f0: f * p, dur: 0.7 - i * 0.15, gain: 0.2 / (i + 1), out, delay: i * 0.012 }));
      this.noise({ dur: 0.25, gain: 0.1, filter: { type: 'highpass', f0: 6000 }, out, delay: 0.03 });
    } else {
      this.tone({ f0: 880 * p, f1: 420, dur: 0.06, gain: 0.2, out });
    }
  }

  playMineBreak(kind = 'stone', pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.4 });
    this.tone({ f0: 90, f1: 32, dur: 0.5, gain: 0.9, out });
    this.noise({ dur: 0.5, gain: 0.7, filter: { type: 'lowpass', f0: 2200, f1: 200 }, out });
    for (let i = 0; i < 9; i++) {
      this.noise({ dur: rnd(0.03, 0.07), gain: rnd(0.2, 0.45), filter: { type: 'bandpass', f0: rnd(600, 2800), q: 2 }, out, delay: 0.05 + i * rnd(0.04, 0.09) });
    }
    if (kind === 'crystal') {
      [1800, 2700, 3600, 5200].forEach((f, i) => this.tone({ f0: f, dur: 0.9, gain: 0.12, out, delay: i * 0.03 }));
    }
  }

  playTreeFall(pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.35, gain: 1 });
    // Fibres tearing: modulated noise creak, then a crack
    const creak = this.noise({ dur: 1.3, gain: 0.35, attack: 0.15, filter: { type: 'bandpass', f0: 380, f1: 240, q: 7 }, out, pink: true });
    this.tone({ type: 'sawtooth', f0: 95, f1: 62, dur: 1.2, gain: 0.07, attack: 0.3, out });
    for (let i = 0; i < 4; i++) {
      this.noise({ dur: 0.05, gain: rnd(0.4, 0.8), filter: { type: 'bandpass', f0: rnd(1200, 2600), q: 1.5 }, out, delay: 0.2 + i * rnd(0.12, 0.25) });
    }
    // Rustle of branches and the crash itself
    this.noise({ dur: 1.0, gain: 0.25, attack: 0.3, filter: { type: 'highpass', f0: 3000 }, out, delay: 0.7, pink: true });
    this.tone({ f0: 70, f1: 26, dur: 0.8, gain: 1.2, out, delay: 1.3 });
    this.noise({ dur: 0.5, gain: 0.8, filter: { type: 'lowpass', f0: 500, f1: 90 }, out, delay: 1.3 });
    return creak;
  }

  playBuildSnap() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.08 });
    const p = jitter(1, 0.06);
    this.tone({ type: 'triangle', f0: 200 * p, f1: 95, dur: 0.12, gain: 0.7, out });
    this.noise({ dur: 0.05, gain: 0.5, filter: { type: 'bandpass', f0: 1000 * p, q: 1.2 }, out });
    this.noise({ dur: 0.02, gain: 0.35, filter: { type: 'highpass', f0: 3000 }, out, delay: 0.09 });
    this.tone({ f0: 160 * p, f1: 80, dur: 0.1, gain: 0.4, out, delay: 0.1 });
  }

  playDismantle() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.1 });
    for (let i = 0; i < 4; i++) {
      this.tone({ type: 'triangle', f0: rnd(150, 260), f1: 70, dur: 0.09, gain: 0.5, out, delay: i * 0.07 });
      this.noise({ dur: 0.05, gain: 0.4, filter: { type: 'bandpass', f0: rnd(700, 1400), q: 1 }, out, delay: i * 0.07 });
    }
  }

  playPickup() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.1, gain: 0.8 });
    this.tone({ f0: 660, f1: 990, dur: 0.1, gain: 0.25, out });
    this.tone({ f0: 990, f1: 1320, dur: 0.14, gain: 0.2, out, delay: 0.06 });
    this.noise({ dur: 0.04, gain: 0.12, filter: { type: 'highpass', f0: 4000 }, out });
  }

  playHarvest() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.06 });
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 0.12, gain: 0.25, attack: 0.02, filter: { type: 'bandpass', f0: rnd(2500, 4500), q: 0.8 }, out, delay: i * 0.08, pink: true });
    }
    this.playPickup();
  }

  playDoorSound(isOpen = true) {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.18 });
    // Hinge creak: narrow band sweeping through noise
    this.noise({
      dur: 0.45, gain: 0.3, attack: 0.05,
      filter: { type: 'bandpass', f0: isOpen ? 500 : 900, f1: isOpen ? 950 : 480, q: 9 }, out, pink: true
    });
    this.tone({ type: 'sawtooth', f0: isOpen ? 120 : 160, f1: isOpen ? 170 : 105, dur: 0.4, gain: 0.04, attack: 0.08, out });
    // Latch / thud when it finishes moving
    this.tone({ f0: 120, f1: 55, dur: 0.14, gain: 0.7, out, delay: 0.38 });
    this.mechClack(out, 0.36, 0.5, 0.7);
  }

  // Soft mechanical tick for UI and generic interaction feedback
  playMechanicalClick(pitch = 1.0) {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.03, gain: 0.7 });
    this.noise({ dur: 0.012, gain: 0.35, filter: { type: 'bandpass', f0: 2600 * pitch, q: 2 }, out });
    this.tone({ type: 'triangle', f0: 900 * pitch, f1: 420 * pitch, dur: 0.05, gain: 0.18, out });
  }

  playHitMarker(isHeadshot = false) {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.05, gain: 0.85 });
    this.noise({ dur: 0.01, gain: 0.5, filter: { type: 'highpass', f0: 4000 }, out });
    if (isHeadshot) {
      this.tone({ f0: 2600, dur: 0.22, gain: 0.3, out });
      this.tone({ f0: 3900, dur: 0.16, gain: 0.18, out, delay: 0.01 });
      this.tone({ f0: 1300, f1: 900, dur: 0.1, gain: 0.25, type: 'triangle', out });
    } else {
      this.tone({ f0: 1700, f1: 1000, dur: 0.07, gain: 0.3, out });
      this.tone({ f0: 600, f1: 300, dur: 0.06, gain: 0.25, type: 'triangle', out });
    }
  }

  playPlayerHurt(amount = 10) {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.1 });
    const k = clamp(amount / 30, 0.4, 1.2);
    this.tone({ f0: 95, f1: 38, dur: 0.28, gain: 0.9 * k, out });
    this.noise({ dur: 0.18, gain: 0.35 * k, filter: { type: 'lowpass', f0: 1400, f1: 300 }, out });
    this.tone({ type: 'sawtooth', f0: 210, f1: 120, dur: 0.22, gain: 0.07 * k, out, delay: 0.03 });
  }

  // ---------- water ----------

  playSplash(volume = 0.7, pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.12, gain: clamp(volume, 0.2, 1.2) });
    const p = jitter(1, 0.12);
    this.noise({ dur: 0.45, gain: 0.7, attack: 0.012, filter: { type: 'bandpass', f0: 1800 * p, f1: 420, q: 0.7 }, out, decay: 1.2 });
    this.tone({ f0: 300 * p, f1: 80, dur: 0.18, gain: 0.55, out });
    for (let i = 0; i < 4; i++) {
      this.tone({ f0: rnd(500, 1400), f1: rnd(250, 700), dur: 0.06, gain: 0.1, out, delay: 0.1 + i * rnd(0.05, 0.12) });
    }
  }

  playSwimStroke() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.05, gain: 0.7 });
    this.noise({ dur: 0.4, gain: 0.32, attack: 0.1, filter: { type: 'bandpass', f0: 500, f1: 1300, q: 0.8 }, out, pink: true });
    this.tone({ f0: rnd(200, 280), f1: 90, dur: 0.12, gain: 0.2, out, delay: 0.12 });
  }

  // ---------- movement ----------

  // surface: grass | dirt | sand | rock | wood | snow | water. intensity scales volume (crouch/sprint)
  playFootstep(surface = 'grass', intensity = 1) {
    if (!this.ctx) return;
    this.stepAlt = !this.stepAlt;
    const out = this.bus(null, { rev: 0.04, gain: 0.55 * intensity });
    const p = jitter(1, 0.15) * (this.stepAlt ? 1 : 0.93);
    switch (surface) {
      case 'wood':
        this.tone({ type: 'triangle', f0: 190 * p, f1: 100, dur: 0.1, gain: 0.55, out });
        this.noise({ dur: 0.05, gain: 0.3, filter: { type: 'bandpass', f0: 1000 * p, q: 1 }, out });
        break;
      case 'rock':
        this.noise({ dur: 0.03, gain: 0.5, filter: { type: 'highpass', f0: 1800 }, out });
        this.tone({ f0: 160 * p, f1: 80, dur: 0.07, gain: 0.35, out });
        break;
      case 'sand':
        this.noise({ dur: 0.12, gain: 0.35, attack: 0.012, filter: { type: 'bandpass', f0: 1700 * p, q: 0.6 }, out, pink: true });
        this.noise({ dur: 0.06, gain: 0.2, filter: { type: 'lowpass', f0: 500 }, out });
        break;
      case 'snow':
        this.noise({ dur: 0.16, gain: 0.35, attack: 0.02, filter: { type: 'bandpass', f0: 2600 * p, q: 0.7 }, out, pink: true });
        break;
      case 'water':
        this.noise({ dur: 0.18, gain: 0.45, attack: 0.01, filter: { type: 'bandpass', f0: 1100 * p, f1: 500, q: 0.8 }, out });
        this.tone({ f0: 280 * p, f1: 120, dur: 0.07, gain: 0.15, out });
        break;
      case 'dirt':
        this.noise({ dur: 0.07, gain: 0.45, filter: { type: 'lowpass', f0: 650 * p }, out });
        this.tone({ f0: 100 * p, f1: 55, dur: 0.07, gain: 0.3, out });
        break;
      default: // grass
        this.noise({ dur: 0.1, gain: 0.4, attack: 0.01, filter: { type: 'bandpass', f0: 2200 * p, q: 0.5 }, out, pink: true });
        this.noise({ dur: 0.07, gain: 0.35, filter: { type: 'lowpass', f0: 420 * p }, out });
    }
  }

  // ---------- survival ----------

  playSizzle() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.05, gain: 0.7 });
    this.noise({ dur: 0.9, gain: 0.22, attack: 0.05, filter: { type: 'highpass', f0: 4500 }, out });
    for (let i = 0; i < 9; i++) {
      this.noise({ dur: 0.02, gain: rnd(0.2, 0.45), filter: { type: 'highpass', f0: 3000 }, out, delay: Math.random() * 0.9 });
    }
  }

  playEatSound() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.04, gain: 0.8 });
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 0.07, gain: 0.45, filter: { type: 'bandpass', f0: rnd(1800, 3200), q: 1.2 }, out, delay: i * 0.13 });
      this.tone({ f0: 200, f1: 110, dur: 0.05, gain: 0.2, out, delay: i * 0.13 });
    }
    this.tone({ f0: 320, f1: 110, dur: 0.22, gain: 0.35, out, delay: 0.5 });
  }

  playRestedChime() {
    if (!this.ctx) return;
    const out = this.bus(null, { rev: 0.7, gain: 0.8 });
    [261.6, 329.6, 392, 523.3].forEach((f, i) => {
      this.tone({ f0: f, dur: 2.2, gain: 0.14, attack: 0.12, out, delay: i * 0.12 });
      this.tone({ type: 'triangle', f0: f * 2, dur: 1.4, gain: 0.04, attack: 0.1, out, delay: i * 0.12 });
    });
  }

  // ---------- creatures & alarms ----------

  // Vocal growl: harmonic source through two formant filters with wobble and grit
  playMonsterGrowl(isBrute = false, pos = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.bus(pos, { rev: isBrute ? 0.45 : 0.28, gain: isBrute ? 1.1 : 0.85 });
    const dur = isBrute ? 1.3 : 0.7;
    const f0 = isBrute ? 52 : jitter(135, 0.15);

    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 1.25, t);
    src.frequency.exponentialRampToValueAtTime(f0, t + dur * 0.25);
    src.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);

    const vib = ctx.createOscillator();
    vib.frequency.value = isBrute ? 11 : 24;
    const vibGain = ctx.createGain();
    vibGain.gain.value = f0 * 0.06;
    vib.connect(vibGain);
    vibGain.connect(src.frequency);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;

    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 4;
    f1.frequency.setValueAtTime(isBrute ? 300 : 650, t);
    f1.frequency.linearRampToValueAtTime(isBrute ? 220 : 480, t + dur);
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 5;
    f2.frequency.value = isBrute ? 700 : 1250;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(isBrute ? 1.0 : 0.8, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(shaper);
    shaper.connect(f1);
    shaper.connect(f2);
    f1.connect(g);
    f2.connect(g);
    g.connect(out);
    src.start(t);
    vib.start(t);
    src.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);

    // Breath and spit
    this.noise({ dur: dur * 0.8, gain: 0.3, attack: 0.05, filter: { type: 'bandpass', f0: 1800, q: 0.6 }, out, pink: true });
    if (isBrute) this.tone({ f0: 38, f1: 28, dur: 1.0, gain: 0.6, out, attack: 0.1 });
  }

  // Enemy spotted-you radio chirp
  playAlert(pos = null) {
    if (!this.ctx) return;
    const out = this.bus(pos, { rev: 0.1, gain: 0.8 });
    this.noise({ dur: 0.1, gain: 0.35, filter: { type: 'bandpass', f0: 2400, q: 1.5 }, out });
    this.tone({ type: 'square', f0: 1500, dur: 0.07, gain: 0.07, out, delay: 0.1 });
    this.tone({ type: 'square', f0: 1100, dur: 0.07, gain: 0.07, out, delay: 0.19 });
    this.noise({ dur: 0.08, gain: 0.25, filter: { type: 'bandpass', f0: 2000, q: 1.5 }, out, delay: 0.3 });
  }

  // War horn: two detuned saws through a slowly opening low-pass
  playRaidAlarm() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.bus(null, { rev: 0.8, gain: 0.9 });
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 2;
    filt.frequency.setValueAtTime(220, t);
    filt.frequency.linearRampToValueAtTime(900, t + 1.2);
    filt.frequency.linearRampToValueAtTime(300, t + 3.2);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.5);
    g.gain.setValueAtTime(0.8, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    filt.connect(g);
    g.connect(out);

    for (const detune of [-9, 0, 11]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(110, t);
      o.frequency.linearRampToValueAtTime(130.8, t + 1.0);
      o.frequency.linearRampToValueAtTime(98, t + 3.2);
      o.connect(filt);
      o.start(t);
      o.stop(t + 3.5);
    }
    this.tone({ f0: 55, dur: 3.2, gain: 0.35, attack: 0.5, out });
  }

  // ---------- ambience ----------

  initAmbience() {
    const ctx = this.ctx;
    const loop = (buffer, nodes) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      let n = src;
      for (const node of nodes) {
        n.connect(node);
        n = node;
      }
      src.start(0, Math.random() * 2);
      return n;
    };
    const filter = (type, f, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const lfo = (rate, depth, target) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(target);
      o.start();
    };

    // Wind: pink noise through a drifting band-pass
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const windBand = filter('bandpass', 380, 0.5);
    loop(this.pink, [windBand, this.windGain]);
    this.windGain.connect(this.ambBus);
    lfo(0.07, 140, windBand.frequency);
    lfo(0.11, 0.03, this.windGain.gain);

    // Rain: broadband hiss
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    loop(this.pink, [filter('highpass', 600), filter('lowpass', 8500), this.rainGain]);
    this.rainGain.connect(this.ambBus);

    // Crickets: narrow noise band gated by a fast oscillator
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    lfo(29, 0.5, gate.gain);
    loop(this.white, [filter('bandpass', 4400, 14), gate, this.cricketGain]);
    this.cricketGain.connect(this.ambBus);

    // Shoreline lapping
    this.lapGain = ctx.createGain();
    this.lapGain.gain.value = 0;
    const lapMod = ctx.createGain();
    lapMod.gain.value = 0.5;
    lfo(0.16, 0.45, lapMod.gain);
    loop(this.pink, [filter('lowpass', 700), lapMod, this.lapGain]);
    this.lapGain.connect(this.ambBus);

    // Underwater rumble
    this.underGain = ctx.createGain();
    this.underGain.gain.value = 0;
    loop(this.pink, [filter('lowpass', 220), this.underGain]);
    this.underGain.connect(this.ambBus);
  }

  // env: { isNight, rain, altitude(0..1), shore(0..1), hpFrac, fire:{pos,dist}|null }
  update(dt, env) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const under = this.isUnderwater;

    const wind = (0.1 + env.altitude * 0.45 + env.rain * 0.25) * (under ? 0.1 : 1);
    this.windGain.gain.setTargetAtTime(wind, now, 1.2);
    this.rainGain.gain.setTargetAtTime(env.rain * 0.28 * (under ? 0.05 : 1), now, 1.0);
    this.cricketGain.gain.setTargetAtTime(env.isNight && env.rain < 0.2 && !under ? 0.045 : 0, now, 2.0);
    this.lapGain.gain.setTargetAtTime(env.shore * 0.3 * (under ? 0 : 1), now, 1.0);

    const T = this.timers;

    // Birdsong by day
    T.bird -= dt;
    if (T.bird <= 0) {
      T.bird = rnd(2.5, 8);
      if (!env.isNight && env.rain < 0.3 && !under && env.altitude < 0.6) this.playBird();
    }

    // Owl / distant call at night
    T.drip -= dt;
    if (T.drip <= 0) {
      T.drip = rnd(14, 30);
      if (env.isNight && !under && env.rain < 0.3) this.playOwl();
    }

    // Low-health heartbeat
    if (env.hpFrac < 0.35 && !under) {
      T.heart -= dt;
      if (T.heart <= 0) {
        T.heart = 0.55 + env.hpFrac * 1.1;
        const out = this.bus(null, { rev: 0.02, gain: 0.7 * (1 - env.hpFrac * 2) });
        this.tone({ f0: 62, f1: 38, dur: 0.16, gain: 0.8, out });
        this.tone({ f0: 58, f1: 36, dur: 0.14, gain: 0.55, out, delay: 0.17 });
      }
    }

    // Campfire crackle with random pops
    if (env.fire && env.fire.dist < 22) {
      T.fire -= dt;
      if (T.fire <= 0) {
        T.fire = rnd(0.05, 0.35);
        const out = this.bus(env.fire.pos, { rev: 0.04, gain: 0.5 });
        this.noise({ dur: rnd(0.01, 0.04), gain: rnd(0.15, 0.5), filter: { type: 'bandpass', f0: rnd(1500, 5000), q: 1.5 }, out });
        if (Math.random() < 0.3) this.tone({ f0: rnd(90, 160), f1: 50, dur: 0.05, gain: 0.25, out });
      }
    }
  }

  playBird() {
    const angle = Math.random() * Math.PI * 2;
    const r = rnd(18, 55);
    const pos = { x: this.listener.x + Math.cos(angle) * r, y: this.listener.y + rnd(2, 12), z: this.listener.z + Math.sin(angle) * r };
    const out = this.bus(pos, { rev: 0.2, gain: 0.55 });
    const base = rnd(2300, 4200);
    const notes = Math.floor(rnd(2, 6));
    const style = Math.random();
    for (let i = 0; i < notes; i++) {
      const d = i * (style < 0.5 ? 0.11 : 0.17);
      if (style < 0.5) {
        this.tone({ f0: base * rnd(0.9, 1.1), f1: base * rnd(1.15, 1.5), dur: 0.08, gain: 0.18, out, delay: d });
      } else {
        this.tone({ f0: base * 1.3, f1: base * 0.8, dur: 0.14, gain: 0.16, out, delay: d });
        this.tone({ f0: base * 2.6, f1: base * 1.6, dur: 0.1, gain: 0.04, out, delay: d });
      }
    }
  }

  playOwl() {
    const angle = Math.random() * Math.PI * 2;
    const pos = { x: this.listener.x + Math.cos(angle) * 70, y: this.listener.y + 8, z: this.listener.z + Math.sin(angle) * 70 };
    const out = this.bus(pos, { rev: 0.7, gain: 0.7 });
    this.tone({ f0: 380, f1: 320, dur: 0.5, gain: 0.25, attack: 0.08, out });
    this.tone({ f0: 360, f1: 290, dur: 0.7, gain: 0.25, attack: 0.08, out, delay: 0.65 });
  }
}

export const sounds = new SoundEngine();

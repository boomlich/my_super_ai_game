// ZONE ZERO: Tactical Web Audio Synthesizer (Enhanced with Underwater Filter & Water Audio)
// Completely self-contained procedural audio engine with zero external sound dependencies

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.underwaterFilter = null;
    this.ambientGain = null;
    this.sfxGain = null;
    this.isMuted = false;
    this.initialized = false;
    this.isUnderwater = false;
  }

  init() {
    if (this.initialized) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();

    this.underwaterFilter = this.ctx.createBiquadFilter();
    this.underwaterFilter.type = 'lowpass';
    this.underwaterFilter.frequency.setValueAtTime(20000, this.ctx.currentTime);
    this.underwaterFilter.connect(this.ctx.destination);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.75, this.ctx.currentTime);
    this.masterGain.connect(this.underwaterFilter);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this.sfxGain.connect(this.masterGain);

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    this.ambientGain.connect(this.masterGain);

    this.startAmbientLoop();
    this.initialized = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setUnderwater(isUnder) {
    if (!this.ctx || !this.underwaterFilter || this.isUnderwater === isUnder) return;
    this.isUnderwater = isUnder;
    const now = this.ctx.currentTime;
    const targetFreq = isUnder ? 420 : 20000;
    this.underwaterFilter.frequency.setTargetAtTime(targetFreq, now, 0.08);
  }

  createNoiseBuffer(duration = 1.0) {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // Water Splash Sound
  playSplash(volume = 0.7) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.35);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    const gulp = this.ctx.createOscillator();
    gulp.type = 'sine';
    gulp.frequency.setValueAtTime(220, now);
    gulp.frequency.exponentialRampToValueAtTime(70, now + 0.25);

    const gGain = this.ctx.createGain();
    gGain.gain.setValueAtTime(volume * 0.7, now);
    gGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    gulp.connect(gGain);
    gGain.connect(this.sfxGain);

    noise.start(now);
    gulp.start(now);
    noise.stop(now + 0.35);
    gulp.stop(now + 0.35);
  }

  // Swimming stroke paddle
  playSwimStroke() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.2);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(550, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(now);
    noise.stop(now + 0.2);
  }

  // M4A1 Assault Rifle Gunshot
  playRifleShot() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.18);
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(3200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(800, now + 0.15);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(1.0, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);

    noise.start(now);
    osc.start(now);
    noise.stop(now + 0.18);
    osc.stop(now + 0.18);
  }

  // Shotgun blast
  playShotgunShot() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.35);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.25);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(1.2, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    sub.connect(subGain);
    subGain.connect(this.sfxGain);

    noise.start(now);
    sub.start(now);
    noise.stop(now + 0.35);
    sub.stop(now + 0.35);

    setTimeout(() => { this.playMechanicalClick(1.2); }, 380);
  }

  // Sniper Rifle Heavy Blast
  playSniperShot() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.65);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(4500, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.58);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    const sub = this.ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(95, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 0.45);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(1.4, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    sub.connect(subGain);
    subGain.connect(this.sfxGain);

    noise.start(now);
    sub.start(now);
    noise.stop(now + 0.65);
    sub.stop(now + 0.65);
  }

  // Frag Grenade Explosion
  playExplosion() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const boom = this.ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(140, now);
    boom.frequency.exponentialRampToValueAtTime(20, now + 0.8);

    const boomGain = this.ctx.createGain();
    boomGain.gain.setValueAtTime(1.8, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    boom.connect(boomGain);
    boomGain.connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 1.0);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(1.2);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 1.1);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(1.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 1.25);
  }

  // Grenade pin pull / throw
  playPinPull() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(1600, now + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Tactical Axe Swing & Wood Chop
  playAxeChop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.12);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(850, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.95, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.12);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.75, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noise.connect(nGain);
    nGain.connect(this.sfxGain);

    osc.start(now);
    noise.start(now);
    osc.stop(now + 0.15);
    noise.stop(now + 0.15);
  }

  // Tree Falling Creak & Ground Crash
  playTreeFall() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const creak = this.ctx.createOscillator();
    creak.type = 'sawtooth';
    creak.frequency.setValueAtTime(150, now);
    creak.frequency.linearRampToValueAtTime(75, now + 1.2);

    const creakGain = this.ctx.createGain();
    creakGain.gain.setValueAtTime(0.45, now);
    creakGain.gain.exponentialRampToValueAtTime(0.01, now + 1.4);

    creak.connect(creakGain);
    creakGain.connect(this.sfxGain);
    creak.start(now);
    creak.stop(now + 1.5);

    setTimeout(() => {
      if (!this.ctx) return;
      const thudTime = this.ctx.currentTime;
      const thud = this.ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(100, thudTime);
      thud.frequency.exponentialRampToValueAtTime(25, thudTime + 0.55);

      const tGain = this.ctx.createGain();
      tGain.gain.setValueAtTime(1.5, thudTime);
      tGain.gain.exponentialRampToValueAtTime(0.001, thudTime + 0.6);

      thud.connect(tGain);
      tGain.connect(this.sfxGain);
      thud.start(thudTime);
      thud.stop(thudTime + 0.65);
    }, 1350);
  }

  // Sizzling Campfire Cooking
  playSizzle() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.8);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3500, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.8);
  }

  // Door Open / Close Hinge Sound
  playDoorSound(isOpen = true) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(isOpen ? 220 : 340, now);
    osc.frequency.exponentialRampToValueAtTime(isOpen ? 480 : 160, now + 0.18);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // Mechanical Click / Reload
  playMechanicalClick(pitch = 1.0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(400 * pitch, now + 0.05);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  // Hit Marker Sound
  playHitMarker(isHeadshot = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = isHeadshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isHeadshot ? 2200 : 1300, now);
    osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 2800 : 900, now + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isHeadshot ? 0.5 : 0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Valheim Food Eating Sound
  playEatSound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const n1 = this.ctx.createBufferSource();
    n1.buffer = this.createNoiseBuffer(0.12);
    const g1 = this.ctx.createGain();
    g1.gain.setValueAtTime(0.65, now);
    g1.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    n1.connect(g1);
    g1.connect(this.sfxGain);
    n1.start(now);
    n1.stop(now + 0.12);

    setTimeout(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.2);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.25);
    }, 140);
  }

  // Rested / Comfort Gained Chime
  playRestedChime() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freqs = [330, 440, 554, 660, 880];

    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.05);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now + idx * 0.05);
      gain.gain.linearRampToValueAtTime(0.25, now + idx * 0.05 + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + idx * 0.05);
      osc.stop(now + 1.9);
    });
  }

  // Construction Snapping Sound
  playBuildSnap() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Valheim-Style Raid Horn
  playRaidAlarm() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const horn = this.ctx.createOscillator();
    horn.type = 'sawtooth';
    horn.frequency.setValueAtTime(110, now);
    horn.frequency.linearRampToValueAtTime(146.8, now + 0.8);
    horn.frequency.linearRampToValueAtTime(110, now + 2.5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

    horn.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    horn.start(now);
    horn.stop(now + 3.2);
  }

  // Creature Growl
  playMonsterGrowl(isBrute = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = isBrute ? 'sawtooth' : 'triangle';
    const baseFreq = isBrute ? 65 : 180;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.7, now + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  // Footstep Sound
  playFootstep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(0.08);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(now);
    noise.stop(now + 0.08);
  }

  startAmbientLoop() {
    if (!this.ctx) return;

    const bufferSize = this.ctx.sampleRate * 4;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const windSource = this.ctx.createBufferSource();
    windSource.buffer = noiseBuffer;
    windSource.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(250, this.ctx.currentTime);

    windSource.connect(windFilter);
    windFilter.connect(this.ambientGain);
    windSource.start();

    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.15, this.ctx.currentTime);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(100, this.ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    lfo.start();
  }
}

export const sounds = new SoundEngine();

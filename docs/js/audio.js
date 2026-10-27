// FFT -> 3 bands -> level in dB -> slow moving average / recent peak -> 0..1 -> attack/release.
// Working in dB against the sound's own average makes it independent of the mic gain: a laptop
// mic delivers a tiny signal, and a fixed linear threshold left the visuals almost flat.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.speaker = null;
    this.source = null;
    this.stream = null;
    this.audioEl = null;
    this.demoTimer = null;
    this.demoNodes = [];
    this.features = { bass: 0, mid: 0, high: 0, kick: 0 };
    this.floorDb = [0, 0, 0];
    this.peakDb = [0, 0, 0];
    this.avgDb = [0, 0, 0];
    this.primed = false;
    this.env = [0, 0, 0];
    this.kick = 0;
    this.bassAvgDb = -100;
    this.release = 0.88;
    this.sens = 1.4;      // user sensitivity (>1 reacts to quieter sound)
    this.bassDb = -100;   // for the on-screen level readout
  }

  // Must run synchronously inside a user gesture (iOS Safari).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.25;
    this.analyser.minDecibels = -120;
    this.analyser.maxDecibels = 0;
    this.speaker = this.ctx.createGain();
    this.speaker.gain.value = 0;
    this.analyser.connect(this.speaker);
    this.speaker.connect(this.ctx.destination);
    const n = this.analyser.frequencyBinCount;
    this.db = new Float32Array(n);
    this.spec = new Float32Array(n);
    this.ctx.resume();
  }

  resetLevels() { this.primed = false; this.kick = 0; this.bassAvgDb = -100; }

  stopSource() {
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
    for (const n of this.demoNodes) { try { n.stop?.(); n.disconnect(); } catch { /* already stopped */ } }
    this.demoNodes = [];
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.removeAttribute('src'); this.audioEl.load(); this.audioEl = null; }
    this.resetLevels();
  }

  async useMic() {
    this.init();
    await this.ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stopSource();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.speaker.gain.value = 0; // never play the mic back: feedback
  }

  async useFile(file) {
    this.init();
    await this.ctx.resume();
    this.stopSource();
    const el = new Audio();
    el.src = URL.createObjectURL(file);
    el.loop = true;
    el.playsInline = true;
    this.audioEl = el;
    this.source = this.ctx.createMediaElementSource(el);
    this.source.connect(this.analyser);
    this.speaker.gain.value = 1;
    await el.play();
  }

  // Synthetic beat (kick / pad / hats) so the visuals can be tried without a mic or a file.
  useDemo() {
    this.init();
    this.ctx.resume();
    this.stopSource();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.analyser);
    this.demoNodes.push(out);

    const pad = ctx.createOscillator();
    const padGain = ctx.createGain();
    pad.type = 'sawtooth'; pad.frequency.value = 330; padGain.gain.value = 0.05;
    const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.4; lfoGain.gain.value = 120;
    lfo.connect(lfoGain); lfoGain.connect(pad.frequency);
    pad.connect(padGain); padGain.connect(out);
    pad.start(); lfo.start();
    this.demoNodes.push(pad, lfo);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    let next = ctx.currentTime + 0.1;
    let step = 0;
    const beat = 0.25;
    const schedule = () => {
      while (next < ctx.currentTime + 0.4) {
        if (step % 2 === 0) { // kick
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.setValueAtTime(140, next);
          o.frequency.exponentialRampToValueAtTime(48, next + 0.15);
          g.gain.setValueAtTime(0.9, next);
          g.gain.exponentialRampToValueAtTime(0.001, next + 0.3);
          o.connect(g); g.connect(out); o.start(next); o.stop(next + 0.32);
        }
        if (step % 2 === 1) { // hi-hat
          const s = ctx.createBufferSource(); const hp = ctx.createBiquadFilter(); const g = ctx.createGain();
          s.buffer = noise; hp.type = 'highpass'; hp.frequency.value = 7000;
          g.gain.setValueAtTime(0.25, next);
          g.gain.exponentialRampToValueAtTime(0.001, next + 0.06);
          s.connect(hp); hp.connect(g); g.connect(out); s.start(next); s.stop(next + 0.08);
        }
        next += beat; step++;
      }
    };
    schedule();
    this.demoTimer = setInterval(schedule, 100);
    this.speaker.gain.value = 0.5;
  }

  update(dt = 1 / 60) {
    if (!this.analyser) return this.features;
    const k = dt * 60; // frame-rate independent smoothing (everything below was tuned at 60 fps)
    this.analyser.getFloatFrequencyData(this.db);
    const n = this.db.length;
    for (let i = 0; i < n; i++) this.spec[i] = Number.isFinite(this.db[i]) ? 10 ** (this.db[i] / 20) : 0;
    const hz = this.ctx.sampleRate / 2 / n;

    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz));
      const b = Math.min(n - 1, Math.floor(hi / hz));
      if (b < a) return 0;
      let s = 0;
      for (let i = a; i <= b; i++) s += this.spec[i];
      return s / (b - a + 1);
    };
    const raw = [band(20, 250), band(250, 4000), band(4000, 16000)];
    const levels = raw.map((r) => 20 * Math.log10(r + 1e-9));
    this.bassDb = levels[0];

    if (!this.primed) {
      for (let i = 0; i < 3; i++) { this.floorDb[i] = levels[i]; this.peakDb[i] = levels[i]; this.avgDb[i] = levels[i]; }
      this.bassAvgDb = levels[0];
      this.primed = true;
    }

    for (let i = 0; i < 3; i++) {
      const L = levels[i];
      // reference = slow moving average of the level; what animates the figure is how far the
      // sound rises above its usual level, scaled by the recent peak. Steady sound gives a soft
      // baseline glow; beats and transients pop. Independent of mic gain.
      this.avgDb[i] += (L - this.avgDb[i]) * (1 - 0.97 ** k);
      this.peakDb[i] = Math.max(L, this.peakDb[i] - 0.12 * k);
      this.floorDb[i] = Math.min(L, this.floorDb[i] + 0.03 * k); // quietest recent level (for onsets)
      const range = Math.max(10, this.peakDb[i] - this.avgDb[i]);
      const v = clamp(((L - this.avgDb[i]) / range + 0.15) * this.sens, 0, 1);
      this.env[i] = v > this.env[i] ? v : v + (this.env[i] - v) * this.release ** k;
    }

    // onset: bass level jumps well above its recent average
    const Lb = levels[0];
    this.bassAvgDb += (Lb - this.bassAvgDb) * (1 - 0.92 ** k);
    const onset = Lb - this.bassAvgDb > 4.5 && Lb > this.floorDb[0] + 8;
    this.kick = onset ? 1 : this.kick * 0.9 ** k;

    const f = this.features;
    f.bass = this.env[0]; f.mid = this.env[1]; f.high = this.env[2]; f.kick = this.kick;
    return f;
  }
}

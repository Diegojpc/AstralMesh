import * as THREE from './vendor/three.module.min.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- parameters

const params = { expand: 0.35, twist: 1.5, speed: 1, deform: 0.5, density: 4 };

// rainbow: colour comes from a hue ramp over the shape's depth instead of the A/B pair
const PALETTES = [
  { name: 'Magenta / Verde', a: [1.0, 0.0, 0.8], b: [0.1, 1.0, 0.3] },
  { name: 'Magenta / Cian', a: [1.0, 0.1, 0.75], b: [0.0, 0.9, 1.0] },
  { name: 'Rosa eléctrico', a: [1.0, 0.1, 0.5], b: [0.9, 0.2, 1.0] },
  { name: 'Verde tóxico / Cian', a: [0.2, 1.0, 0.4], b: [0.0, 0.9, 1.0] },
  { name: 'Arcoíris neón', a: [1, 1, 1], b: [1, 1, 1], rainbow: true },
  { name: 'Tinta blanca', a: [1.0, 1.0, 1.0], b: [0.55, 0.85, 1.0] },
];

// ---------------------------------------------------------------- audio engine
// FFT -> 3 bands -> level in dB -> adaptive noise floor / peak -> 0..1 -> attack/release.
// Working in dB with a tracked floor makes it independent of the mic gain: a laptop mic
// delivers a tiny signal, and a fixed linear threshold left the visuals almost flat.

class AudioEngine {
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

// ---------------------------------------------------------------- geometry
// Generators return line segments (pairs of vertices) with per-vertex depth (0..1) and a node id.
// 'upright' shapes are 3D creatures that stand on the ground; 'facing' shapes are flat in the
// local XZ plane and are tilted to face the viewer.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Lines {
  constructor() { this.pos = []; this.depth = []; this.node = []; this.id = 0; }
  seg(a, b, da, db, id = this.id) { this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); this.depth.push(da, db); this.node.push(id, id); }
  next() { this.id++; }
  out() { return { pos: this.pos, depth: this.depth, node: this.node }; }
}

const GOLDEN = 2.39996323;

function radialMandala(density) {
  const levels = clamp(density, 2, 6);
  const L = new Lines();
  const rec = (ox, oz, angle, len, level) => {
    if (level >= levels) return;
    const d = level / (levels - 1);
    const ex = ox + Math.cos(angle) * len;
    const ez = oz + Math.sin(angle) * len;
    L.seg([ox, 0, oz], [ex, 0, ez], d, d); L.next();
    for (const s of [-1, 1]) rec(ex, ez, angle + (s * Math.PI) / 5, len * 0.58, level + 1);
  };
  for (let k = 0; k < 12; k++) rec(0, 0, (k * TAU) / 12, 0.25, 0);
  return L.out();
}

function sierpinski(density) {
  const levels = clamp(density, 1, 5);
  const L = new Lines();
  const k = 0.8165;
  const corners = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const tetra = (cx, cy, cz, s, level) => {
    if (level === levels) {
      const v = corners.map((c) => [cx + c[0] * s * k, cy + c[1] * s * k, cz + c[2] * s * k]);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) L.seg(v[i], v[j], 0, 0);
      L.next();
      return;
    }
    for (const c of corners) tetra(cx + c[0] * s * k * 0.5, cy + c[1] * s * k * 0.5, cz + c[2] * s * k * 0.5, s * 0.5, level + 1);
  };
  tetra(0, 0, 0, 0.5, 0);
  return radialDepthFix(L.out());
}

function phyllotaxis(density) {
  const count = clamp(density, 1, 6) * 150;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const r = 0.55 * Math.sqrt(i / count);
    pts.push([Math.cos(i * GOLDEN) * r, 0, Math.sin(i * GOLDEN) * r]);
  }
  const L = new Lines();
  for (let i = 0; i < count; i++) {
    for (const step of [8, 13, 21]) if (i + step < count) { L.seg(pts[i], pts[i + step], 0, 0, i % 21); }
  }
  return radialDepthFix(L.out());
}

// depth = normalized distance from the origin
function radialDepthFix(g) {
  let max = 1e-6;
  const n = g.pos.length / 3;
  const d = new Array(n);
  for (let i = 0; i < n; i++) { d[i] = Math.hypot(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]); max = Math.max(max, d[i]); }
  g.depth = d.map((v) => v / max);
  return g;
}

// Sea urchin: golden-spiral sphere with long forked spines and a thin lattice on the core.
function urchin(density) {
  const rng = mulberry32(11);
  const n = 50 + clamp(density, 2, 6) * 28;
  const r0 = 0.16;
  const L = new Lines();
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - y * y);
    const th = i * GOLDEN;
    dirs.push([Math.cos(th) * rr, y, Math.sin(th) * rr]);
  }
  dirs.forEach((d) => {
    const len = 0.16 + rng() * rng() * 0.5;
    const a = d.map((c) => c * r0);
    const b = d.map((c) => c * (r0 + len));
    L.seg(a, b, 0, 1);
    // forked tip: three short spurs leaning outward
    const m = d.map((c) => c * (r0 + len * 0.78));
    for (let s = 0; s < 3; s++) {
      const ang = (s / 3) * TAU + rng();
      const side = [Math.cos(ang), Math.sin(ang * 1.7), Math.sin(ang)];
      const tip = d.map((c, k) => c * (r0 + len * 1.08) + side[k] * 0.045);
      L.seg(m, tip, 0.85, 1);
    }
    L.next();
  });
  for (let i = 0; i < n; i++) {
    for (const step of [5, 8]) if (i + step < n) L.seg(dirs[i].map((c) => c * r0), dirs[i + step].map((c) => c * r0), 0, 0, i);
  }
  return L.out();
}

// Butterfly: Temple Fay's butterfly curve drawn as nested contour layers plus veins; flaps on bass.
function butterfly(density) {
  const layers = 2 + clamp(density, 2, 6);
  const N = 260;
  const scale = 0.115;
  const L = new Lines();
  const pt = (t) => {
    const r = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) + Math.sin((2 * t - Math.PI) / 24) ** 5;
    return [Math.sin(t) * r, Math.cos(t) * r];
  };
  for (let k = 0; k < layers; k++) {
    const s = scale * (1 - (k / layers) * 0.88);
    const depth = k / (layers - 1);
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const [x, y] = pt((i / N) * 12 * Math.PI);
      const p = [x * s, y * s, k * 0.004];
      if (prev) L.seg(prev, p, depth, depth, k * 100 + Math.floor(i / 5));
      prev = p;
    }
  }
  // veins: from the body outward to the outer contour
  for (let i = 0; i < 60; i++) {
    const [x, y] = pt((i / 60) * 12 * Math.PI);
    L.seg([0, 0, 0], [x * scale, y * scale, 0], 0, 1, 5000 + i);
  }
  return L.out();
}

// Iso-line blob: stacked closed contours of a bilaterally symmetric bulb (Rorschach-like).
function contourBlob(density) {
  const levels = 6 + clamp(density, 2, 6) * 3;
  const N = 72;
  const L = new Lines();
  for (let k = 0; k < levels; k++) {
    const h = (k + 0.5) / levels;
    const bulb = Math.sin(Math.PI * h) ** 0.7;
    const R = 0.04 + 0.46 * bulb;
    const lobe = 0.38 * Math.sin(h * 7) * bulb;
    let prev = null; let first = null;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU;
      // only cosines of the angle from the vertical axis -> mirror symmetric
      const w = 1 + 0.32 * Math.cos(2 * th) + 0.2 * Math.cos(3 * th) + lobe * Math.cos(5 * th) + 0.12 * Math.cos(th);
      const r = R * w;
      const p = [Math.sin(th) * r, (h - 0.5) * 0.95, Math.cos(th) * r * 0.55];
      if (prev) L.seg(prev, p, h, h, k * 8 + (i >> 3)); else first = p;
      prev = p;
    }
    L.seg(prev, first, h, h, k * 8);
  }
  return L.out();
}

// Ink splatter: curved streaks with drops, thrown outward and drooping.
function splatter(density) {
  const rng = mulberry32(5);
  const M = 40 + clamp(density, 2, 6) * 18;
  const L = new Lines();
  for (let i = 0; i < M; i++) {
    const u = rng() * 2 - 1;
    const th = rng() * TAU;
    const rr = Math.sqrt(1 - u * u);
    const dir = [Math.cos(th) * rr, u * 0.7, Math.sin(th) * rr];
    const len = 0.12 + rng() ** 2 * 0.55;
    const segs = 5;
    let prev = [0, 0, 0];
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const p = [dir[0] * len * t, dir[1] * len * t - 0.35 * len * t * t, dir[2] * len * t];
      L.seg(prev, p, (s - 1) / segs, t, i);
      prev = p;
    }
    // drop at the end
    L.seg(prev, [prev[0] + dir[0] * 0.035, prev[1] - 0.02, prev[2] + dir[2] * 0.035], 1, 1, i);
    L.next();
  }
  for (let i = 0; i < 14; i++) {
    const a = [(rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12];
    L.seg([0, 0, 0], a, 0, 0.3, 900 + i);
  }
  return L.out();
}

// Dashed ring with a six-petal rose and a concentric eye.
function ringMandala(density) {
  const L = new Lines();
  const dashes = 36 + clamp(density, 2, 6) * 6;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * TAU;
    const a1 = a0 + (TAU / dashes) * 0.55;
    const R = 0.62;
    L.seg([Math.cos(a0) * R, 0, Math.sin(a0) * R], [Math.cos(a1) * R, 0, Math.sin(a1) * R], 1, 1, i);
  }
  const steps = 160;
  for (const [petals, size, base] of [[3, 0.46, 0.35], [3, 0.3, 0.7]]) {
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * TAU;
      const r = size * Math.cos(petals * th);
      const p = [Math.cos(th) * r, 0, Math.sin(th) * r];
      if (prev) L.seg(prev, p, base, base, 200 + (i >> 3));
      prev = p;
    }
  }
  for (const [r, d] of [[0.05, 0], [0.09, 0.1], [0.14, 0.2]]) {
    let prev = null;
    for (let i = 0; i <= 28; i++) {
      const th = (i / 28) * TAU;
      const p = [Math.cos(th) * r, 0, Math.sin(th) * r];
      if (prev) L.seg(prev, p, d, d, 500 + i);
      prev = p;
    }
  }
  return L.out();
}

const GENERATORS = [
  { name: 'Erizo de mar', build: urchin, mode: 'upright', palette: 3, size: 7 },
  { name: 'Mariposa de contornos', build: butterfly, mode: 'upright', palette: 1, wing: true, sway: true, size: 9 },
  { name: 'Mancha de curvas de nivel', build: contourBlob, mode: 'upright', palette: 4, size: 7 },
  { name: 'Salpicadura de tinta', build: splatter, mode: 'upright', palette: 5, size: 8 },
  { name: 'Anillo punteado', build: ringMandala, mode: 'facing', palette: 5, size: 10 },
  { name: 'Mandala radial', build: radialMandala, mode: 'facing', palette: 0, size: 11 },
  { name: 'Tetraedro de Sierpinski', build: sierpinski, mode: 'upright', palette: 3, size: 9 },
  { name: 'Red de filotaxis', build: phyllotaxis, mode: 'facing', palette: 2, size: 9 },
];

// ---------------------------------------------------------------- shaders

const uniforms = {
  uAudio: { value: new THREE.Vector4() },   // bass mid high kick
  uParams: { value: new THREE.Vector4() },  // expand twist speed deform
  uTime: { value: 0 },
  uColorA: { value: new THREE.Color() },
  uColorB: { value: new THREE.Color() },
  uRainbow: { value: 0 },
  uWing: { value: 0 },
  uGround: { value: -1.15 },
  uSize: { value: 16 },
  uPixelRatio: { value: 1 },
};

// shared displacement: audio-reactive expansion, kick wave, twist, wobble, wing flap
const COMMON = /* glsl */ `
  uniform vec4 uAudio; uniform vec4 uParams; uniform float uTime;
  uniform vec3 uColorA; uniform vec3 uColorB; uniform float uRainbow; uniform float uWing;
  uniform float uGround; uniform float uSize; uniform float uPixelRatio;
  attribute float aDepth; attribute float aNode;
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  vec3 displace(vec3 position, float depth) {
    float wave = clamp(1.0 - abs(depth - fract(uTime * uParams.z)) * 6.0, 0.0, 1.0) * uAudio.w;
    vec3 p = position * (1.0 + uAudio.x * uParams.x + wave * 0.3);
    float ang = uAudio.y * uParams.y * depth;
    float s = sin(ang), c = cos(ang);
    p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
    p.y += sin(depth * 20.0 + uTime * uParams.z) * uParams.w * uAudio.y * 0.05;
    p.z += abs(p.x) * uWing * (0.25 + uAudio.x * 0.9);   // wings fold toward the viewer on bass
    return p;
  }
`;

const VERT = /* glsl */ `
  ${COMMON}
  varying vec3 vColor;
  void main() {
    vec3 p = displace(position, aDepth);
    float shimmer = step(0.7, hash(aNode + fract(aDepth) + floor(uTime * 30.0)));
    vec3 base = mix(uColorA, uColorB, aDepth);
    if (uRainbow > 0.5) base = 0.5 + 0.5 * cos(6.28318 * (aDepth * 0.9 + uTime * 0.04 + vec3(0.0, 0.33, 0.67)));
    vColor = base * (0.75 + uAudio.x * 0.5 + uAudio.z * 2.5 * shimmer);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 + uAudio.z * shimmer * 1.5) / max(0.3, -mv.z);
  }
`;
const FRAG_LINE = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // premultiplied-alpha canvas over the camera feed: alpha follows brightness so dark
    // pixels let the video through instead of painting black
    vec3 c = min(vColor, vec3(1.0));
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;
const FRAG_POINT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    vec3 c = min(vColor * a * a, vec3(1.0));
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;

// Ground shadow: the same displaced vertices flattened onto the floor plane, drawn dark.
const VERT_SHADOW = /* glsl */ `
  ${COMMON}
  varying float vAlpha;
  void main() {
    vec3 p = displace(position, aDepth);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    float height = max(0.0, wp.y - uGround);
    wp.y = uGround;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    vAlpha = clamp(0.55 - height * 0.25, 0.12, 0.55);
    gl_PointSize = uSize * 1.7 * uPixelRatio / max(0.3, -mv.z);
  }
`;
const FRAG_SHADOW_LINE = /* glsl */ `
  varying float vAlpha;
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha * 0.5); }
`;
const FRAG_SHADOW_POINT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha * smoothstep(0.5, 0.05, d) * 0.55);
  }
`;

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
};
const shadowState = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending };
const lineMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG_LINE, ...additive });
const pointMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG_POINT, ...additive });
const shadowLineMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT_SHADOW, fragmentShader: FRAG_SHADOW_LINE, ...shadowState });
const shadowPointMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT_SHADOW, fragmentShader: FRAG_SHADOW_POINT, ...shadowState });

// ---------------------------------------------------------------- scene

const canvas = $('gl');
const video = $('cam');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
uniforms.uPixelRatio.value = pixelRatio;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
const content = new THREE.Group();   // anchored in the world
const spin = new THREE.Group();      // spins around the figure's vertical axis
content.add(spin);
scene.add(content);

let geometryIndex = 0;
let shape = null;

function rebuild() {
  if (shape) { spin.remove(shape); shape.userData.geo.dispose(); }
  const gen = GENERATORS[geometryIndex];
  const g = gen.build(params.density);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(g.depth, 1));
  geo.setAttribute('aNode', new THREE.Float32BufferAttribute(g.node, 1));
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = 4; // vertex shader moves vertices: never frustum-cull
  const group = new THREE.Group();
  const parts = [
    [new THREE.LineSegments(geo, shadowLineMat), -2],
    [new THREE.Points(geo, shadowPointMat), -1],
    [new THREE.LineSegments(geo, lineMat), 0],
    [new THREE.Points(geo, pointMat), 1],
  ];
  for (const [obj, order] of parts) { obj.frustumCulled = false; obj.renderOrder = order; group.add(obj); }
  group.userData.geo = geo;
  spin.add(group);
  shape = group;
  uniforms.uWing.value = gen.wing ? 1 : 0;
  uniforms.uSize.value = gen.size ?? 12;
  spin.rotation.set(0, 0, 0);
  orient();
}

// World anchor: figures hover a little above an imagined floor, a few metres ahead.
const DISTANCE = 3.0;
const CENTER_Y = -0.45;
const heading = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

function orient() {
  const gen = GENERATORS[geometryIndex];
  if (gen.mode === 'upright') {
    // local +Z towards the viewer, figure stays vertical
    content.quaternion.setFromAxisAngle(UP, Math.atan2(-heading.x, -heading.z));
  } else {
    // flat figure: its normal (local +Y) tilts back at the viewer so it is not seen edge-on
    content.quaternion.setFromUnitVectors(UP, tmp.copy(heading).negate());
  }
}

function recenter() {
  camera.getWorldDirection(tmp);
  tmp.y = 0;
  if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, -1);
  heading.copy(tmp.normalize());
  content.position.copy(camera.position).addScaledVector(heading, DISTANCE);
  content.position.y = CENTER_Y;
  orient();
}

// Keep the virtual camera's field of view registered with the video, so a point that is N pixels
// off-centre in the feed is the same angle off-centre in the 3D scene.
const VIDEO_LONG_SIDE_FOV = 65 * (Math.PI / 180);
function videoFocalPx() {
  const long = Math.max(video.videoWidth, video.videoHeight);
  return long / 2 / Math.tan(VIDEO_LONG_SIDE_FOV / 2);
}
function updateFov() {
  const w = window.innerWidth, h = window.innerHeight;
  if (video.videoWidth > 0) {
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight); // object-fit: cover
    camera.fov = (2 * Math.atan(h / (2 * scale * videoFocalPx()))) * (180 / Math.PI);
  } else {
    camera.fov = 60;
  }
  camera.updateProjectionMatrix();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  updateFov();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
video.addEventListener('loadedmetadata', updateFov);
video.addEventListener('resize', updateFov);

// ---------------------------------------------------------------- device orientation (gyro "AR")

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
let gyroActive = false;
let gyroPlaced = false;

function onOrientation(e) {
  if (e.alpha == null) return;
  const rad = Math.PI / 180;
  const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * rad;
  euler.set(e.beta * rad, e.alpha * rad, -e.gamma * rad, 'YXZ');
  camera.quaternion.setFromEuler(euler);
  camera.quaternion.multiply(q1);
  camera.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
  gyroActive = true;
  if (!gyroPlaced) { gyroPlaced = true; recenter(); }
}

async function enableGyro() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === 'function') {
    const res = await DOE.requestPermission(); // iOS: must be called from a user gesture
    if (res !== 'granted') return false;
  }
  window.addEventListener('deviceorientation', onOrientation, true);
  return true;
}

// ---------------------------------------------------------------- visual tracker (no gyro)
// Estimates the camera's rotation from the video itself: block-match a grid of textured patches
// between consecutive frames, fit a similarity transform (shift, zoom, roll) to the flow, and
// turn the shift into yaw/pitch with the video's focal length. This keeps the figure fixed against
// the background on devices with no motion sensors (laptops, desktops). It tracks rotation
// only; walking sideways gives no parallax.

class VisualTracker {
  constructor(videoEl) {
    this.video = videoEl;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.W = 0; this.H = 0;
    this.prev = null; this.cur = null;
    this.last = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.enabled = true;
    this.quality = 0;  // number of patches that matched, for the on-screen readout
    this.patch = 8; this.radius = 5;
  }

  reset() { this.yaw = 0; this.pitch = 0; this.roll = 0; this.prev = null; }

  size() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw) return false;
    const s = 96 / Math.max(vw, vh);
    const W = Math.max(32, Math.round(vw * s)), H = Math.max(32, Math.round(vh * s));
    if (W !== this.W || H !== this.H) {
      this.W = W; this.H = H;
      this.canvas.width = W; this.canvas.height = H;
      this.prev = null;
      this.cur = new Uint8Array(W * H);
    }
    return true;
  }

  grab() {
    this.ctx.drawImage(this.video, 0, 0, this.W, this.H);
    const d = this.ctx.getImageData(0, 0, this.W, this.H).data;
    const g = this.cur;
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  }

  // Returns [tx, ty, a, b] in tracker pixels, or null when there is not enough texture.
  flow() {
    const { W, H, patch: P, radius: R, prev, cur } = this;
    const pts = [];
    const side = 2 * R + 1;
    const sad = new Float32Array(side * side);
    for (let py = R + 1; py + P + R + 1 < H; py += P) {
      for (let px = R + 1; px + P + R + 1 < W; px += P) {
        let tex = 0;
        for (let y = 0; y < P; y++) for (let x = 0; x < P - 1; x++) tex += Math.abs(prev[(py + y) * W + px + x + 1] - prev[(py + y) * W + px + x]);
        if (tex < P * P * 3) continue;
        let best = Infinity, second = Infinity, bx = 0, by = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            let s = 0;
            for (let y = 0; y < P; y++) {
              const a = (py + y) * W + px, b = (py + y + dy) * W + px + dx;
              for (let x = 0; x < P; x++) s += Math.abs(prev[a + x] - cur[b + x]);
            }
            sad[(dy + R) * side + dx + R] = s;
            if (s < best) { second = best; best = s; bx = dx; by = dy; } else if (s < second) second = s;
          }
        }
        if (best > second * 0.85 && best > 20) continue; // ambiguous match
        // parabolic sub-pixel refinement
        const at = (x, y) => sad[(y + R) * side + x + R];
        let fx = bx, fy = by;
        if (bx > -R && bx < R) { const l = at(bx - 1, by), c = at(bx, by), r = at(bx + 1, by); const den = l - 2 * c + r; if (den > 1e-3) fx += clamp((l - r) / (2 * den), -0.5, 0.5); }
        if (by > -R && by < R) { const u = at(bx, by - 1), c = at(bx, by), d = at(bx, by + 1); const den = u - 2 * c + d; if (den > 1e-3) fy += clamp((u - d) / (2 * den), -0.5, 0.5); }
        pts.push([px + P / 2 - W / 2, py + P / 2 - H / 2, fx, fy]);
      }
    }
    this.quality = pts.length;
    if (pts.length < 8) return null;

    // robust least squares: fx = tx + a*X - b*Y ; fy = ty + b*X + a*Y
    let keep = pts;
    let sol = null;
    for (let iter = 0; iter < 3; iter++) {
      sol = solveSimilarity(keep);
      if (!sol) return null;
      const res = pts.map((p) => Math.hypot(p[2] - (sol[0] + sol[2] * p[0] - sol[3] * p[1]), p[3] - (sol[1] + sol[3] * p[0] + sol[2] * p[1])));
      const sorted = [...res].sort((x, y) => x - y);
      const lim = Math.max(0.35, sorted[Math.floor(sorted.length / 2)] * 2.5);
      keep = pts.filter((_, i) => res[i] <= lim);
      if (keep.length < 8) return sol;
    }
    return sol;
  }

  step(now) {
    if (!this.enabled || now - this.last < 33) return;
    if (this.video.readyState < 2 || !this.size()) return;
    this.last = now;
    this.grab();
    if (this.prev) {
      const f = this.flow();
      if (f) {
        const k = Math.max(this.video.videoWidth, this.video.videoHeight) / Math.max(this.W, this.H); // tracker px -> video px
        const fl = videoFocalPx();
        const dead = (v) => (Math.abs(v) < 2e-4 ? 0 : v);
        this.yaw += dead(Math.atan2(f[0] * k, fl));   // content moves right  -> camera turned left
        this.pitch += dead(Math.atan2(f[1] * k, fl)); // content moves down   -> camera tilted up
        this.roll += dead(f[3]);                       // content turns clockwise -> camera rolled anticlockwise
        this.pitch = clamp(this.pitch, -1.2, 1.2);
      }
      this.prev.set(this.cur);
    } else {
      this.prev = new Uint8Array(this.cur);
    }
  }
}

function solveSimilarity(pts) {
  // normal equations for p = [tx, ty, a, b]
  const N = Array.from({ length: 4 }, () => new Float64Array(5));
  const add = (row, rhs) => {
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) N[i][j] += row[i] * row[j]; N[i][4] += row[i] * rhs; }
  };
  for (const [X, Y, fx, fy] of pts) { add([1, 0, X, -Y], fx); add([0, 1, Y, X], fy); }
  for (let i = 0; i < 4; i++) {
    let piv = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(N[r][i]) > Math.abs(N[piv][i])) piv = r;
    if (Math.abs(N[piv][i]) < 1e-9) return null;
    [N[i], N[piv]] = [N[piv], N[i]];
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const m = N[r][i] / N[i][i];
      for (let c = i; c < 5; c++) N[r][c] -= m * N[i][c];
    }
  }
  return [N[0][4] / N[0][0], N[1][4] / N[1][1], N[2][4] / N[2][2], N[3][4] / N[3][3]];
}

const tracker = new VisualTracker(video);

function applyTrackerPose() {
  euler.set(tracker.pitch, tracker.yaw, tracker.roll, 'YXZ');
  camera.quaternion.setFromEuler(euler);
}

// ---------------------------------------------------------------- camera passthrough

async function enableCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  updateFov();
}

// ---------------------------------------------------------------- UI

const audio = new AudioEngine();

function setStatus(msg) {
  const el = $('status');
  el.textContent = msg;
  el.hidden = !msg;
}

function applyPalette(i) {
  const p = PALETTES[i];
  uniforms.uColorA.value.setRGB(...p.a, THREE.LinearSRGBColorSpace);
  uniforms.uColorB.value.setRGB(...p.b, THREE.LinearSRGBColorSpace);
  uniforms.uRainbow.value = p.rainbow ? 1 : 0;
  $('sel-pal').value = String(i);
}

function buildPanel() {
  const geo = $('sel-geo'), pal = $('sel-pal');
  GENERATORS.forEach((g, i) => geo.add(new Option(g.name, i)));
  PALETTES.forEach((p, i) => pal.add(new Option(p.name, i)));
  geo.addEventListener('change', () => {
    geometryIndex = +geo.value;
    applyPalette(GENERATORS[geometryIndex].palette); // each figure comes with the colours it suits
    rebuild();
  });
  pal.addEventListener('change', () => applyPalette(+pal.value));

  for (const key of ['expand', 'twist', 'speed', 'deform']) {
    $('s-' + key).addEventListener('input', (e) => { params[key] = +e.target.value; });
  }
  $('s-sens').addEventListener('input', (e) => { audio.sens = +e.target.value; });
  // density regenerates the mesh, so only commit when the slider is released
  $('s-density').addEventListener('change', (e) => { params.density = +e.target.value; rebuild(); });

  const applyGlow = () => {
    const r = +$('s-glow').value;
    canvas.style.filter = r > 0 ? `drop-shadow(0 0 ${r}px rgba(255, 70, 230, 0.85))` : 'none';
  };
  $('s-glow').addEventListener('input', applyGlow);
  applyGlow();

  $('c-track').addEventListener('change', (e) => { tracker.enabled = e.target.checked; tracker.reset(); });
  $('btn-toggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
  $('btn-center').addEventListener('click', () => { tracker.reset(); if (!gyroActive) camera.quaternion.identity(); recenter(); });

  const setActive = (id) => {
    for (const b of ['btn-mic', 'btn-demo']) $(b).classList.toggle('on', b === id);
  };
  $('btn-mic').addEventListener('click', async () => {
    try { await audio.useMic(); setActive('btn-mic'); setStatus(''); }
    catch (err) { setStatus('Micrófono no disponible: ' + err.name); }
  });
  $('btn-demo').addEventListener('click', () => { audio.useDemo(); setActive('btn-demo'); setStatus('Demo: ritmo sintético'); });
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await audio.useFile(f); setActive(null); setStatus(f.name.slice(0, 28)); }
    catch (err) { setStatus('No se pudo reproducir el archivo'); }
  });
}

// pinch to scale (two pointers)
const pointers = new Map();
let pinchStart = 0, scaleStart = 1;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, e);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    scaleStart = content.scale.x;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, e);
  if (pointers.size === 2 && pinchStart > 0) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    content.scale.setScalar(clamp(scaleStart * (d / pinchStart), 0.25, 4));
  }
});
const endPointer = (e) => { pointers.delete(e.pointerId); pinchStart = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ---------------------------------------------------------------- start

async function start() {
  const btn = $('btn-start'), err = $('start-error');
  btn.disabled = true; err.hidden = true;
  const problems = [];

  audio.init(); // synchronous, inside the tap

  // iOS requires the motion permission request to come straight from the gesture
  let gyro = false;
  try { gyro = await enableGyro(); } catch { problems.push('movimiento'); }
  try { await enableCamera(); } catch { problems.push('cámara'); }
  let micOk = true;
  try { await audio.useMic(); } catch { micOk = false; problems.push('micrófono'); }

  $('start').hidden = true;
  $('panel').hidden = false;
  $('hud').hidden = false;
  if (!micOk) { audio.useDemo(); $('btn-mic').classList.remove('on'); $('btn-demo').classList.add('on'); }
  if (!gyro) recenter();
  if (problems.length) setStatus('Sin acceso a: ' + problems.join(', ') + (micOk ? '' : ' · usando demo'));
}

// ---------------------------------------------------------------- main loop

const bars = { bass: $('m-bass'), mid: $('m-mid'), high: $('m-high') };
const clock = new THREE.Clock();
let fpsFrames = 0, fpsLast = performance.now();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const f = audio.update(dt);
  uniforms.uAudio.value.set(f.bass, f.mid, f.high, f.kick);
  uniforms.uParams.value.set(params.expand, params.twist, params.speed, params.deform);
  uniforms.uTime.value += dt;
  // flat creatures (butterfly) sway instead of spinning, so they are never seen edge-on
  if (GENERATORS[geometryIndex].sway) spin.rotation.y = Math.sin(uniforms.uTime.value * 0.5 * params.speed) * 0.55;
  else spin.rotation.y += dt * params.speed * 0.35 * (1 + f.mid * 1.5);

  if (!gyroActive) { tracker.step(performance.now()); applyTrackerPose(); }

  bars.bass.style.transform = `scaleX(${f.bass.toFixed(3)})`;
  bars.mid.style.transform = `scaleX(${f.mid.toFixed(3)})`;
  bars.high.style.transform = `scaleX(${f.high.toFixed(3)})`;
  renderer.render(scene, camera);
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 1000) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
    const lock = gyroActive ? 'giroscopio' : tracker.enabled ? `visual ${tracker.quality}` : 'sin anclaje';
    $('fps').textContent = `${fps} fps · ${Number.isFinite(audio.bassDb) ? Math.round(audio.bassDb) : '--'} dB · ${lock}`;
    fpsFrames = 0; fpsLast = now;
  }
  requestAnimationFrame(frame);
}

buildPanel();
applyPalette(GENERATORS[0].palette);
resize();
rebuild();
recenter();
$('btn-start').addEventListener('click', start);
requestAnimationFrame(frame);

// small hook for automated checks
window.__astral = { audio, params, camera, tracker, content, get gyroActive() { return gyroActive; }, start, uniforms };

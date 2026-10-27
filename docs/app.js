import * as THREE from './vendor/three.module.min.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- parameters

const params = { expand: 0.35, twist: 1.5, speed: 1, deform: 0.5, density: 4 };

const PALETTES = [
  { name: 'Magenta / Verde', a: [1.0, 0.0, 0.8], b: [0.1, 1.0, 0.3] },
  { name: 'Rosa eléctrico', a: [1.0, 0.1, 0.5], b: [0.9, 0.2, 1.0] },
  { name: 'Verde tóxico / Cian', a: [0.2, 1.0, 0.4], b: [0.0, 0.9, 1.0] },
];

// ---------------------------------------------------------------- audio engine
// Same pipeline as the Unity app: FFT -> 3 bands -> peak-follower auto gain ->
// attack/release envelope, plus a spectral-flux onset detector on the bass bins.

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
    this.peak = [2e-3, 2e-3, 2e-3];
    this.env = [0, 0, 0];
    this.fluxAvg = 0;
    this.kick = 0;
    this.release = 0.88;
    this.gainDecay = 0.995;
  }

  // Must run synchronously inside a user gesture (iOS Safari).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.speaker = this.ctx.createGain();
    this.speaker.gain.value = 0;
    this.analyser.connect(this.speaker);
    this.speaker.connect(this.ctx.destination);
    const n = this.analyser.frequencyBinCount;
    this.db = new Float32Array(n);
    this.spec = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.ctx.resume();
  }

  stopSource() {
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
    for (const n of this.demoNodes) { try { n.stop?.(); n.disconnect(); } catch { /* already stopped */ } }
    this.demoNodes = [];
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.removeAttribute('src'); this.audioEl.load(); this.audioEl = null; }
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
        if (step % 2 === 0) { // kick on every other 16th -> 2 per beat group
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

  update() {
    if (!this.analyser) return this.features;
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
    for (let i = 0; i < 3; i++) {
      this.peak[i] = Math.max(raw[i], this.peak[i] * this.gainDecay, 2e-3);
      const v = raw[i] / this.peak[i];
      this.env[i] = v > this.env[i] ? v : v + (this.env[i] - v) * this.release;
    }

    const bassBins = Math.ceil(250 / hz);
    let flux = 0;
    for (let i = 0; i < bassBins; i++) {
      flux += Math.max(0, this.spec[i] - this.prev[i]);
      this.prev[i] = this.spec[i];
    }
    this.fluxAvg += (flux - this.fluxAvg) * 0.05;
    this.kick = flux > this.fluxAvg * 1.6 && flux > 1e-3 ? 1 : this.kick * 0.9;

    const f = this.features;
    f.bass = this.env[0]; f.mid = this.env[1]; f.high = this.env[2]; f.kick = this.kick;
    return f;
  }
}

// ---------------------------------------------------------------- geometry
// Each generator returns line segments (pairs of vertices) in the local XZ plane, with
// per-vertex depth (0 = centre, 1 = outer edge) and a node id, like the Unity meshes.

function radialMandala(density) {
  const levels = clamp(density, 2, 6);
  const pos = [], depth = [], node = [];
  let id = 0;
  const rec = (ox, oz, angle, len, level) => {
    if (level >= levels) return;
    const d = level / (levels - 1);
    const ex = ox + Math.cos(angle) * len;
    const ez = oz + Math.sin(angle) * len;
    pos.push(ox, 0, oz, ex, 0, ez);
    depth.push(d, d); node.push(id, id); id++;
    for (const s of [-1, 1]) rec(ex, ez, angle + (s * Math.PI) / 5, len * 0.58, level + 1);
  };
  for (let k = 0; k < 12; k++) rec(0, 0, (k * Math.PI * 2) / 12, 0.25, 0);
  return { pos, depth, node };
}

function sierpinski(density) {
  const levels = clamp(density, 1, 5);
  const pos = [], node = [];
  const k = 0.8165;
  const corners = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  let id = 0;
  const tetra = (cx, cy, cz, s, level) => {
    if (level === levels) {
      const v = corners.map((c) => [cx + c[0] * s * k, cy + c[1] * s * k, cz + c[2] * s * k]);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { pos.push(...v[i], ...v[j]); node.push(id, id); }
      id++;
      return;
    }
    for (const c of corners) tetra(cx + c[0] * s * k * 0.5, cy + c[1] * s * k * 0.5, cz + c[2] * s * k * 0.5, s * 0.5, level + 1);
  };
  tetra(0, 0, 0, 0.5, 0);
  return { pos, depth: radialDepth(pos), node };
}

function phyllotaxis(density) {
  const count = clamp(density, 1, 6) * 150;
  const golden = 2.39996323;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const r = 0.9 * Math.sqrt(i / count);
    pts.push([Math.cos(i * golden) * r, 0, Math.sin(i * golden) * r]);
  }
  const pos = [], node = [];
  for (let i = 0; i < count; i++) {
    for (const step of [8, 13, 21]) {
      if (i + step < count) { pos.push(...pts[i], ...pts[i + step]); node.push(i % 21, i % 21); }
    }
  }
  return { pos, depth: radialDepth(pos), node };
}

function radialDepth(pos) {
  const d = new Array(pos.length / 3);
  let max = 1e-6;
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    max = Math.max(max, d[i]);
  }
  return d.map((v) => v / max);
}

const GENERATORS = [
  { name: 'Mandala radial', build: radialMandala },
  { name: 'Tetraedro de Sierpinski', build: sierpinski },
  { name: 'Red de filotaxis', build: phyllotaxis },
];

// ---------------------------------------------------------------- shaders

const uniforms = {
  uAudio: { value: new THREE.Vector4() },   // bass mid high kick
  uParams: { value: new THREE.Vector4() },  // expand twist speed deform
  uTime: { value: 0 },
  uColorA: { value: new THREE.Color() },
  uColorB: { value: new THREE.Color() },
  uSize: { value: 16 },
  uPixelRatio: { value: 1 },
};

const VERT = /* glsl */ `
  uniform vec4 uAudio; uniform vec4 uParams; uniform float uTime;
  uniform vec3 uColorA; uniform vec3 uColorB; uniform float uSize; uniform float uPixelRatio;
  attribute float aDepth; attribute float aNode;
  varying vec3 vColor;
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  void main() {
    float depth = aDepth;
    float wave = clamp(1.0 - abs(depth - fract(uTime * uParams.z)) * 6.0, 0.0, 1.0) * uAudio.w;
    vec3 p = position * (1.0 + uAudio.x * uParams.x + wave * 0.3);
    float ang = uAudio.y * uParams.y * depth;
    float s = sin(ang), c = cos(ang);
    p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
    p.y += sin(depth * 20.0 + uTime * uParams.z) * uParams.w * uAudio.y * 0.05;
    float shimmer = step(0.7, hash(aNode + fract(depth) + floor(uTime * 30.0)));
    vColor = mix(uColorA, uColorB, depth) * (0.75 + uAudio.x * 0.5 + uAudio.z * 2.5 * shimmer);
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

const additive = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
};
const lineMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG_LINE, ...additive });
const pointMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG_POINT, ...additive });

// ---------------------------------------------------------------- scene

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
uniforms.uPixelRatio.value = pixelRatio;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
const content = new THREE.Group();   // placed in front of the viewer, normal facing the camera
const spin = new THREE.Group();      // spins around the mandala normal
content.add(spin);
scene.add(content);

let geometryIndex = 0;
let shape = null;

function rebuild() {
  if (shape) { spin.remove(shape); shape.userData.geo.dispose(); }
  const g = GENERATORS[geometryIndex].build(params.density);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(g.depth, 1));
  geo.setAttribute('aNode', new THREE.Float32BufferAttribute(g.node, 1));
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = 3; // vertex shader moves vertices: never frustum-cull
  const group = new THREE.Group();
  const lines = new THREE.LineSegments(geo, lineMat);
  const points = new THREE.Points(geo, pointMat);
  lines.frustumCulled = false; points.frustumCulled = false;
  group.add(lines, points);
  group.userData.geo = geo;
  spin.add(group);
  shape = group;
}

const DISTANCE = 2.2;
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

function recenter() {
  camera.getWorldDirection(tmp);
  tmp.y = 0;
  if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, -1);
  tmp.normalize();
  content.position.copy(camera.position).addScaledVector(tmp, DISTANCE);
  // mesh normal is local +Y; point it back at the viewer so the mandala is not seen edge-on
  content.quaternion.setFromUnitVectors(UP, tmp.clone().negate());
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

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

// ---------------------------------------------------------------- camera passthrough

async function enableCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  const video = $('cam');
  video.srcObject = stream;
  await video.play().catch(() => {});
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
}

function buildPanel() {
  const geo = $('sel-geo'), pal = $('sel-pal');
  GENERATORS.forEach((g, i) => geo.add(new Option(g.name, i)));
  PALETTES.forEach((p, i) => pal.add(new Option(p.name, i)));
  geo.addEventListener('change', () => { geometryIndex = +geo.value; rebuild(); });
  pal.addEventListener('change', () => applyPalette(+pal.value));

  for (const key of ['expand', 'twist', 'speed', 'deform']) {
    $('s-' + key).addEventListener('input', (e) => { params[key] = +e.target.value; });
  }
  // density regenerates the mesh, so only commit when the slider is released
  $('s-density').addEventListener('change', (e) => { params.density = +e.target.value; rebuild(); });

  const applyGlow = () => {
    const r = +$('s-glow').value;
    canvas.style.filter = r > 0 ? `drop-shadow(0 0 ${r}px rgba(255, 70, 230, 0.85))` : 'none';
  };
  $('s-glow').addEventListener('input', applyGlow);
  applyGlow();

  $('btn-toggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
  $('btn-center').addEventListener('click', recenter);

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
  const f = audio.update();
  uniforms.uAudio.value.set(f.bass, f.mid, f.high, f.kick);
  uniforms.uParams.value.set(params.expand, params.twist, params.speed, params.deform);
  uniforms.uTime.value += dt;
  spin.rotation.y += dt * params.speed * 0.35 * (1 + f.mid * 1.5);
  bars.bass.style.transform = `scaleX(${f.bass.toFixed(3)})`;
  bars.mid.style.transform = `scaleX(${f.mid.toFixed(3)})`;
  bars.high.style.transform = `scaleX(${f.high.toFixed(3)})`;
  renderer.render(scene, camera);
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 1000) {
    $('fps').textContent = `${Math.round((fpsFrames * 1000) / (now - fpsLast))} fps`;
    fpsFrames = 0; fpsLast = now;
  }
  requestAnimationFrame(frame);
}

buildPanel();
applyPalette(0);
resize();
rebuild();
recenter();
$('btn-start').addEventListener('click', start);
requestAnimationFrame(frame);

// small hook for automated checks
window.__astral = { audio, params, get gyroActive() { return gyroActive; }, start, uniforms };

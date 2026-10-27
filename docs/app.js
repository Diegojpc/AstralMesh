import * as THREE from './vendor/three.module.min.js';
import { GENERATORS, minY, clamp } from './js/figures.js';
import { makeUniforms, createMaterials } from './js/shaders.js';
import { AudioEngine } from './js/audio.js';
import { Synth } from './js/synth.js';
import { LightEstimator, coverMapper } from './js/lighting.js';
import { GyroPose, VisualTracker, videoFocalPx } from './js/tracking.js';
import { startSlam } from './js/slam.js';

// the 8th Wall engine's three.js module reads the global
window.THREE = THREE;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- parameters

const params = { expand: 0.35, twist: 1.5, speed: 1, deform: 0.5, density: 4, phoneHeight: 1.35 };

// rainbow: colour comes from a hue ramp over the figure's depth instead of the colour pair
const PALETTES = [
  { name: 'Magenta / Verde', a: [1.0, 0.0, 0.8], b: [0.1, 1.0, 0.3] },
  { name: 'Magenta / Cian', a: [1.0, 0.1, 0.75], b: [0.0, 0.9, 1.0] },
  { name: 'Rosa eléctrico', a: [1.0, 0.1, 0.5], b: [0.9, 0.2, 1.0] },
  { name: 'Verde tóxico / Cian', a: [0.2, 1.0, 0.4], b: [0.0, 0.9, 1.0] },
  { name: 'Arcoíris neón', a: [1, 1, 1], b: [1, 1, 1], rainbow: true },
  { name: 'Tinta blanca', a: [1.0, 1.0, 1.0], b: [0.55, 0.85, 1.0] },
  { name: 'Verde / Magenta / Azul', a: [0.15, 1.0, 0.25], b: [1.0, 0.1, 0.8], c: [0.1, 0.4, 1.0] },
];

// ---------------------------------------------------------------- scene

const uniforms = makeUniforms(THREE);
const mats = createMaterials(THREE, uniforms);

let canvas = $('gl');
const video = $('cam');
let renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
uniforms.uPixelRatio.value = pixelRatio;

let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
const CAM_START_Y = 1.35;           // camera height at start; the floor is assumed below it
camera.position.set(0, CAM_START_Y, 0);
const fallbackStage = { scene, camera, renderer, canvas };
let slam = null;                    // 8th Wall handle when world tracking is running
let hasStencil = true;              // the engine's renderer has none, so shadows use min-blending there
const shadowMat = () => (hasStencil ? mats.shadowMesh : mats.shadowMeshMin);
const content = new THREE.Group();   // anchored in the world
const spin = new THREE.Group();      // spins around the figure's vertical axis
content.add(spin);
scene.add(content);

let geometryIndex = 0;
let figure = null;                   // { group, minY, radius, lineGeo, fuzz }
let quality = 2;                     // 0 low, 1 medium, 2 full (adaptive)

const bufferGeometry = (g, attrs) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  for (const [name, arr] of Object.entries(attrs)) geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, 1));
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = 5; // the vertex shader moves vertices: never frustum-cull
  return geo;
};

function disposeFigure() {
  if (!figure) return;
  spin.remove(figure.group);
  figure.geos.forEach((g) => g.dispose());
  figure = null;
}

// the CSS halo suits line figures; on solid bodies it would tint the black and the shadow
function setGlow(r) {
  $('s-glow').value = String(r);
  canvas.style.filter = r > 0 ? `drop-shadow(0 0 ${r}px rgba(255, 70, 230, 0.85))` : 'none';
}

function rebuild() {
  disposeFigure();
  const gen = GENERATORS[geometryIndex];
  const fig = gen.build(params.density);
  const group = new THREE.Group();
  const geos = [];
  const add = (obj, order) => { obj.frustumCulled = false; obj.renderOrder = order; group.add(obj); };
  let shadowMeshObj = null;
  let radius = 0.8;
  let lineGeo = null, fuzzGeo = null;

  if (fig.mesh) {
    const geo = bufferGeometry(fig.mesh, { aDepth: fig.mesh.t, aNode: fig.mesh.limb, aAng: fig.mesh.ang });
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(fig.mesh.nrm, 3));
    geo.setIndex(fig.mesh.idx);
    geos.push(geo);
    shadowMeshObj = new THREE.Mesh(geo, shadowMat());
    add(shadowMeshObj, -3);                              // hard silhouette shadow on the floor
    add(new THREE.Mesh(geo, mats.mesh), 0);              // black body with neon bands
  }
  if (fig.lines) {
    lineGeo = bufferGeometry(fig.lines, { aDepth: fig.lines.depth, aNode: fig.lines.node });
    geos.push(lineGeo);
    add(new THREE.LineSegments(lineGeo, mats.shadowLine), -3);
    add(new THREE.Points(lineGeo, mats.shadowPoint), -2);
    add(new THREE.LineSegments(lineGeo, mats.line), 1);
    add(new THREE.Points(lineGeo, mats.point), 2);
  }
  if (fig.points && fig.points.depth.length) {
    fuzzGeo = bufferGeometry(fig.points, { aDepth: fig.points.depth, aNode: fig.points.node });
    geos.push(fuzzGeo);
    add(new THREE.Points(fuzzGeo, fig.mesh ? mats.flake : mats.fuzz), 3);
  }
  radius = 0;
  for (const part of [fig.lines, fig.mesh]) {
    if (!part) continue;
    for (let i = 0; i < part.pos.length; i += 3) radius = Math.max(radius, Math.hypot(part.pos[i], part.pos[i + 1], part.pos[i + 2]));
  }
  radius = radius || 0.6;
  figure = { group, geos, shadowMeshObj, minY: minY(fig), radius, lineGeo, fuzzGeo, layerVerts: fig.lines?.layerVerts, fuzzCount: fig.points?.depth.length ?? 0 };
  spin.add(group);

  uniforms.uWing.value = gen.wing ? 1 : 0;
  uniforms.uDance.value = gen.dance ? 1 : 0;
  uniforms.uSize.value = gen.size ?? 8;
  uniforms.uStripe.value.set(...(gen.stripe ?? [0, 0, 0, 0.8]));
  setGlow(gen.glow ?? 6);
  spin.rotation.set(0, 0, 0);
  applyQuality();
  orient();
  stand();
}

// adaptive quality: fewer hair strands and haze points on a slow device
function applyQuality() {
  if (!figure) return;
  if (figure.lineGeo && figure.layerVerts) {
    const layers = figure.layerVerts.length;
    const use = quality >= 2 ? layers : quality === 1 ? Math.min(2, layers) : 1;
    figure.lineGeo.setDrawRange(0, figure.layerVerts[use - 1]);
  }
  if (figure.fuzzGeo) figure.fuzzGeo.setDrawRange(0, quality >= 2 ? figure.fuzzCount : quality === 1 ? Math.floor(figure.fuzzCount / 3) : 0);
}

// ---------------------------------------------------------------- world anchor

const DISTANCE = 3.0;
const heading = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const ray = new THREE.Vector3();

let groundOverride = null;           // floor height from an engine hit test, when we have one
function ground() { return groundOverride ?? (CAM_START_Y - params.phoneHeight); }

function orient() {
  const gen = GENERATORS[geometryIndex];
  if (gen.mode === 'upright') {
    content.quaternion.setFromAxisAngle(UP, Math.atan2(-heading.x, -heading.z)); // local +Z towards the viewer
  } else {
    content.quaternion.setFromUnitVectors(UP, tmp.copy(heading).negate());       // flat figure: normal back at the viewer
  }
}

// stand the figure on the floor (or hover a flat one at chest height)
function stand() {
  uniforms.uGround.value = ground();
  const s = content.scale.y;
  const gen = GENERATORS[geometryIndex];
  content.position.y = gen.mode === 'upright' && figure ? ground() - figure.minY * s + 0.06 : ground() + 0.95;
}

function placeAt(x, z) {
  content.position.x = x;
  content.position.z = z;
  tmp.set(x - camera.position.x, 0, z - camera.position.z);
  if (tmp.lengthSq() > 1e-4) heading.copy(tmp.normalize());
  orient();
  stand();
}

function recenter() {
  camera.getWorldDirection(tmp);
  tmp.y = 0;
  if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, -1);
  heading.copy(tmp.normalize());
  placeAt(camera.position.x + heading.x * DISTANCE, camera.position.z + heading.z * DISTANCE);
}

// point on the floor under a screen position, or null when the ray does not reach it
function groundPoint(clientX, clientY) {
  const nx = (clientX / window.innerWidth) * 2 - 1, ny = -(clientY / window.innerHeight) * 2 + 1;
  camera.updateMatrixWorld();
  ray.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  if (ray.y > -0.03) return null;
  const t = (ground() - camera.position.y) / ray.y;
  if (t < 0.5 || t > 14) return null;
  return tmp.copy(camera.position).addScaledVector(ray, t).clone();
}

// ---------------------------------------------------------------- camera registration

function updateFov() {
  if (slam) return;
  const w = window.innerWidth, h = window.innerHeight;
  if (video.videoWidth > 0) {
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight); // object-fit: cover
    camera.fov = (2 * Math.atan(h / (2 * scale * videoFocalPx(video)))) * (180 / Math.PI);
  } else {
    camera.fov = 60;
  }
  camera.updateProjectionMatrix();
}

function resize() {
  if (slam) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  updateFov();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
video.addEventListener('loadedmetadata', updateFov);
video.addEventListener('resize', updateFov);

// ---------------------------------------------------------------- tracking (fallback backends)

const gyro = new GyroPose(camera, () => recenter());
const tracker = new VisualTracker(video);
const trackEuler = new THREE.Euler();

function applyTrackerPose() {
  trackEuler.set(tracker.pitch, tracker.yaw, tracker.roll, 'YXZ');
  camera.quaternion.setFromEuler(trackEuler);
}

async function enableCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  updateFov();
}

// ---------------------------------------------------------------- audio, synth, light

const audio = new AudioEngine();
const synth = new Synth(audio);
const light = new LightEstimator();

// ---------------------------------------------------------------- UI

function setStatus(msg) {
  const el = $('status');
  el.textContent = msg;
  el.hidden = !msg;
}

function applyPalette(i) {
  const p = PALETTES[i];
  uniforms.uColorA.value.setRGB(...p.a, THREE.LinearSRGBColorSpace);
  uniforms.uColorB.value.setRGB(...p.b, THREE.LinearSRGBColorSpace);
  uniforms.uColorC.value.setRGB(...(p.c ?? p.b), THREE.LinearSRGBColorSpace);
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
  $('s-height').addEventListener('input', (e) => { params.phoneHeight = +e.target.value; groundOverride = null; stand(); });
  // density regenerates the mesh, so only commit when the slider is released
  $('s-density').addEventListener('change', (e) => { params.density = +e.target.value; rebuild(); });

  $('s-glow').addEventListener('input', (e) => setGlow(+e.target.value));

  $('c-track').addEventListener('change', (e) => { tracker.enabled = e.target.checked; tracker.reset(); });
  $('c-synth').addEventListener('change', (e) => { synth.enabled = e.target.checked; });
  $('c-feedback').addEventListener('change', (e) => synth.setFeedback(e.target.checked));
  $('c-light').addEventListener('change', (e) => { light.enabled = e.target.checked; });
  $('btn-toggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
  $('btn-center').addEventListener('click', () => {
    tracker.reset();
    if (slam) slam.recenter(); else if (!gyro.active) camera.quaternion.identity();
    groundOverride = null; content.scale.setScalar(1); recenter();
  });

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

// ---------------------------------------------------------------- touch: place, pinch, play

// screen position and radius (px) of the figure, to tell "touch the figure" from "tap the floor"
function figureOnScreen() {
  content.updateMatrixWorld(true);
  const c = new THREE.Vector3(0, (figure?.minY ?? -0.5) * -0.2, 0);
  content.localToWorld(c);
  const r = (figure?.radius ?? 0.8) * content.scale.x * 0.8;
  const edge = c.clone().add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(r));
  const p = c.clone().project(camera), q = edge.clone().project(camera);
  if (p.z > 1) return null;
  const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
  return { x: (p.x + 1) * hw, y: (1 - p.y) * hh, r: Math.abs(q.x - p.x) * hw };
}

const pointers = new Map();
let pinchStart = 0, scaleStart = 1;
let gesture = null; // { kind: 'play' | 'tap', x, y, t, lastX, lastY, lastT }

function bindPointer(el) {
  el.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      scaleStart = content.scale.x;
      gesture = null;
      return;
    }
    const fs = figureOnScreen();
    const inside = fs && Math.hypot(e.clientX - fs.x, e.clientY - fs.y) < Math.max(fs.r, 40);
    gesture = { kind: inside ? 'play' : 'tap', x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), fs };
    if (inside) { audio.init(); synth.play(...touchXY(e, fs), 0.5); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2 && pinchStart > 0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      content.scale.setScalar(clamp(scaleStart * (d / pinchStart), 0.25, 4));
      stand();
      return;
    }
    if (!gesture) return;
    const now = performance.now();
    if (gesture.kind === 'play') {
      const speed = Math.hypot(e.clientX - gesture.lastX, e.clientY - gesture.lastY) / Math.max(1, now - gesture.lastT) / 1.2;
      synth.play(...touchXY(e, gesture.fs), speed);
    } else if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 14) {
      gesture = null; // it is a drag, not a tap
      return;
    }
    gesture.lastX = e.clientX; gesture.lastY = e.clientY; gesture.lastT = now;
  });
  const endPointer = (e) => {
    if (gesture && gesture.kind === 'tap' && performance.now() - gesture.t < 400 && pointers.size === 1) {
      // tap the floor: stand the figure there (engine hit test when tracking, else a floor plane)
      let hit = null;
      if (slam) { const h = slam.hitTest(e.clientX, e.clientY); if (h) { groundOverride = h.y; hit = h; } }
      if (!hit) hit = groundPoint(e.clientX, e.clientY);
      if (hit) placeAt(hit.x, hit.z);
    }
    pointers.delete(e.pointerId);
    pinchStart = 0;
    if (pointers.size === 0) gesture = null;
  };
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinchStart = 0; gesture = null; });
}
bindPointer(canvas);

function touchXY(e, fs) {
  return [clamp((e.clientX - (fs.x - fs.r)) / (2 * fs.r), 0, 1), clamp((e.clientY - (fs.y - fs.r)) / (2 * fs.r), 0, 1)];
}

// ---------------------------------------------------------------- world tracking stage

// The engine owns the camera feed, the camera pose and the render loop: move the figure into its
// scene and drive our per-frame update from its loop.
function useSlam(h) {
  slam = h;
  fallbackStage.scene.remove(content);
  h.scene.add(content);
  scene = h.scene; camera = h.camera; renderer = h.renderer;
  canvas.style.filter = 'none';
  canvas.style.display = 'none';
  video.style.display = 'none';
  canvas = h.canvas;
  bindPointer(canvas);
  uniforms.uPixelRatio.value = h.canvas.width / window.innerWidth;
  tracker.enabled = false;
  $('c-track').checked = false; $('c-track').disabled = true;   // no visual tracker needed
  $('s-glow').disabled = true;                                   // the CSS halo does not apply over the engine's picture
  groundOverride = null;
  hasStencil = !!renderer.getContext().getContextAttributes().stencil;
  if (figure?.shadowMeshObj) figure.shadowMeshObj.material = shadowMat();
  recenter();
}

function slamUpdate() {
  renderer.clearStencil(); // the engine renders with autoClear off: reset the shadow's stencil each frame
  update();
}

// ---------------------------------------------------------------- start

async function start() {
  const btn = $('btn-start'), err = $('start-error');
  btn.disabled = true; err.hidden = true;
  const problems = [];

  audio.init(); // synchronous, inside the tap

  // 1) world tracking (6DoF) through the engine; it opens the camera itself.
  //    Started first so its permission prompts come straight from the tap.
  let slamOk = false;
  try {
    slamOk = !!(await startSlam({ cameraY: CAM_START_Y, onReady: useSlam, onUpdate: slamUpdate, onError: (e) => setStatus('SLAM: ' + (e?.message || e)) }));
  } catch (e) { console.warn('[AstralMesh] SLAM failed to start', e); }

  // 2) otherwise our own rotation-only tracking
  let gyroOk = false;
  if (!slamOk) {
    try { gyroOk = await gyro.enable(); } catch { problems.push('movimiento'); }
    try { await enableCamera(); } catch { problems.push('cámara'); }
  }
  let micOk = true;
  try { await audio.useMic(); } catch { micOk = false; problems.push('micrófono'); }

  $('start').hidden = true;
  $('panel').hidden = false;
  $('hud').hidden = false;
  if (!micOk) { audio.useDemo(); $('btn-mic').classList.remove('on'); $('btn-demo').classList.add('on'); }
  if (!slamOk && !gyroOk) recenter();
  if (problems.length) setStatus('Sin acceso a: ' + problems.join(', ') + (micOk ? '' : ' · usando demo'));
}

// ---------------------------------------------------------------- main loop

const bars = { bass: $('m-bass'), mid: $('m-mid'), high: $('m-high') };
const clock = new THREE.Clock();
let fpsFrames = 0, fpsLast = performance.now();
let slowSince = 0, fastSince = 0;

function adaptQuality(fps, now) {
  if (fps < 38 && quality > 0) { slowSince = slowSince || now; fastSince = 0; if (now - slowSince > 2500) { quality--; slowSince = 0; applyQuality(); } }
  else if (fps > 56 && quality < 2) { fastSince = fastSince || now; slowSince = 0; if (now - fastSince > 8000) { quality++; fastSince = 0; applyQuality(); } }
  else { slowSince = 0; fastSince = 0; }
}

const grabFrame = () => (slam ? slam.lumaFrame() : light.frameFromVideo(video));
const mapper = () => {
  const f = slam ? slam.lumaFrame() : null;
  return coverMapper(f ? f.w : video.videoWidth, f ? f.h : video.videoHeight, window.innerWidth, window.innerHeight);
};

// everything that happens each frame except drawing, so it runs both in our own loop and
// inside the engine's loop when world tracking is active
function update() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = performance.now();
  const f = audio.update(dt);
  uniforms.uAudio.value.set(f.bass, f.mid, f.high, f.kick);
  uniforms.uParams.value.set(params.expand, params.twist, params.speed, params.deform);
  uniforms.uTime.value += dt;

  // flat creatures (butterfly) sway instead of spinning, so they are never seen edge-on
  const gen = GENERATORS[geometryIndex];
  if (gen.sway) spin.rotation.y = Math.sin(uniforms.uTime.value * 0.5 * params.speed) * 0.55;
  else if (!gen.dance) spin.rotation.y += dt * params.speed * 0.35 * (1 + f.mid * 1.5);

  if (!slam && !gyro.active) { tracker.step(now); if (tracker.enabled) applyTrackerPose(); }
  camera.updateMatrixWorld();

  // light direction from the picture; shadows follow it
  if (slam || video.videoWidth) light.update(dt, grabFrame, mapper, camera, now);
  uniforms.uLightDir.value.copy(light.dir);
  uniforms.uLightStrength.value = light.strength;
  uniforms.uShadowLuma.value = clamp(light.ambient * 0.4, 0.02, 0.18); // shadow tone follows how bright the scene is

  bars.bass.style.transform = `scaleX(${f.bass.toFixed(3)})`;
  bars.mid.style.transform = `scaleX(${f.mid.toFixed(3)})`;
  bars.high.style.transform = `scaleX(${f.high.toFixed(3)})`;
  fpsFrames++;
  if (now - fpsLast >= 1000) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
    const lock = slam ? 'SLAM' : gyro.active ? 'giroscopio' : tracker.enabled ? `visual ${tracker.quality}` : 'sin anclaje';
    const lamp = light.found ? 'farola ✓' : 'luz estimada';
    $('fps').textContent = `${fps} fps · ${Number.isFinite(audio.bassDb) ? Math.round(audio.bassDb) : '--'} dB · ${lock} · ${lamp} · Q${quality}`;
    adaptQuality(fps, now);
    fpsFrames = 0; fpsLast = now;
  }
}

function loop() {
  if (slam) return; // the engine drives rendering now
  update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

buildPanel();
applyPalette(GENERATORS[0].palette);
resize();
rebuild();
recenter();
$('btn-start').addEventListener('click', start);
requestAnimationFrame(loop);

// hook for automated checks
window.__astral = {
  get slam() { return slam; }, audio, params, camera, tracker, content, light, synth, uniforms, mats, scene, renderer,
  get gyroActive() { return gyro.active; }, get figure() { return figure; }, get quality() { return quality; },
  setQuality(q) { quality = q; applyQuality(); }, start,
};

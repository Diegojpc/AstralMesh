// Pure geometry (no DOM, no three.js) so it can be unit-tested in Node.
//
// A figure build returns any of:
//   lines  { pos, depth, node, layerVerts }  segment pairs; strand layers are stored one after the
//                                            other so drawRange(0, layerVerts[q-1]) trims strands
//   points { pos, depth, node }              fuzz / flakes
//   mesh   { pos, nrm, t, ang, limb, idx }   solid body (tubes, blobs) drawn black with neon bands
// depth / t = 0..1 progress (centre -> tip, or bottom -> top); node / limb = id for shimmer/phase.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirrorX = (p) => [-p[0], p[1], p[2]];

// ------------------------------------------------------------------ line builder with strands

export class Lines {
  constructor(maxStrands = 3, seed = 99) {
    this.maxStrands = maxStrands;
    this.layers = Array.from({ length: maxStrands }, () => ({ pos: [], depth: [], node: [] }));
    this.rng = mulberry32(seed);
    this.id = 0;
  }

  // strands > 1 adds parallel, slightly wandering copies of the segment ("hair"), one per layer
  seg(a, b, da, db, id = this.id, strands = this.maxStrands, spread = 0.008) {
    const n = Math.min(strands, this.maxStrands);
    for (let k = 0; k < n; k++) {
      const L = this.layers[k];
      let pa = a, pb = b;
      if (k > 0) {
        const r = this.rng;
        const o = [(r() - 0.5) * 2 * spread, (r() - 0.5) * 2 * spread, (r() - 0.5) * 2 * spread];
        const e = [(r() - 0.5) * spread, (r() - 0.5) * spread, (r() - 0.5) * spread];
        pa = add(a, o); pb = add(add(b, o), e);
      }
      L.pos.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
      L.depth.push(da, db);
      L.node.push(id, id);
    }
  }

  next() { this.id++; }

  out() {
    const pos = [], depth = [], node = [], layerVerts = [];
    let verts = 0;
    for (const L of this.layers) {
      for (let i = 0; i < L.pos.length; i++) pos.push(L.pos[i]);
      for (let i = 0; i < L.depth.length; i++) { depth.push(L.depth[i]); node.push(L.node[i]); }
      verts += L.depth.length;
      layerVerts.push(verts);
    }
    return { pos, depth, node, layerVerts };
  }
}

// random points sampled along the base layer's segments: a soft haze around the structure
export function fuzzFrom(lines, count, jitter = 0.02, seed = 3) {
  const rng = mulberry32(seed);
  const L = lines.layers[0];
  const segs = L.depth.length / 2;
  const pos = [], depth = [], node = [];
  if (!segs) return { pos, depth, node };
  for (let i = 0; i < count; i++) {
    const s = Math.floor(rng() * segs), t = rng();
    const a = [L.pos[s * 6], L.pos[s * 6 + 1], L.pos[s * 6 + 2]];
    const b = [L.pos[s * 6 + 3], L.pos[s * 6 + 4], L.pos[s * 6 + 5]];
    const p = lerp3(a, b, t);
    pos.push(p[0] + (rng() - 0.5) * jitter, p[1] + (rng() - 0.5) * jitter, p[2] + (rng() - 0.5) * jitter);
    depth.push(L.depth[s * 2] + (L.depth[s * 2 + 1] - L.depth[s * 2]) * t);
    node.push(L.node[s * 2] + i * 0.37);
  }
  return { pos, depth, node };
}

// ------------------------------------------------------------------ solid mesh builders

function newMesh() { return { pos: [], nrm: [], t: [], ang: [], limb: [], idx: [] }; }

// tube along a polyline using parallel transport; radius(t) shapes the profile
export function addTube(M, spine, radius, J, limbId) {
  const n = spine.length;
  const base = M.pos.length / 3;
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const tan = norm(sub(spine[Math.min(i + 1, n - 1)], spine[Math.max(i - 1, 0)]));
    let N;
    if (!prevN) {
      const ref = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      N = norm(cross(ref, tan));
    } else {
      N = norm(sub(prevN, mul(tan, dot(prevN, tan))));
    }
    const B = cross(tan, N);
    const t = i / (n - 1);
    const r = radius(t);
    for (let j = 0; j < J; j++) {
      const phi = (j / J) * TAU;
      const off = add(mul(N, Math.cos(phi)), mul(B, Math.sin(phi)));
      M.pos.push(spine[i][0] + off[0] * r, spine[i][1] + off[1] * r, spine[i][2] + off[2] * r);
      M.nrm.push(off[0], off[1], off[2]);
      M.t.push(t); M.ang.push(j / J); M.limb.push(limbId);
    }
    prevN = N;
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < J; j++) {
      const a = base + i * J + j, b = base + i * J + ((j + 1) % J);
      const c = base + (i + 1) * J + j, d = base + (i + 1) * J + ((j + 1) % J);
      M.idx.push(a, b, c, b, d, c);
    }
  }
}

function line3(a, b, n) { return Array.from({ length: n }, (_, i) => lerp3(a, b, i / (n - 1))); }

function catmull(pts, perSeg) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// organic limb: walk along dir, bending by a constant curl plus a little noise
function limbSpine(rng, base, dir, len, steps, curl) {
  const pts = [base];
  let d = norm(dir), p = base;
  const h = len / steps;
  for (let i = 0; i < steps; i++) {
    const k = 0.6 + (0.9 * i) / steps;
    d = norm([d[0] + curl[0] * k + (rng() - 0.5) * 0.05, d[1] + curl[1] * k + (rng() - 0.5) * 0.05, d[2] + curl[2] * k + (rng() - 0.5) * 0.05]);
    p = add(p, mul(d, h));
    pts.push(p);
  }
  return pts;
}

function flakes(rng, count, radius, centre = [0, 0, 0]) {
  const pos = [], depth = [], node = [];
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1, th = rng() * TAU, rr = Math.sqrt(1 - u * u);
    const r = radius * (0.35 + 0.65 * rng());
    pos.push(centre[0] + Math.cos(th) * rr * r, centre[1] + u * r * 0.8, centre[2] + Math.sin(th) * rr * r);
    depth.push(rng()); node.push(1000 + i);
  }
  return { pos, depth, node };
}

// ------------------------------------------------------------------ figures

function radialMandala(density) {
  const levels = clamp(density, 2, 6);
  const L = new Lines(2);
  const rec = (ox, oz, angle, len, level) => {
    if (level >= levels) return;
    const d = level / (levels - 1);
    const ex = ox + Math.cos(angle) * len, ez = oz + Math.sin(angle) * len;
    L.seg([ox, 0, oz], [ex, 0, ez], d, d); L.next();
    for (const s of [-1, 1]) rec(ex, ez, angle + (s * Math.PI) / 5, len * 0.58, level + 1);
  };
  for (let k = 0; k < 12; k++) rec(0, 0, (k * TAU) / 12, 0.25, 0);
  return { lines: L.out(), points: fuzzFrom(L, 2500, 0.015, 1) };
}

function sierpinski(density) {
  const levels = clamp(density, 1, 5);
  const L = new Lines(2);
  const k = 0.8165;
  const corners = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const tetra = (cx, cy, cz, s, level) => {
    if (level === levels) {
      const v = corners.map((c) => [cx + c[0] * s * k, cy + c[1] * s * k, cz + c[2] * s * k]);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) L.seg(v[i], v[j], 0, 0, L.id, 2, 0.004);
      L.next();
      return;
    }
    for (const c of corners) tetra(cx + c[0] * s * k * 0.5, cy + c[1] * s * k * 0.5, cz + c[2] * s * k * 0.5, s * 0.5, level + 1);
  };
  tetra(0, 0, 0, 0.5, 0);
  const lines = L.out();
  radialDepth(lines);
  return { lines, points: fuzzFrom(L, 2000, 0.01, 2) };
}

function phyllotaxis(density) {
  const count = clamp(density, 1, 6) * 150;
  const GOLDEN = 2.39996323;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const r = 0.55 * Math.sqrt(i / count);
    pts.push([Math.cos(i * GOLDEN) * r, 0, Math.sin(i * GOLDEN) * r]);
  }
  const L = new Lines(2);
  for (let i = 0; i < count; i++) for (const step of [8, 13, 21]) if (i + step < count) L.seg(pts[i], pts[i + step], 0, 0, i % 21, 2, 0.003);
  const lines = L.out();
  radialDepth(lines);
  return { lines, points: fuzzFrom(L, 2500, 0.01, 3) };
}

function radialDepth(g) {
  let max = 1e-6;
  const n = g.pos.length / 3;
  const d = new Array(n);
  for (let i = 0; i < n; i++) { d[i] = Math.hypot(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]); max = Math.max(max, d[i]); }
  g.depth = d.map((v) => v / max);
}

// Sea urchin: golden-spiral sphere, long forked spines in strands, glowing lattice core.
function urchin(density) {
  const rng = mulberry32(11);
  const n = 70 + clamp(density, 2, 6) * 34;
  const r0 = 0.16;
  const GOLDEN = 2.39996323;
  const L = new Lines(3);
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - y * y), th = i * GOLDEN;
    dirs.push([Math.cos(th) * rr, y, Math.sin(th) * rr]);
  }
  for (const d of dirs) {
    const len = 0.16 + rng() * rng() * 0.5;
    L.seg(mul(d, r0), mul(d, r0 + len), 0, 1, L.id, 3, 0.006);
    const m = mul(d, r0 + len * 0.78);
    for (let s = 0; s < 3; s++) {
      const ang = (s / 3) * TAU + rng();
      const side = [Math.cos(ang), Math.sin(ang * 1.7), Math.sin(ang)];
      L.seg(m, add(mul(d, r0 + len * 1.08), mul(side, 0.045)), 0.85, 1, L.id, 2, 0.004);
    }
    L.next();
  }
  for (let i = 0; i < n; i++) for (const step of [3, 5, 8, 13]) if (i + step < n) L.seg(mul(dirs[i], r0), mul(dirs[i + step], r0), 0, 0, i, 2, 0.003);
  return { lines: L.out(), points: fuzzFrom(L, 5000, 0.03, 4) };
}

// Butterfly: Temple Fay's curve as nested contour layers plus veins; folds on bass.
function butterfly(density) {
  const layers = 3 + clamp(density, 2, 6);
  const N = 260, scale = 0.115;
  const L = new Lines(3);
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
      if (prev) L.seg(prev, p, depth, depth, k * 100 + Math.floor(i / 5), 3, 0.004);
      prev = p;
    }
  }
  for (let i = 0; i < 90; i++) {
    const [x, y] = pt((i / 90) * 12 * Math.PI);
    L.seg([0, 0, 0], [x * scale, y * scale, 0], 0, 1, 5000 + i, 2, 0.003);
  }
  return { lines: L.out(), points: fuzzFrom(L, 6000, 0.012, 5) };
}

// Iso-line blob: a bilaterally symmetric bulb, solid black with neon contour bands (Rorschach-like).
// Mirror symmetry in x: the radius uses only cosines of the angle measured from the +Z axis.
export function blobPoint(h, th) {
  const bulb = Math.sin(Math.PI * clamp(h, 0, 1)) ** 0.7;
  const R = 0.04 + 0.46 * bulb;
  const lobe = 0.38 * Math.sin(h * 7) * bulb;
  const w = 1 + 0.32 * Math.cos(2 * th) + 0.2 * Math.cos(3 * th) + lobe * Math.cos(5 * th) + 0.12 * Math.cos(th);
  const r = R * w;
  return [Math.sin(th) * r, (h - 0.5) * 0.95, Math.cos(th) * r * 0.55];
}

function contourBlob(density) {
  const NT = 72 + clamp(density, 2, 6) * 8, NH = 60 + clamp(density, 2, 6) * 6;
  const M = newMesh();
  for (let iy = 0; iy <= NH; iy++) {
    const h = iy / NH;
    for (let ix = 0; ix <= NT; ix++) {
      const th = (ix / NT) * TAU;
      const p = blobPoint(h, th);
      const e = 1e-3;
      const dth = sub(blobPoint(h, th + e), blobPoint(h, th - e));
      const dh = sub(blobPoint(clamp(h + e, 0, 1), th), blobPoint(clamp(h - e, 0, 1), th));
      let n = norm(cross(dth, dh));
      if (dot(n, [p[0], 0, p[2]]) < 0) n = mul(n, -1);
      M.pos.push(...p); M.nrm.push(...n); M.t.push(h); M.ang.push(ix / NT); M.limb.push(0);
    }
  }
  for (let iy = 0; iy < NH; iy++) for (let ix = 0; ix < NT; ix++) {
    const a = iy * (NT + 1) + ix, b = a + 1, c = a + NT + 1, d = c + 1;
    M.idx.push(a, c, b, b, c, d);
  }
  return { mesh: M, points: flakes(mulberry32(8), 120, 0.9) };
}

// Banded creature: torso + mirrored legs and arms as ribbed tubes, black body with neon stripes.
function bandedCreature(density) {
  const rng = mulberry32(21);
  const M = newMesh();
  const J = 10, steps = 22 + clamp(density, 2, 6) * 3;
  addTube(M, line3([0, -0.12, 0], [0, 0.42, 0], 12), (t) => 0.035 + 0.1 * Math.sin(Math.PI * (0.12 + 0.76 * t)) ** 0.8, J, 0);
  const armPairs = 2 + Math.floor(clamp(density, 2, 6) / 2);
  const specs = [];
  specs.push({ base: [0.05, -0.1, 0], dir: [0.55, -0.8, 0.2], len: 0.64, curl: [0.01, 0.05, -0.02], r0: 0.062 }); // legs
  specs.push({ base: [0.05, -0.08, 0], dir: [0.3, -0.9, -0.3], len: 0.66, curl: [0.0, 0.04, 0.02], r0: 0.056 });
  for (let i = 0; i < armPairs; i++) {
    const a = (i / armPairs) * 1.6 - 0.2;
    specs.push({ base: [0.06, 0.3 + i * 0.03, 0], dir: [0.9 - a * 0.4, 0.5 + a * 0.9, 0.5 * Math.sin(i * 2.1)], len: 0.62 + rng() * 0.35, curl: [-0.02, 0.06 + rng() * 0.04, 0.03 * (rng() - 0.5)], r0: 0.05 });
  }
  let id = 1;
  for (const s of specs) {
    const spine = limbSpine(rng, s.base, s.dir, s.len, steps, s.curl);
    const radius = (t) => s.r0 * (1 - 0.8 * t) * (1 + 0.2 * Math.sin(t * 22));
    addTube(M, spine, radius, J, id++);
    addTube(M, spine.map(mirrorX), radius, J, id++);
  }
  return { mesh: M, points: flakes(rng, 140, 1.0, [0, 0.2, 0]) };
}

// Ink spider: thin jointed legs and a small body, black with a white rim and no stripes.
function inkSpider(density) {
  const rng = mulberry32(77);
  const M = newMesh();
  const J = 8;
  // body: a small vertical bulb (a tube along the view axis would show only its rim)
  addTube(M, line3([0, -0.3, 0], [0, -0.08, 0], 12), (t) => 0.02 + 0.1 * Math.sin(Math.PI * t) ** 0.8, 14, 0);
  const pairs = 3 + Math.floor(clamp(density, 2, 6) / 2);
  let id = 1;
  for (let i = 0; i < pairs; i++) {
    const z = -0.3 + (0.6 * i) / (pairs - 1);
    const base = [0.05, -0.17, z * 0.25];
    const knee = [0.32 + 0.1 * rng(), 0.05 + 0.1 * rng(), z * 0.9];
    const foot = [0.7 + 0.15 * rng(), -0.62, z * 1.5];
    const spine = catmull([base, knee, foot], 12);
    const radius = (t) => 0.024 * (1 - 0.65 * t);
    addTube(M, spine, radius, J, id++);
    addTube(M, spine.map(mirrorX), radius, J, id++);
  }
  return { mesh: M, points: flakes(rng, 40, 0.8, [0, -0.2, 0]) };
}

// Ink splatter: curved streaks with drops, thrown outward and drooping.
function splatter(density) {
  const rng = mulberry32(5);
  const M_ = 50 + clamp(density, 2, 6) * 22;
  const L = new Lines(3);
  for (let i = 0; i < M_; i++) {
    const u = rng() * 2 - 1, th = rng() * TAU, rr = Math.sqrt(1 - u * u);
    const dir = [Math.cos(th) * rr, u * 0.7, Math.sin(th) * rr];
    const len = 0.12 + rng() ** 2 * 0.55;
    const segs = 5;
    let prev = [0, 0, 0];
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const p = [dir[0] * len * t, dir[1] * len * t - 0.35 * len * t * t, dir[2] * len * t];
      L.seg(prev, p, (s - 1) / segs, t, i, 3, 0.004);
      prev = p;
    }
    L.seg(prev, [prev[0] + dir[0] * 0.035, prev[1] - 0.02, prev[2] + dir[2] * 0.035], 1, 1, i, 2, 0.003);
    L.next();
  }
  return { lines: L.out(), points: fuzzFrom(L, 4000, 0.03, 6) };
}

// Dashed ring with a three-petal rose and a concentric eye (flat, faces the viewer).
function ringMandala(density) {
  const L = new Lines(3);
  const dashes = 36 + clamp(density, 2, 6) * 6;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * TAU, a1 = a0 + (TAU / dashes) * 0.55, R = 0.62;
    L.seg([Math.cos(a0) * R, 0, Math.sin(a0) * R], [Math.cos(a1) * R, 0, Math.sin(a1) * R], 1, 1, i, 3, 0.004);
  }
  const steps = 160;
  for (const [petals, size, base] of [[3, 0.46, 0.35], [3, 0.3, 0.7]]) {
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * TAU, r = size * Math.cos(petals * th);
      const p = [Math.cos(th) * r, 0, Math.sin(th) * r];
      if (prev) L.seg(prev, p, base, base, 200 + (i >> 3), 3, 0.004);
      prev = p;
    }
  }
  for (const [r, d] of [[0.05, 0], [0.09, 0.1], [0.14, 0.2]]) {
    let prev = null;
    for (let i = 0; i <= 28; i++) {
      const th = (i / 28) * TAU, p = [Math.cos(th) * r, 0, Math.sin(th) * r];
      if (prev) L.seg(prev, p, d, d, 500 + i, 2, 0.002);
      prev = p;
    }
  }
  return { lines: L.out(), points: fuzzFrom(L, 3000, 0.012, 7) };
}

// stripe: [bands per unit t, scroll speed, spiral twist, rim gain]; rim only when bands = 0
export const GENERATORS = [
  { name: 'Criatura de bandas', build: bandedCreature, mode: 'upright', palette: 6, size: 6, stripe: [16, 0.5, 0.0, 0.6], dance: true, glow: 0 },
  { name: 'Araña de tinta', build: inkSpider, mode: 'upright', palette: 5, size: 6, stripe: [0, 0, 0, 1.4], dance: true, glow: 0 },
  { name: 'Mancha de curvas de nivel', build: contourBlob, mode: 'upright', palette: 4, size: 6, stripe: [14, 0.25, 0.0, 0.5], glow: 0 },
  { name: 'Erizo de mar', build: urchin, mode: 'upright', palette: 3, size: 6 },
  { name: 'Mariposa de contornos', build: butterfly, mode: 'upright', palette: 1, wing: true, sway: true, size: 8 },
  { name: 'Salpicadura de tinta', build: splatter, mode: 'upright', palette: 5, size: 7 },
  { name: 'Anillo punteado', build: ringMandala, mode: 'facing', palette: 5, size: 9 },
  { name: 'Mandala radial', build: radialMandala, mode: 'facing', palette: 0, size: 10 },
  { name: 'Tetraedro de Sierpinski', build: sierpinski, mode: 'upright', palette: 3, size: 8 },
  { name: 'Red de filotaxis', build: phyllotaxis, mode: 'facing', palette: 2, size: 8 },
];

// lowest point of a figure in its own space (to stand it on the ground)
export function minY(fig) {
  let m = Infinity;
  for (const part of [fig.lines, fig.mesh]) {
    if (!part) continue;
    for (let i = 1; i < part.pos.length; i += 3) m = Math.min(m, part.pos[i]);
  }
  return Number.isFinite(m) ? m : 0;
}

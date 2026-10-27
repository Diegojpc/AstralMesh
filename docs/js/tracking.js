// Fallback camera tracking (used when the SLAM engine is unavailable): gyroscope on phones and,
// with no motion sensors, a visual rotation tracker. Both give rotation only (no parallax).

import * as THREE from '../vendor/three.module.min.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Cameras report roughly 65 degrees across the long side of the picture.
const VIDEO_LONG_SIDE_FOV = 65 * (Math.PI / 180);
export function videoFocalPx(video) {
  const long = Math.max(video.videoWidth, video.videoHeight);
  return long / 2 / Math.tan(VIDEO_LONG_SIDE_FOV / 2);
}

// ---------------------------------------------------------------- gyroscope

export class GyroPose {
  constructor(camera, onFirstPose) {
    this.camera = camera;
    this.onFirstPose = onFirstPose;
    this.active = false;
    this.placed = false;
    this.euler = new THREE.Euler();
    this.q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    this.q0 = new THREE.Quaternion();
    this.zee = new THREE.Vector3(0, 0, 1);
    this.handler = (e) => this.onOrientation(e);
  }

  onOrientation(e) {
    if (e.alpha == null) return;
    const rad = Math.PI / 180;
    const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * rad;
    this.euler.set(e.beta * rad, e.alpha * rad, -e.gamma * rad, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.quaternion.multiply(this.q1);
    this.camera.quaternion.multiply(this.q0.setFromAxisAngle(this.zee, -orient));
    this.active = true;
    if (!this.placed) { this.placed = true; this.onFirstPose?.(); }
  }

  async enable() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission(); // iOS: must be called from a user gesture
      if (res !== 'granted') return false;
    }
    window.addEventListener('deviceorientation', this.handler, true);
    return true;
  }
}

// ---------------------------------------------------------------- visual tracker
// Block-match a grid of textured patches between consecutive frames, fit a similarity transform
// (shift, zoom, roll) to the flow, and turn the shift into yaw/pitch with the video's focal length.

export class VisualTracker {
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
        const fl = videoFocalPx(this.video);
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

export function solveSimilarity(pts) {
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

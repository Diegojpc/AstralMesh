// Estimates where the scene's main light is, from the camera image alone.
//
// Street lamps are the brightest, smallest blobs in the upper part of the frame. We find one,
// turn its pixel into a direction in world space with the camera pose, and keep it: a lamp does
// not move when the camera does, so the shadow direction stays put while you walk around.
// This is a monocular estimate (one dominant light, no occlusion), not a model of the scene.

import * as THREE from '../vendor/three.module.min.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// video pixel (u,v in 0..1) -> normalized device coords, for a video shown with object-fit: cover
export function coverMapper(vw, vh, sw, sh) {
  const scale = Math.max(sw / vw, sh / vh);
  const ox = (vw * scale - sw) / 2, oy = (vh * scale - sh) / 2;
  return (u, v) => ({ x: ((u * vw * scale - ox) / sw) * 2 - 1, y: -(((v * vh * scale - oy) / sh) * 2 - 1) });
}

export class LightEstimator {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.dir = new THREE.Vector3(0.25, 0.9, 0.35).normalize();   // towards the light, world space
    this.target = this.dir.clone();
    this.strength = 0.35;
    this.targetStrength = 0.35;
    this.ambient = 0.1;
    this.found = false;       // a lamp has been seen at least once
    this.lamp = null;         // last blob, for the on-screen readout
    this.last = 0;
    this.enabled = true;
  }

  // grayscale frame (0..255) of the video, longest side `maxSide`
  frameFromVideo(video, maxSide = 96) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return null;
    const s = maxSide / Math.max(vw, vh);
    const w = Math.max(16, Math.round(vw * s)), h = Math.max(16, Math.round(vh * s));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.drawImage(video, 0, 0, w, h);
    const d = this.ctx.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return { data, w, h };
  }

  // frame: {data,w,h}; toNdc(u,v)->{x,y}; camera: THREE.PerspectiveCamera with an up-to-date world matrix
  analyse(frame, toNdc, camera) {
    const { data, w, h } = frame;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    this.ambient = sum / data.length / 255;

    const rows = Math.floor(h * 0.62); // lamps sit in the upper part of the picture
    let max = 0;
    for (let i = 0; i < rows * w; i++) if (data[i] > max) max = data[i];
    this.lamp = null;
    if (max < 205) return false;

    const thr = max - 20;
    let cx = 0, cy = 0, area = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) if (data[y * w + x] >= thr) { cx += x; cy += y; area++; }
    if (!area || area > w * h * 0.04) return false; // a lamp is small; a big bright region is a wall or the sky
    cx /= area; cy /= area;

    const n = toNdc((cx + 0.5) / w, (cy + 0.5) / h);
    const ray = new THREE.Vector3(n.x, n.y, 0.5).unproject(camera).sub(camera.position).normalize();
    this.lamp = { x: n.x, y: n.y, area };
    if (ray.y < 0.06) return false; // below the horizon: a reflection or a car light, not a lamp
    this.target.copy(ray);
    this.targetStrength = clamp(0.55 + (area / (w * h)) * 25, 0.55, 1);
    this.found = true;
    return true;
  }

  // getFrame() is only called when an analysis is due (every ~0.3 s), so grabbing pixels stays cheap
  update(dt, getFrame, toNdc, camera, now) {
    if (this.enabled && now - this.last > 300) {
      const frame = getFrame();
      if (frame) { this.last = now; this.analyse(frame, toNdc(), camera); }
    }
    if (!this.found) this.targetStrength = 0.3;
    const a = 1 - 0.9 ** (dt * 60 * 0.4);
    this.dir.lerp(this.target, a).normalize();
    this.strength += (this.targetStrength - this.strength) * a;
  }
}

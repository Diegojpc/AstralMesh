// World tracking with the 8th Wall engine (SLAM, 6 degrees of freedom).
//
// The engine binary is loaded from the official npm package on jsDelivr (pinned, with an
// integrity hash) and is used unmodified under its XR Engine License Agreement
// (https://github.com/8thwall/engine/blob/main/LICENSE). It is closed source; this file only
// calls its public API. If the engine is missing, unsupported or does not start in time,
// startSlam() resolves null and the app keeps using its own rotation-only tracking.

const START_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 4000;

function whenXR8(ms) {
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    window.addEventListener('xrloaded', () => { clearTimeout(t); resolve(window.XR8); }, { once: true });
  });
}

// iOS asks for motion access with a prompt that must come from a user gesture
async function motionPermission() {
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') return (await DME.requestPermission()) === 'granted';
  return true;
}

/**
 * @param {object} o
 * @param {number} o.cameraY      starting camera height in metres (the floor is assumed below it)
 * @param {(h: object) => void} o.onReady   called once, with the handle, when tracking is running
 * @param {(args: object) => void} o.onUpdate  called every frame, before the engine renders
 * @param {(e: unknown) => void} [o.onError]  runtime errors after a successful start
 * @returns {Promise<object|null>} handle {canvas, scene, camera, renderer, hitTest, recenter, stop} or null
 */
export async function startSlam(o) {
  const XR8 = await whenXR8(LOAD_TIMEOUT_MS);
  if (!XR8 || !XR8.XrController || !XR8.Threejs) return null;
  if (!window.THREE) return null; // the engine's three.js module needs the global
  try { if (!(await motionPermission())) return null; } catch { return null; }

  const canvas = document.createElement('canvas');
  canvas.id = 'xrcanvas';
  const sizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  };
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
  document.body.insertBefore(canvas, document.getElementById('hud'));

  XR8.XrController.configure({ scale: 'absolute' });

  return new Promise((resolve) => {
    let started = false;
    let handle = null;
    let lumaFrame = null;

    const cleanup = () => {
      window.removeEventListener('resize', sizeCanvas);
      try { XR8.stop(); } catch { /* not running */ }
      try { XR8.clearCameraPipelineModules(); } catch { /* ignore */ }
      canvas.remove();
    };
    const fail = (why) => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      console.warn('[AstralMesh] SLAM unavailable:', why);
      cleanup();
      resolve(null);
    };
    const timer = setTimeout(() => fail('timeout'), START_TIMEOUT_MS);

    const mod = {
      name: 'astralmesh',
      onStart: () => {
        try {
          const { scene, camera, renderer } = XR8.Threejs.xrScene();
          camera.position.set(0, o.cameraY, 0);
          XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
          handle = {
            canvas, scene, camera, renderer,
            // x,y in client pixels -> nearest surface hit (world position) or null
            hitTest(x, y) {
              try {
                const hits = XR8.XrController.hitTest(x / window.innerWidth, y / window.innerHeight, ['DETECTED_SURFACE', 'ESTIMATED_SURFACE']);
                const best = hits.find((h) => h.type === 'DETECTED_SURFACE') || hits.find((h) => h.type === 'ESTIMATED_SURFACE');
                return best ? best.position : null;
              } catch { return null; }
            },
            recenter() { XR8.XrController.recenter(); camera.position.set(0, o.cameraY, 0); },
            lumaFrame: () => lumaFrame,
            stop: cleanup,
          };
          started = true;
          clearTimeout(timer);
          resolve(handle);
          o.onReady(handle);
        } catch (e) { fail(e); }
      },
      onUpdate: ({ processCpuResult } = {}) => {
        if (!handle) return;
        const px = processCpuResult?.camerapixelarray;
        if (px?.pixels && px.cols) lumaFrame = { data: px.pixels, w: px.cols, h: px.rows };
        o.onUpdate(handle);
      },
      onException: (e) => { if (!started) fail(e); else o.onError?.(e); },
    };

    try {
      const modules = [XR8.GlTextureRenderer.pipelineModule(), XR8.Threejs.pipelineModule(), XR8.XrController.pipelineModule()];
      if (XR8.CameraPixelArray) modules.push(XR8.CameraPixelArray.pipelineModule({ luminance: true, maxDimension: 96 }));
      modules.push(mod);
      XR8.addCameraPipelineModules(modules);
      XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
    } catch (e) { fail(e); }
  });
}

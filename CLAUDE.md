# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Unity 6000.3.27f1 + URP 17.3 + AR Foundation 6.7 (Android + iOS). Compiles, EditMode tests pass (4/4) and an Android APK builds. Not yet run on a device. iOS cannot be built on this Linux machine (needs Xcode on a Mac).

`Main.unity`, the URP asset, Bloom volume, material, palettes, PanelSettings, XR loader settings and Player settings are all **generated** by `Assets/Editor/SceneBuilder.cs` (idempotent; it deletes and recreates them). Change them there, not by hand in the editor, or the next run overwrites the change.

## Commands

`$UNITY` = `~/Unity/Hub/Editor/6000.3.27f1/Editor/Unity`. Run from the project root; always pass `-batchmode -nographics`. The editor must not be open on the same project.

- Regenerate scene and settings: `$UNITY -batchmode -nographics -quit -projectPath . -executeMethod SceneBuilder.Build`
- EditMode tests (omit `-quit`): `$UNITY -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults results.xml`
- Single test: add `-testFilter "OnsetDetectorTests.SuddenBassHit_TriggersKick"`
- Android APK: `$UNITY -batchmode -nographics -quit -projectPath . -buildTarget Android -executeMethod BuildScript.BuildAndroid` -> `Builds/AstralMesh.apk`
- iOS: `-executeMethod BuildScript.BuildIOS` only works on a Mac.
- Install and logs: `adb` is at `~/Unity/Hub/Editor/6000.3.27f1/Editor/Data/PlaybackEngines/AndroidPlayer/SDK/platform-tools/adb`; use `adb install -r Builds/AstralMesh.apk` and `adb logcat -s Unity`.
- Compile errors show up in the `-logFile` as `error CS`; pass `-logFile /tmp/x.log` and grep it.

## Environment gotchas (this machine)

- Unity Hub is a user Flatpak (`com.unity.UnityHub`). Its license lives in the Flatpak sandbox, so the editor (run on the host) needs `~/.var/app/com.unity.UnityHub/config/unity3d/Unity/licenses/UnityEntitlementLicense.xml` copied to `~/.config/unity3d/Unity/licenses/`. If batchmode reports `Access token is unavailable` / `com.unity.editor.headless was not found`, redo that copy after re-activating in the Hub.
- The Hub extracted the Android NDK flat, but its clang symlinks expect `NDK/android-ndk-r27c/`. A self-referencing symlink `NDK/android-ndk-r27c -> .` fixes `clang++: not found` during IL2CPP builds. Recreate it if the module is reinstalled.
- Android `minSdk` is 29: ARCore "Required" + Vulkan will not build below that.
- If the Hub GUI will not start with `bwrap: Can't find source path .../pkcs11-flatpak-N`, the Flatpak session helper's p11-kit socket is missing; start `p11-kit server --name <that path>` manually.

## Web version (docs/)

A separate port for phones that cannot run the Unity build (iPhone without a Mac or paid signing). Published with GitHub Pages from `docs/` at https://diegojpc.github.io/AstralMesh/ (public repo). No build step: edit and push to `main`. Plain ES modules, no bundler.

Layout: `docs/app.js` (orchestrator: scene, UI, touch, main loop) and `docs/js/`: `figures.js` (pure geometry, no DOM, unit-testable in Node), `shaders.js` (materials + GLSL), `audio.js` (`AudioEngine`), `lighting.js` (`LightEstimator`), `synth.js` (touch synth), `tracking.js` (gyro + `VisualTracker` fallback), `slam.js` (8th Wall world tracking). Three.js r160.1 is vendored in `docs/vendor/` (MIT).

- **Audio**: Web Audio `AnalyserNode` -> 3 bands -> level in dB against a slow moving average and the recent peak -> 0..1 (`AudioEngine.update`). Independent of mic gain (a fixed linear threshold left a laptop mic flat) and frame-rate independent (`k = dt * 60`). It deliberately differs from the Unity `AudioReactiveEngine`; keep band edges in sync.
- **Figures** follow @pseudohuasca (night-street AR creatures made with TouchDesigner/Blender/After Effects per its captions): solid creatures drawn **near-black with neon bands wrapping the limbs** plus a hard silhouette shadow, and line figures drawn as strand bundles plus a point haze. `GENERATORS` entries carry `mode` (`upright` stands on the floor facing the viewer; `facing` is flat and tilts at the viewer), default `palette`, point `size`, `stripe` [bands, speed, twist, rim], `dance`, `sway`, `glow`. Line strands are stored layer by layer so `setDrawRange` trims them for the adaptive quality governor (`applyQuality`).
- **Shadows**: the figure's displaced vertices are projected along the light direction onto the floor (`toGround` in `shaders.js`). Light direction comes from `LightEstimator`: the brightest small blob in the upper frame (a street lamp) turned into a world-space direction with the camera pose, then held fixed (lamps do not move with the camera). Floor height = camera start height minus the "Altura movil" slider, or the hit-test height after tapping the floor. Solid shadows need one even tone where projected triangles overlap: stencil in our own renderer, min-blending (`shadowMeshMin`) in the engine's renderer, which has no stencil.
- **World anchoring**: preferred is the 8th Wall engine (`slam.js`, 6DoF SLAM). It is loaded from jsDelivr (`@8thwall/engine-binary@1.0.0`, SRI-pinned in `index.html`), never modified, and is closed source under the XR Engine License Agreement (free use only, not for a paid product whose value comes from it; attribution is shown in the UI; the user accepted the terms). It needs `window.THREE`, owns the canvas, camera pose and render loop (`autoClear` off, so `slamUpdate` calls `clearStencil`), and starts only from a user tap. If it is missing, unsupported or silent for 10 s, the app falls back to `GyroPose` (phones) or `VisualTracker` (rotation only: block-matching + similarity fit; no parallax). Cannot be validated headlessly beyond "it loads and starts": real tracking needs a phone.
- **Touch loop**: touching the figure plays `Synth` notes; its output goes to the speaker and into the same analyser that animates the figure (compressor + gain cap; the mic is never played back). Tapping the floor places the figure.
- **iOS Safari rules**: `AudioContext` creation and the motion-permission prompt must happen synchronously inside the tap (`start()`); camera and mic need HTTPS.
- **Checks**: serve `docs/` with `python3 -m http.server`, drive it with `playwright-core` + the Chromium in `~/.cache/ms-playwright` (flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-angle=swiftshader --enable-unsafe-swiftshader`; grant `camera microphone accelerometer gyroscope magnetometer`, or `requestPermission` reads as denied). Override `getUserMedia` with a canvas stream to feed a synthetic night street, a panning texture (tracker test) or a moving lamp (light test). `window.__astral` exposes internals for these checks.

## Android emulator

AVD `astral_ar` (Android 14, x86_64, Google APIs) lives in `~/Android/Sdk` (separate from Unity's SDK; `emulator`, `platform-tools`, `cmdline-tools` installed there). Start with `~/Android/Sdk/emulator/emulator -avd astral_ar -gpu host`. Unity's ARCore plugin ships no x86_64 library, so the AR session cannot run there: build with `-executeMethod BuildScript.BuildAndroidEmulator` (x86_64, GLES3, XR init skipped) -> `Builds/AstralMesh-x86_64.apk`. That validates visuals, audio and UI only, never AR.

## Architecture

Per-frame data flow, in one direction:

`AudioSource` (mic loop clip or file clip) -> `AudioReactiveEngine` -> global shader vectors -> `MandalaWire.shader`

- `AudioReactiveEngine` runs at `[DefaultExecutionOrder(-100)]` so values are set before any renderer draws. It calls `GetSpectrumData` (1024 bins), splits into bass 20-250 Hz / mid 250-4k / high 4-16k via `BandExtractor`, applies peak-follower AutoGain and attack/release smoothing, and gets a `kick` impulse from `OnsetDetector` (spectral flux on the bass bins). It publishes `_Audio = (bass, mid, high, kick)` with `Shader.SetGlobalVector`.
- `ReactiveParameterBus` is the single write point for UI and gestures; each frame it publishes `_Params = (expand, twist, speed, deform)` and `_ColorA/_ColorB` (from `PaletteSO`) as shader globals.
- Geometry is built once on the CPU by an `IFractalGenerator` as a `MeshTopology.Lines` mesh and never rebuilt per frame. `uv2` carries (normalized depth, ring index, node id); the shader animates by depth, so the kick wave travels from center outward. Changing geometry or density rebuilds the mesh; density is committed only on slider release (`CommitDensity`).
- Audio mapping lives in the vertex shader: bass scales radius, kick drives the depth wave, mid drives twist and deformation, high drives emissive shimmer. The material is additive (`Blend One One`), so Bloom in the URP Volume produces the neon glow over the AR camera background.
- Mic input must stay audible to the `AudioSource` for `GetSpectrumData` to see signal. `AudioInputController` silences it with `AudioListener.volume = 0` (spectrum is read at the source); the source's own `mute`/`volume` must stay untouched. Unverified on device.
- `ControlPanel` builds its UI Toolkit tree in code, so there is no UXML to keep in sync.
- `Runtime` is one asmdef (`AstralMesh.Runtime`); EditMode tests are in `AstralMesh.Tests`. Editor code (`SceneBuilder`, `BuildScript`) is in `Assets/Editor` under the `AstralMesh.Editor` asmdef; new types it uses must be added to that asmdef's references.

## Platform notes

- Android needs the `CAMERA` and `RECORD_AUDIO` permissions; the mic is requested at runtime in `MicrophoneProvider`.
- iOS needs `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` in Player Settings.
- File input uses `NativeFilePicker` (UPM git package). On iOS it only works when signed with a paid Apple Developer account.

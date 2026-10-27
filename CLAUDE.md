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

A separate, dependency-free port for phones that cannot run the Unity build (iPhone without a Mac/paid signing). Published with GitHub Pages from `docs/` at https://diegojpc.github.io/AstralMesh/ (public repo). No build step: edit `docs/app.js`, `docs/index.html`, `docs/style.css`, push to `main`.

- `docs/app.js` follows the Unity pipeline (Web Audio `AnalyserNode` -> 3 bands -> shader uniforms `uAudio`/`uParams` -> GLSL port of `MandalaWire.shader`), but the level mapping differs on purpose: it works in dB against a slow moving average and the recent peak (`AudioEngine.update`), so it is independent of mic gain; a fixed linear threshold left a laptop mic almost flat. Smoothing is frame-rate independent (`k = dt * 60`). Keep band edges and shader math in sync with `AudioReactiveEngine.cs` / `MandalaWire.shader` where they overlap.
- Figures follow the look of @pseudohuasca (night-street AR creatures: urchin, butterfly, rainbow iso-line blob, ink splatter, dashed ring). `GENERATORS` entries carry `mode` (`upright` creatures stand vertical and face the viewer; `facing` flat figures tilt their normal at the viewer), a default `palette`, point `size`, and `sway` (flat creatures sway instead of spinning so they are never edge-on). Rainbow palette is a shader flag (`uRainbow`).
- World anchoring: with gyro (phones) `onOrientation` drives the camera; without it (desktop) `VisualTracker` estimates camera rotation from the video by block-matching patches and fitting a similarity transform, converted to yaw/pitch/roll with the video focal length (65 deg across the long side assumed). It is rotation only: no parallax when walking. `updateFov` keeps the 3D camera FOV registered with the `object-fit: cover` video. A ground shadow is the same displaced vertices flattened to `uGround`.
- Three.js is vendored in `docs/vendor/` (v0.160.1, MIT) so the page has no CDN dependency. The canvas is premultiplied-alpha over a `<video>` camera feed, so fragment alpha must follow brightness (alpha 1 on dark pixels paints black squares).
- iOS Safari rules: `AudioContext` creation/resume and `DeviceOrientationEvent.requestPermission()` must happen synchronously inside the tap handler (`start()`); camera/mic need HTTPS. The mic is never routed to the speaker (feedback). iOS has no WebXR, so "AR" is camera passthrough plus gyro-anchored content (`recenter()`).
- `Demo` mode synthesizes a kick/pad/hi-hat loop so the visuals can be checked without a mic or file. `window.__astral` is a hook for headless checks.
- Local check: `python3 -m http.server` in `docs/`, then drive it with `playwright-core` + the Chromium in `~/.cache/ms-playwright`, flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-angle=swiftshader --enable-unsafe-swiftshader`, and grant `camera`, `microphone`, `accelerometer`, `gyroscope`, `magnetometer` (without the motion permissions `requestPermission` reads as denied).

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

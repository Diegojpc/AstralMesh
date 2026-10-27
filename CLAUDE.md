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

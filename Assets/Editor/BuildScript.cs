using UnityEditor;
using UnityEditor.XR.Management;
using UnityEngine.XR.Management;
using UnityEngine;
using UnityEngine.Rendering;

public static class BuildScript
{
    static readonly string[] Scenes = { "Assets/AstralMesh/Scenes/Main.unity" };

    public static void BuildAndroid() => Build(BuildTarget.Android, "Builds/AstralMesh.apk");
    public static void BuildIOS() => Build(BuildTarget.iOS, "Builds/iOS");

    // The Android emulator is x86_64 and handles GLES3 more reliably than Vulkan, so build a
    // separate APK for it and put the player settings back so phone builds are unaffected.
    public static void BuildAndroidEmulator()
    {
        var arch = PlayerSettings.Android.targetArchitectures;
        var useDefault = PlayerSettings.GetUseDefaultGraphicsAPIs(BuildTarget.Android);
        var apis = PlayerSettings.GetGraphicsAPIs(BuildTarget.Android);

        // Unity's ARCore plugin ships no x86_64 native library, so the AR session cannot start on
        // the emulator. Skip XR init for this build: visuals, audio and UI still run without AR.
        XRGeneralSettings xr = null;
        bool xrInit = false;
        if (EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget perTarget))
        {
            xr = perTarget.SettingsForBuildTarget(BuildTargetGroup.Android);
            if (xr != null) { xrInit = xr.InitManagerOnStart; xr.InitManagerOnStart = false; }
        }
        try
        {
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.X86_64;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.OpenGLES3 });
            Build(BuildTarget.Android, "Builds/AstralMesh-x86_64.apk");
        }
        finally
        {
            if (xr != null) xr.InitManagerOnStart = xrInit;
            PlayerSettings.Android.targetArchitectures = arch;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, useDefault);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, apis);
        }
    }

    static void Build(BuildTarget target, string path)
    {
        var report = BuildPipeline.BuildPlayer(Scenes, path, target, BuildOptions.None);
        if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
        {
            Debug.LogError($"Build failed: {report.summary.result}");
            EditorApplication.Exit(1);
        }
    }
}

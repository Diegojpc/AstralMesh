using UnityEditor;
using UnityEngine;

public static class BuildScript
{
    static readonly string[] Scenes = { "Assets/AstralMesh/Scenes/Main.unity" };

    public static void BuildAndroid() => Build(BuildTarget.Android, "Builds/AstralMesh.apk");
    public static void BuildIOS() => Build(BuildTarget.iOS, "Builds/iOS");

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

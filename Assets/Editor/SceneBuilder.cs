using System.IO;
using AstralMesh.AR;
using AstralMesh.Audio;
using AstralMesh.Control;
using AstralMesh.Geometry;
using AstralMesh.UI;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;
using UnityEngine.XR.Management;
using UnityEngine.XR.ARFoundation;

/// <summary>Generates every asset and the Main scene. Idempotent: run again to rebuild from scratch.</summary>
public static class SceneBuilder
{
    const string Root = "Assets/AstralMesh";
    const string ScenePath = Root + "/Scenes/Main.unity";
    // same order as PALETTES in docs/app.js and the Palette index of each FigureDef
    static readonly string[] PaletteNames = { "NeonMagentaGreen", "MagentaCyan", "ElectricPink", "ToxicGreen", "NeonRainbow", "InkWhite", "GreenMagentaBlue" };
    // line, points, flakes, solid body, then the three shadow variants
    static readonly string[] MaterialNames = { "MandalaWire", "MandalaPoints", "MandalaFlakes", "MandalaBody", "ShadowBody", "ShadowLines", "ShadowPoints" };

    [MenuItem("AstralMesh/Build Scene and Settings")]
    public static void Build()
    {
        Directory.CreateDirectory(Root + "/Scenes");
        Directory.CreateDirectory(Root + "/Settings/Palettes");
        Directory.CreateDirectory(Root + "/Materials");

        SetupPlayerSettings();
        SetupXR();
        var volumeProfile = SetupURP();
        CreateMaterials();
        var palettes = CreatePalettes();
        var panelSettings = CreatePanelSettings();
        CreateScene(volumeProfile, palettes, panelSettings);

        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log("[AstralMesh] Scene and settings built.");
    }

    static void SetupPlayerSettings()
    {
        PlayerSettings.companyName = "AstralMesh";
        PlayerSettings.productName = "AstralMesh";
        PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.diego.astralmesh");
        PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.iOS, "com.diego.astralmesh");
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;

        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.Android,
            new[] { UnityEngine.Rendering.GraphicsDeviceType.Vulkan, UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3 });

        PlayerSettings.iOS.targetOSVersionString = "15.0";
        PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;
        PlayerSettings.iOS.appleEnableAutomaticSigning = false;
        PlayerSettings.iOS.cameraUsageDescription = "AstralMesh uses the camera to show the mandala in augmented reality.";
        PlayerSettings.iOS.microphoneUsageDescription = "AstralMesh listens to audio to animate the mandala.";

        // Enable both the legacy and new input backends: EnhancedTouch needs the new one.
        var ps = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
        var handler = ps.FindProperty("activeInputHandler");
        if (handler != null) { handler.intValue = 2; ps.ApplyModifiedPropertiesWithoutUndo(); }
    }

    static void SetupXR()
    {
        Directory.CreateDirectory("Assets/XR");
        if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget perTarget))
        {
            perTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
            AssetDatabase.CreateAsset(perTarget, "Assets/XR/XRGeneralSettings.asset");
            EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, perTarget, true);
        }
        Assign(perTarget, BuildTargetGroup.Android, "UnityEngine.XR.ARCore.ARCoreLoader");
        Assign(perTarget, BuildTargetGroup.iOS, "UnityEngine.XR.ARKit.ARKitLoader");
        EditorUtility.SetDirty(perTarget);
    }

    static void Assign(XRGeneralSettingsPerBuildTarget perTarget, BuildTargetGroup group, string loader)
    {
        if (perTarget.SettingsForBuildTarget(group) == null) perTarget.CreateDefaultSettingsForBuildTarget(group);
        var general = perTarget.SettingsForBuildTarget(group);
        if (general.AssignedSettings == null) perTarget.CreateDefaultManagerSettingsForBuildTarget(group);
        general = perTarget.SettingsForBuildTarget(group);
        general.InitManagerOnStart = true;
        if (!XRPackageMetadataStore.AssignLoader(general.AssignedSettings, loader, group))
            Debug.LogError($"[AstralMesh] Could not assign XR loader {loader} for {group}");
    }

    static VolumeProfile SetupURP()
    {
        var rendererPath = Root + "/Settings/AstralRenderer.asset";
        var assetPath = Root + "/Settings/AstralURP.asset";
        AssetDatabase.DeleteAsset(rendererPath);
        AssetDatabase.DeleteAsset(assetPath);

        var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
        AssetDatabase.CreateAsset(rendererData, rendererPath);

        // AR camera background needs its renderer feature in URP.
        var feature = ScriptableObject.CreateInstance<ARBackgroundRendererFeature>();
        feature.name = "AR Background";
        AssetDatabase.AddObjectToAsset(feature, rendererData);
        AssetDatabase.TryGetGUIDAndLocalFileIdentifier(feature, out _, out long localId);
        var so = new SerializedObject(rendererData);
        var features = so.FindProperty("m_RendererFeatures");
        var map = so.FindProperty("m_RendererFeatureMap");
        features.arraySize++; features.GetArrayElementAtIndex(features.arraySize - 1).objectReferenceValue = feature;
        map.arraySize++; map.GetArrayElementAtIndex(map.arraySize - 1).longValue = localId;
        so.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(rendererData);

        var urp = UniversalRenderPipelineAsset.Create(rendererData);
        AssetDatabase.CreateAsset(urp, assetPath);
        GraphicsSettings.defaultRenderPipeline = urp;
        for (int i = 0; i < QualitySettings.names.Length; i++)
        {
            QualitySettings.SetQualityLevel(i, false);
            QualitySettings.renderPipeline = urp;
        }

        var profilePath = Root + "/Settings/AstralVolume.asset";
        AssetDatabase.DeleteAsset(profilePath);
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, profilePath);
        var bloom = profile.Add<Bloom>(true);
        bloom.intensity.Override(1.4f);
        bloom.threshold.Override(0.9f);
        bloom.scatter.Override(0.7f);
        EditorUtility.SetDirty(profile);
        return profile;
    }

    static void CreateMaterials()
    {
        Material Make(string name, string shaderName, System.Action<Material> setup = null)
        {
            var path = $"{Root}/Materials/{name}.mat";
            AssetDatabase.DeleteAsset(path);
            var shader = Shader.Find(shaderName);
            if (shader == null) throw new System.Exception($"Shader {shaderName} not found");
            var mat = new Material(shader) { name = name };
            setup?.Invoke(mat);
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }
        Make("MandalaWire", "AstralMesh/MandalaWire");
        Make("MandalaPoints", "AstralMesh/MandalaWire", m => m.SetFloat("_PointSize", 6f));
        Make("MandalaFlakes", "AstralMesh/MandalaWire", m => { m.SetFloat("_PointSize", 6f); m.SetFloat("_Flake", 1f); });
        Make("MandalaBody", "AstralMesh/MandalaBody");
        // solid shadow: stencil NotEqual / Replace so overlapping projected triangles darken once
        Make("ShadowBody", "AstralMesh/MandalaShadow", m => { m.SetFloat("_Kind", 1f); m.SetFloat("_Alpha", 0.6f); m.SetFloat("_StencilComp", 6f); m.SetFloat("_StencilPass", 2f); });
        Make("ShadowLines", "AstralMesh/MandalaShadow", m => { m.SetFloat("_Kind", 0f); m.SetFloat("_Alpha", 0.35f); });
        Make("ShadowPoints", "AstralMesh/MandalaShadow", m => { m.SetFloat("_Kind", 2f); m.SetFloat("_Alpha", 0.3f); m.SetFloat("_PointSize", 8f); });
    }

    static PaletteSO[] CreatePalettes()
    {
        (string name, Color a, Color b, Color c, bool rainbow)[] defs =
        {
            ("NeonMagentaGreen", new Color(1f, 0f, 0.8f) * 2f, new Color(0.1f, 1f, 0.3f) * 2f, new Color(0.1f, 0.4f, 1f) * 2f, false),
            ("MagentaCyan",      new Color(1f, 0.1f, 0.75f) * 2f, new Color(0f, 0.9f, 1f) * 2f, new Color(1f, 0.9f, 0.1f) * 2f, false),
            ("ElectricPink",     new Color(1f, 0.1f, 0.5f) * 2f, new Color(0.9f, 0.2f, 1f) * 2f, new Color(0.5f, 0.3f, 1f) * 2f, false),
            ("ToxicGreen",       new Color(0.2f, 1f, 0.4f) * 2f, new Color(0f, 0.9f, 1f) * 2f, new Color(0.7f, 1f, 0.2f) * 2f, false),
            ("NeonRainbow",      Color.white * 2f, Color.white * 2f, Color.white * 2f, true),
            ("InkWhite",         Color.white * 2f, new Color(0.55f, 0.85f, 1f) * 2f, new Color(0.8f, 0.9f, 1f) * 2f, false),
            ("GreenMagentaBlue", new Color(0.15f, 1f, 0.25f) * 2f, new Color(1f, 0.1f, 0.8f) * 2f, new Color(0.1f, 0.4f, 1f) * 2f, false),
        };
        var list = new PaletteSO[defs.Length];
        for (int i = 0; i < defs.Length; i++)
        {
            var path = $"{Root}/Settings/Palettes/{defs[i].name}.asset";
            AssetDatabase.DeleteAsset(path);
            var p = ScriptableObject.CreateInstance<PaletteSO>();
            p.colorA = defs[i].a; p.colorB = defs[i].b; p.colorC = defs[i].c; p.rainbow = defs[i].rainbow;
            AssetDatabase.CreateAsset(p, path);
            list[i] = p;
        }
        return list;
    }

    static PanelSettings CreatePanelSettings()
    {
        var path = Root + "/Settings/PanelSettings.asset";
        AssetDatabase.DeleteAsset(path);
        var ps = ScriptableObject.CreateInstance<PanelSettings>();
        ps.scaleMode = PanelScaleMode.ScaleWithScreenSize;
        ps.referenceResolution = new Vector2Int(1080, 1920);
        ps.match = 0.5f;
        AssetDatabase.CreateAsset(ps, path);
        return ps;
    }

    static void CreateScene(VolumeProfile volumeProfile, PaletteSO[] palettes, PanelSettings panelSettings)
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // NewScene unloads unreferenced assets, so the instances passed in may now be destroyed.
        // Reload everything from disk before wiring it into the scene.
        AssetDatabase.SaveAssets();
        volumeProfile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(Root + "/Settings/AstralVolume.asset");
        var mats = new Material[MaterialNames.Length];
        for (int i = 0; i < mats.Length; i++) mats[i] = AssetDatabase.LoadAssetAtPath<Material>($"{Root}/Materials/{MaterialNames[i]}.mat");
        panelSettings = AssetDatabase.LoadAssetAtPath<PanelSettings>(Root + "/Settings/PanelSettings.asset");
        palettes = new PaletteSO[PaletteNames.Length];
        for (int i = 0; i < palettes.Length; i++)
            palettes[i] = AssetDatabase.LoadAssetAtPath<PaletteSO>($"{Root}/Settings/Palettes/{PaletteNames[i]}.asset");
        if (volumeProfile == null || panelSettings == null || System.Array.IndexOf(mats, null) >= 0 || System.Array.IndexOf(palettes, null) >= 0)
            throw new System.Exception("[AstralMesh] Failed to reload generated assets from disk");

        new GameObject("AR Session", typeof(ARSession));

        // XR Origin > Camera Offset > Main Camera
        var originGo = new GameObject("XR Origin", typeof(XROrigin), typeof(ARRaycastManager), typeof(ARPlaneManager), typeof(ARAnchorManager));
        var offset = new GameObject("Camera Offset");
        offset.transform.SetParent(originGo.transform, false);
        var camGo = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener),
            typeof(ARCameraManager), typeof(ARCameraBackground), typeof(TrackedPoseDriver));
        camGo.tag = "MainCamera";
        camGo.transform.SetParent(offset.transform, false);
        var cam = camGo.GetComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = Color.black;
        cam.nearClipPlane = 0.1f; cam.farClipPlane = 30f;
        cam.GetUniversalAdditionalCameraData().renderPostProcessing = true;

        var origin = originGo.GetComponent<XROrigin>();
        origin.Camera = cam;
        origin.CameraFloorOffsetObject = offset;
        origin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.Device;

        var driver = camGo.GetComponent<TrackedPoseDriver>();
        driver.positionInput = new InputActionProperty(new InputAction("Position", binding: "<HandheldARInputDevice>/devicePosition"));
        driver.rotationInput = new InputActionProperty(new InputAction("Rotation", binding: "<HandheldARInputDevice>/deviceRotation"));
        driver.trackingType = TrackedPoseDriver.TrackingType.RotationAndPosition;

        // Global post-processing volume (Bloom gives the neon glow)
        var volGo = new GameObject("Post Volume", typeof(Volume));
        var vol = volGo.GetComponent<Volume>();
        vol.isGlobal = true; vol.sharedProfile = volumeProfile;

        // Audio + parameters
        var systems = new GameObject("Systems", typeof(AudioSource), typeof(AudioReactiveEngine),
            typeof(AudioInputController), typeof(ReactiveParameterBus));
        var audioSource = systems.GetComponent<AudioSource>();
        audioSource.playOnAwake = false; audioSource.loop = true;
        SetRef(systems.GetComponent<AudioReactiveEngine>(), "source", audioSource);
        SetRef(systems.GetComponent<AudioInputController>(), "source", audioSource);
        var bus = systems.GetComponent<ReactiveParameterBus>();
        SetRefArray(bus, "palettes", palettes);

        // Floor and light (ARCore planes and main-light estimate on a device; fixed values otherwise)
        var env = new GameObject("Environment", typeof(AstralEnvironment));
        var camMgr = camGo.GetComponent<ARCameraManager>();
        camMgr.requestedLightEstimation = LightEstimation.MainLightDirection | LightEstimation.MainLightIntensity;
        SetRef(env.GetComponent<AstralEnvironment>(), "cameraManager", camMgr);
        SetRef(env.GetComponent<AstralEnvironment>(), "planeManager", originGo.GetComponent<ARPlaneManager>());

        // Content: the figure and its shadows are built at runtime by MandalaRenderer
        var mandalaGo = new GameObject("Mandala", typeof(MandalaRenderer));
        var mandala = mandalaGo.GetComponent<MandalaRenderer>();
        SetRef(mandala, "bus", bus);
        string[] matFields = { "wireMat", "pointMat", "flakeMat", "bodyMat", "shadowBodyMat", "shadowLineMat", "shadowPointMat" };
        for (int i = 0; i < matFields.Length; i++) SetRef(mandala, matFields[i], mats[i]);

        // Interaction
        var interaction = new GameObject("Interaction", typeof(ARPlacementController), typeof(GestureController));
        var placement = interaction.GetComponent<ARPlacementController>();
        SetRef(placement, "raycaster", originGo.GetComponent<ARRaycastManager>());
        SetRef(placement, "anchors", originGo.GetComponent<ARAnchorManager>());
        SetRef(placement, "mandala", mandala);
        SetRef(placement, "arCamera", cam);
        SetRef(interaction.GetComponent<GestureController>(), "content", mandalaGo.transform);

        // UI
        var uiGo = new GameObject("UI", typeof(UIDocument), typeof(ControlPanel));
        uiGo.GetComponent<UIDocument>().panelSettings = panelSettings;
        var panel = uiGo.GetComponent<ControlPanel>();
        SetRef(panel, "bus", bus);
        SetRef(panel, "mandala", mandala);
        SetRef(panel, "audioInput", systems.GetComponent<AudioInputController>());
        SetRef(panel, "engine", systems.GetComponent<AudioReactiveEngine>());

        EditorSceneManager.SaveScene(scene, ScenePath);
    }

    static void SetRefArray(Object target, string field, Object[] values)
    {
        var so = new SerializedObject(target);
        var arr = so.FindProperty(field);
        if (arr == null) throw new System.Exception($"{target.GetType().Name}.{field} not found");
        arr.arraySize = values.Length;
        for (int i = 0; i < values.Length; i++) arr.GetArrayElementAtIndex(i).objectReferenceValue = values[i];
        so.ApplyModifiedPropertiesWithoutUndo();
    }

    static void SetRef(Object target, string field, Object value)
    {
        var so = new SerializedObject(target);
        var prop = so.FindProperty(field);
        if (prop == null) throw new System.Exception($"{target.GetType().Name}.{field} not found");
        prop.objectReferenceValue = value;
        so.ApplyModifiedPropertiesWithoutUndo();
    }
}

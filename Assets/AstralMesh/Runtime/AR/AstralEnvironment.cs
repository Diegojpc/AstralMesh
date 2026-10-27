using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace AstralMesh.AR
{
    /// <summary>
    /// Where the floor is and where the light comes from, published to the shadow and body shaders.
    /// On a device with ARCore the floor is the lowest horizontal plane and the light direction is
    /// ARCore's main-light estimate; with no AR (editor, emulator) it falls back to a floor
    /// below the camera and a fixed light, so the visuals can still be checked.
    /// </summary>
    [DefaultExecutionOrder(-90)]
    public sealed class AstralEnvironment : MonoBehaviour
    {
        static readonly int GroundId = Shader.PropertyToID("_AstralGround");
        static readonly int LightDirId = Shader.PropertyToID("_AstralLightDir");
        static readonly int LightStrengthId = Shader.PropertyToID("_AstralLightStrength");

        [SerializeField] ARCameraManager cameraManager;
        [SerializeField] ARPlaneManager planeManager;
        [SerializeField, Range(0.8f, 2.2f)] float phoneHeight = 1.35f;
        [SerializeField] Vector3 defaultLightDir = new Vector3(0.25f, 0.9f, 0.35f);

        static float? groundOverride;
        Vector3 lightDir, targetLight;
        float strength = 0.4f, targetStrength = 0.4f;

        /// <summary>World y of the floor.</summary>
        public static float GroundY { get; private set; }
        public static void SetGround(float y) => groundOverride = y;
        public float PhoneHeight { get => phoneHeight; set { phoneHeight = value; groundOverride = null; } }

        void OnEnable()
        {
            groundOverride = null;
            GroundY = -phoneHeight;   // valid from the first frame, before Update runs
            lightDir = targetLight = defaultLightDir.normalized;
            if (cameraManager != null) cameraManager.frameReceived += OnFrame;
        }

        // with no AR camera feed (emulator, editor) the background is black, which hides black bodies and
        // shadows: use a dim street-grey so the figures can be judged
        void Start()
        {
            if (cameraManager != null && cameraManager.subsystem == null)
            {
                var cam = cameraManager.GetComponent<Camera>();
                if (cam != null) { cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = new Color(0.34f, 0.33f, 0.32f); }
            }
        }

        void OnDisable() { if (cameraManager != null) cameraManager.frameReceived -= OnFrame;}

        void OnFrame(ARCameraFrameEventArgs args)
        {
            var est = args.lightEstimation;
            if (est.mainLightDirection.HasValue) targetLight = (-est.mainLightDirection.Value).normalized;   // towards the light
            if (est.mainLightIntensityLumens.HasValue) targetStrength = Mathf.Clamp(0.3f + est.mainLightIntensityLumens.Value / 3000f, 0.3f, 1f);
        }

        void Update()
        {
            float? plane = null;
            if (planeManager != null)
                foreach (var p in planeManager.trackables)
                    if (p.alignment == PlaneAlignment.HorizontalUp)
                        plane = plane.HasValue ? Mathf.Min(plane.Value, p.transform.position.y) : p.transform.position.y;

            // an explicit tap on the floor wins; then a detected plane; then the assumed phone height
            GroundY = groundOverride ?? plane ?? (-phoneHeight);

            float a = 1f - Mathf.Pow(0.9f, Time.unscaledDeltaTime * 60f * 0.4f);
            lightDir = Vector3.Slerp(lightDir, targetLight, a);
            strength = Mathf.Lerp(strength, targetStrength, a);
            Shader.SetGlobalFloat(GroundId, GroundY);
            Shader.SetGlobalVector(LightDirId, lightDir);
            Shader.SetGlobalFloat(LightStrengthId, strength);
        }
    }
}

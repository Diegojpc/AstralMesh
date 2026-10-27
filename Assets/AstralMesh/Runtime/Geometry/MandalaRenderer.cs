using System;
using System.Collections.Generic;
using UnityEngine;
using AstralMesh.AR;
using AstralMesh.Control;

namespace AstralMesh.Geometry
{
    /// <summary>
    /// Builds the selected figure (solid body, lines, point haze and their ground shadows) under a
    /// spinning child, and stands it on the floor facing the viewer. The transform of this object
    /// is the world anchor that placement and gestures move.
    /// </summary>
    public sealed class MandalaRenderer : MonoBehaviour
    {
        static readonly int StripeId = Shader.PropertyToID("_Stripe");
        static readonly int DanceId = Shader.PropertyToID("_Dance");
        static readonly int WingId = Shader.PropertyToID("_Wing");

        [SerializeField] ReactiveParameterBus bus;
        [SerializeField] Material wireMat, pointMat, flakeMat, bodyMat, shadowBodyMat, shadowLineMat, shadowPointMat;

        int current;
        Transform spin;
        readonly List<UnityEngine.Object> owned = new List<UnityEngine.Object>();
        FigureData data;
        float lastScale = 1f;

        public int Current => current;
        public FigureDef Def => Figures.All[current];
        public string[] GeneratorNames => Figures.Names;
        public event Action<int> GeometryChanged;

        void Awake()
        {
            spin = new GameObject("Spin").transform;
            spin.SetParent(transform, false);
            ReadLaunchGeometry();
        }

        void OnEnable() { bus.DensityCommitted += Rebuild; Rebuild(bus.Params.density); }
        void OnDisable() => bus.DensityCommitted -= Rebuild;

        // `adb shell am start ... --ei geometry N` picks the figure, so every one can be screenshotted
        void ReadLaunchGeometry()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                using var activity = player.GetStatic<AndroidJavaObject>("currentActivity");
                using var intent = activity.Call<AndroidJavaObject>("getIntent");
                int g = intent.Call<int>("getIntExtra", "geometry", -1);
                if (g >= 0) current = Mathf.Clamp(g, 0, Figures.All.Length - 1);
            }
            catch (Exception e) { Debug.LogWarning("[AstralMesh] launch geometry: " + e.Message); }
#endif
        }

        public void SelectGeometry(int index)
        {
            current = Mathf.Clamp(index, 0, Figures.All.Length - 1);
            bus.SelectPalette(Def.Palette);   // each figure comes with the colours it suits
            Rebuild(bus.Params.density);
        }

        void Clear()
        {
            for (int i = spin.childCount - 1; i >= 0; i--) Destroy(spin.GetChild(i).gameObject);
            foreach (var o in owned) if (o != null) Destroy(o);
            owned.Clear();
        }

        void Part(string name, Mesh mesh, Material mat)
        {
            if (mesh == null || mat == null) return;
            var go = new GameObject(name);
            go.transform.SetParent(spin, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.allowOcclusionWhenDynamic = false;
            if (!owned.Contains(mesh)) owned.Add(mesh);   // shadow and body share one mesh: destroy it once
        }

        void Rebuild(int density)
        {
            Clear();
            var def = Def;
            data = def.Build(density);

            pointMat.SetFloat("_PointSize", def.PointSize);
            flakeMat.SetFloat("_PointSize", def.PointSize);
            shadowPointMat.SetFloat("_PointSize", def.PointSize * 1.4f);
            Part("shadow body", data.Body, shadowBodyMat);
            Part("body", data.Body, bodyMat);
            Part("shadow lines", data.Lines, shadowLineMat);
            Part("lines", data.Lines, wireMat);
            Part("shadow points", data.Points, data.Body != null ? null : shadowPointMat);
            Part("points", data.Points, data.Body != null ? flakeMat : pointMat);
            Shader.SetGlobalVector(StripeId, def.Stripe);
            Shader.SetGlobalFloat(DanceId, def.Dance ? 1f : 0f);
            Shader.SetGlobalFloat(WingId, def.Wing ? 1f : 0f);
            spin.localRotation = Quaternion.identity;
            lastScale = transform.lossyScale.y;
            Stand();
            GeometryChanged?.Invoke(current);
        }

        /// <summary>World anchor: stand the figure at (x, z) facing the viewer.</summary>
        public void PlaceAt(Vector3 position, Vector3 viewerPosition)
        {
            var toViewer = viewerPosition - position; toViewer.y = 0f;
            if (toViewer.sqrMagnitude < 1e-4f) toViewer = Vector3.back;
            toViewer.Normalize();
            transform.rotation = Def.Mode == FigureMode.Upright
                ? Quaternion.LookRotation(toViewer, Vector3.up)                 // local +Z towards the viewer
                : Quaternion.FromToRotation(Vector3.up, toViewer);              // flat figure: normal back at the viewer
            transform.position = position;
            Stand();
        }

        /// <summary>Put upright figures on the floor (feet just above it); flat ones hover at chest height.</summary>
        public void Stand()
        {
            if (data == null) return;
            var p = transform.position;
            float s = transform.lossyScale.y;
            p.y = Def.Mode == FigureMode.Upright ? AstralEnvironment.GroundY - data.MinY * s + 0.06f : AstralEnvironment.GroundY + 0.95f;
            transform.position = p;
        }

        void Update()
        {
            float speed = bus.Params.speed;
            var def = Def;
            // flat creatures sway instead of spinning, so they are never seen edge-on
            if (def.Sway) spin.localRotation = Quaternion.Euler(0f, Mathf.Sin(Time.time * 0.5f * speed) * 0.55f * Mathf.Rad2Deg, 0f);
            else if (!def.Dance) spin.Rotate(0f, 20f * speed * Time.deltaTime, 0f, Space.Self);

            float s = transform.lossyScale.y;
            if (!Mathf.Approximately(s, lastScale)) { lastScale = s; Stand(); }   // pinch changed the size
        }
    }
}

using System;
using UnityEngine;

namespace AstralMesh.Control
{
    /// <summary>Single place the UI/gestures write to and the shaders read from (via globals).</summary>
    public sealed class ReactiveParameterBus : MonoBehaviour
    {
        static readonly int ParamsId = Shader.PropertyToID("_Params"); // x=expand y=twist z=speed w=deform
        static readonly int ColorAId = Shader.PropertyToID("_ColorA");
        static readonly int ColorBId = Shader.PropertyToID("_ColorB");
        static readonly int ColorCId = Shader.PropertyToID("_ColorC");
        static readonly int RainbowId = Shader.PropertyToID("_Rainbow");

        public VisualParams Params = VisualParams.Default;
        [SerializeField] PaletteSO[] palettes;
        int paletteIndex = -1;

        public PaletteSO[] Palettes => palettes;
        public int PaletteIndex => paletteIndex;
        public PaletteSO Palette => palettes != null && paletteIndex >= 0 ? palettes[paletteIndex] : null;

        public event Action<int> DensityCommitted;
        public event Action<int> PaletteChanged;

        void Awake() { if (palettes != null && palettes.Length > 0 && paletteIndex < 0) paletteIndex = 0; }

        public void SelectPalette(int i)
        {
            if (palettes == null || palettes.Length == 0) return;
            paletteIndex = Mathf.Clamp(i, 0, palettes.Length - 1);
            PaletteChanged?.Invoke(paletteIndex);
        }

        void Update()
        {
            Shader.SetGlobalVector(ParamsId, new Vector4(Params.expand, Params.twist, Params.speed, Params.deform));
            var p = Palette;
            if (p == null) return;
            Shader.SetGlobalColor(ColorAId, p.colorA);
            Shader.SetGlobalColor(ColorBId, p.colorB);
            Shader.SetGlobalColor(ColorCId, p.colorC);
            Shader.SetGlobalFloat(RainbowId, p.rainbow ? 1f : 0f);
        }

        // Density regenerates the mesh, so it is committed on slider release only.
        public void CommitDensity() => DensityCommitted?.Invoke(Params.density);
    }
}

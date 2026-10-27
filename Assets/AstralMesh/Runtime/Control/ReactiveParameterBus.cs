using UnityEngine;

namespace AstralMesh.Control
{
    /// <summary>Single place the UI/gestures write to and the shaders read from (via globals).</summary>
    public sealed class ReactiveParameterBus : MonoBehaviour
    {
        static readonly int ParamsId = Shader.PropertyToID("_Params"); // x=expand y=twist z=speed w=deform
        static readonly int ColorAId = Shader.PropertyToID("_ColorA");
        static readonly int ColorBId = Shader.PropertyToID("_ColorB");

        public VisualParams Params = VisualParams.Default;
        public PaletteSO Palette;

        public event System.Action<int> DensityCommitted;

        void Update()
        {
            Shader.SetGlobalVector(ParamsId, new Vector4(Params.expand, Params.twist, Params.speed, Params.deform));
            if (Palette != null)
            {
                Shader.SetGlobalColor(ColorAId, Palette.colorA);
                Shader.SetGlobalColor(ColorBId, Palette.colorB);
            }
        }

        // Density regenerates the mesh, so it is committed on slider release only.
        public void CommitDensity() => DensityCommitted?.Invoke(Params.density);
    }
}

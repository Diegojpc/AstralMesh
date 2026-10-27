using System.Collections.Generic;
using UnityEngine;

namespace AstralMesh.Geometry
{
    public sealed class PhyllotaxisLatticeGenerator : IFractalGenerator
    {
        public string Name => "Phyllotaxis Lattice";
        const float GoldenAngle = 2.39996323f;

        public Mesh Build(int density)
        {
            int count = Mathf.Clamp(density, 1, 6) * 150;
            var pts = new Vector3[count];
            for (int i = 0; i < count; i++)
            {
                float r = 0.9f * Mathf.Sqrt((float)i / count);
                pts[i] = new Vector3(Mathf.Cos(i * GoldenAngle) * r, 0f, Mathf.Sin(i * GoldenAngle) * r);
            }

            var uv2 = new Vector2[count];
            var idx = new List<int>();
            for (int i = 0; i < count; i++)
            {
                uv2[i] = new Vector2(pts[i].magnitude / 0.9f, i % 21);
                // Fibonacci neighbours give the spiral lattice
                foreach (int step in new[] { 8, 13, 21 })
                    if (i + step < count) { idx.Add(i); idx.Add(i + step); }
            }

            var mesh = new Mesh { name = Name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(pts);
            mesh.SetUVs(1, uv2);
            mesh.SetIndices(idx, MeshTopology.Lines, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 2f);
            return mesh;
        }
    }
}

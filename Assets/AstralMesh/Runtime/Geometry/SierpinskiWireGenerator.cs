using System.Collections.Generic;
using UnityEngine;

namespace AstralMesh.Geometry
{
    public sealed class SierpinskiWireGenerator : IFractalGenerator
    {
        public string Name => "Sierpinski Tetra";

        public Mesh Build(int density)
        {
            int levels = Mathf.Clamp(density, 1, 5);
            var verts = new List<Vector3>();
            var uv2 = new List<Vector2>();
            var idx = new List<int>();
            const float k = 0.8165f; // tetra height factor
            Vector3[] corners =
            {
                new Vector3(1, 1, 1), new Vector3(1, -1, -1), new Vector3(-1, 1, -1), new Vector3(-1, -1, 1)
            };

            void Tetra(Vector3 c, float s, int level)
            {
                if (level == levels)
                {
                    float depth = 1f;
                    int b = verts.Count;
                    for (int i = 0; i < 4; i++) { verts.Add(c + corners[i] * s * k); uv2.Add(new Vector2(depth, 0)); }
                    for (int i = 0; i < 4; i++)
                        for (int j = i + 1; j < 4; j++) { idx.Add(b + i); idx.Add(b + j); }
                    return;
                }
                for (int i = 0; i < 4; i++)
                    Tetra(c + corners[i] * s * k * 0.5f, s * 0.5f, level + 1);
            }

            Tetra(Vector3.zero, 0.5f, 0);

            // depth = normalized radius, so the kick wave still travels outward
            float max = 0f;
            foreach (var v in verts) max = Mathf.Max(max, v.magnitude);
            for (int i = 0; i < uv2.Count; i++) uv2[i] = new Vector2(verts[i].magnitude / max, i / 4);

            var mesh = new Mesh { name = Name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(verts);
            mesh.SetUVs(1, uv2);
            mesh.SetIndices(idx, MeshTopology.Lines, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 2f);
            return mesh;
        }
    }
}

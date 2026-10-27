using System.Collections.Generic;
using UnityEngine;

namespace AstralMesh.Geometry
{
    public sealed class RadialMandalaGenerator : IFractalGenerator
    {
        public string Name => "Radial Mandala";
        const int Symmetry = 12;

        public Mesh Build(int density)
        {
            int levels = Mathf.Clamp(density, 2, 6);
            var verts = new List<Vector3>();
            var uv2 = new List<Vector2>();
            var idx = new List<int>();
            int nodeId = 0;

            void Add(Vector3 a, Vector3 b, float depth, int ring)
            {
                int i = verts.Count;
                verts.Add(a); verts.Add(b);
                uv2.Add(new Vector2(depth, ring)); uv2.Add(new Vector2(depth, ring));
                idx.Add(i); idx.Add(i + 1);
                nodeId++;
            }

            void Recurse(Vector3 origin, float angle, float length, int level)
            {
                if (level >= levels) return;
                float depth = (float)level / (levels - 1);
                var end = origin + new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * length;
                Add(origin, end, depth, level);
                for (int s = -1; s <= 1; s += 2)
                    Recurse(end, angle + s * Mathf.PI / 5f, length * 0.58f, level + 1);
            }

            for (int k = 0; k < Symmetry; k++)
                Recurse(Vector3.zero, k * Mathf.PI * 2f / Symmetry, 0.25f, 0);

            var mesh = new Mesh { name = Name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(verts);
            mesh.SetUVs(1, uv2);
            mesh.SetIndices(idx, MeshTopology.Lines, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 2f);
            return mesh;
        }
    }
}

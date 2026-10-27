using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace AstralMesh.Geometry
{
    /// <summary>Deterministic RNG (mulberry32), same sequence family as the web version.</summary>
    public sealed class Rng
    {
        uint a;
        public Rng(uint seed) { a = seed; }
        public float Next()
        {
            unchecked
            {
                a += 0x6D2B79F5u;
                uint t = (a ^ (a >> 15)) * (1u | a);
                t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
                return (float)((t ^ (t >> 14)) / 4294967296.0);
            }
        }
    }

    /// <summary>
    /// Line segments with optional strand layers (parallel, slightly wandering copies: "hair").
    /// uv2 = (depth, node id), the same convention the shaders read.
    /// </summary>
    public sealed class LineBuilder
    {
        readonly int maxStrands;
        readonly List<Vector3>[] pos;
        readonly List<Vector2>[] uv;
        readonly Rng rng;
        public int Id;

        public LineBuilder(int strands, uint seed = 99)
        {
            maxStrands = strands;
            pos = new List<Vector3>[strands];
            uv = new List<Vector2>[strands];
            for (int i = 0; i < strands; i++) { pos[i] = new List<Vector3>(); uv[i] = new List<Vector2>(); }
            rng = new Rng(seed);
        }

        public void Seg(Vector3 a, Vector3 b, float da, float db, int id = -1, int strands = -1, float spread = 0.008f)
        {
            if (id < 0) id = Id;
            int n = Mathf.Min(strands < 0 ? maxStrands : strands, maxStrands);
            for (int k = 0; k < n; k++)
            {
                Vector3 pa = a, pb = b;
                if (k > 0)
                {
                    var o = new Vector3(Jit(spread), Jit(spread), Jit(spread));
                    var e = new Vector3(Jit(spread * 0.5f), Jit(spread * 0.5f), Jit(spread * 0.5f));
                    pa = a + o; pb = b + o + e;
                }
                pos[k].Add(pa); pos[k].Add(pb);
                uv[k].Add(new Vector2(da, id)); uv[k].Add(new Vector2(db, id));
            }
        }

        float Jit(float s) => (rng.Next() - 0.5f) * 2f * s;
        public void Next() { Id++; }

        public Mesh BuildLines(string name)
        {
            var p = new List<Vector3>(); var u = new List<Vector2>();
            for (int k = 0; k < maxStrands; k++) { p.AddRange(pos[k]); u.AddRange(uv[k]); }
            return MeshOf(name, p, u, MeshTopology.Lines);
        }

        // random points along the base layer: a soft haze around the structure
        public Mesh BuildFuzz(string name, int count, float jitter, uint seed)
        {
            var r = new Rng(seed);
            var p = new List<Vector3>(); var u = new List<Vector2>();
            int segs = pos[0].Count / 2;
            if (segs > 0)
            {
                for (int i = 0; i < count; i++)
                {
                    int s = Mathf.Min(segs - 1, (int)(r.Next() * segs));
                    float t = r.Next();
                    var q = Vector3.Lerp(pos[0][s * 2], pos[0][s * 2 + 1], t);
                    p.Add(q + new Vector3(r.Next() - 0.5f, r.Next() - 0.5f, r.Next() - 0.5f) * jitter);
                    u.Add(new Vector2(Mathf.Lerp(uv[0][s * 2].x, uv[0][s * 2 + 1].x, t), uv[0][s * 2].y + i * 0.37f));
                }
            }
            return MeshOf(name, p, u, MeshTopology.Points);
        }

        // depth := distance from the origin, normalized (for figures with no natural progression)
        public void NormalizeDepthByRadius()
        {
            float max = 1e-6f;
            foreach (var l in pos) foreach (var v in l) max = Mathf.Max(max, v.magnitude);
            for (int k = 0; k < maxStrands; k++)
                for (int i = 0; i < uv[k].Count; i++) uv[k][i] = new Vector2(pos[k][i].magnitude / max, uv[k][i].y);
        }

        public float MinY()
        {
            float m = float.PositiveInfinity;
            foreach (var l in pos) foreach (var v in l) m = Mathf.Min(m, v.y);
            return m;
        }

        public static Mesh MeshOf(string name, List<Vector3> p, List<Vector2> u, MeshTopology topo)
        {
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(p);
            mesh.SetUVs(1, u);
            var idx = new int[p.Count];
            for (int i = 0; i < idx.Length; i++) idx[i] = i;
            mesh.SetIndices(idx, topo, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 8f);
            return mesh;
        }
    }

    /// <summary>
    /// Solid bodies (tubes, blobs). uv2 = (t along the limb or height, limb id), uv3 = (angle around, 0).
    /// Drawn near-black with neon bands by MandalaBody.shader.
    /// </summary>
    public sealed class BodyBuilder
    {
        readonly List<Vector3> pos = new List<Vector3>(), nrm = new List<Vector3>();
        readonly List<Vector2> uvT = new List<Vector2>(), uvA = new List<Vector2>();
        readonly List<int> idx = new List<int>();
        public float MinY { get; private set; } = float.PositiveInfinity;

        public int Count => pos.Count;

        public void AddVertex(Vector3 p, Vector3 n, float t, float ang, float limb)
        {
            pos.Add(p); nrm.Add(n); uvT.Add(new Vector2(t, limb)); uvA.Add(new Vector2(ang, 0f));
            MinY = Mathf.Min(MinY, p.y);
        }
        public void AddTri(int a, int b, int c) { idx.Add(a); idx.Add(b); idx.Add(c); }

        // tube along a polyline using parallel transport; radius(t) shapes the profile
        public void AddTube(IList<Vector3> spine, Func<float, float> radius, int J, int limbId)
        {
            int n = spine.Count;
            int baseIdx = pos.Count;
            Vector3 prevN = Vector3.zero; bool have = false;
            for (int i = 0; i < n; i++)
            {
                Vector3 tan = (spine[Mathf.Min(i + 1, n - 1)] - spine[Mathf.Max(i - 1, 0)]).normalized;
                Vector3 N;
                if (!have)
                {
                    Vector3 reference = Mathf.Abs(tan.y) < 0.9f ? Vector3.up : Vector3.right;
                    N = Vector3.Cross(reference, tan).normalized;
                }
                else N = (prevN - tan * Vector3.Dot(prevN, tan)).normalized;
                Vector3 B = Vector3.Cross(tan, N);
                float t = (float)i / (n - 1);
                float r = radius(t);
                for (int j = 0; j < J; j++)
                {
                    float phi = (float)j / J * Mathf.PI * 2f;
                    Vector3 off = N * Mathf.Cos(phi) + B * Mathf.Sin(phi);
                    AddVertex(spine[i] + off * r, off, t, (float)j / J, limbId);
                }
                prevN = N; have = true;
            }
            for (int i = 0; i < n - 1; i++)
                for (int j = 0; j < J; j++)
                {
                    int a = baseIdx + i * J + j, b = baseIdx + i * J + (j + 1) % J;
                    int c = baseIdx + (i + 1) * J + j, d = baseIdx + (i + 1) * J + (j + 1) % J;
                    AddTri(a, b, c); AddTri(b, d, c);
                }
        }

        public Mesh Build(string name)
        {
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(pos);
            mesh.SetNormals(nrm);
            mesh.SetUVs(1, uvT);
            mesh.SetUVs(2, uvA);
            mesh.SetIndices(idx, MeshTopology.Triangles, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 8f);
            return mesh;
        }
    }
}

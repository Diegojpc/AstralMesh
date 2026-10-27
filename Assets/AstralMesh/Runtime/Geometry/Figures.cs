using System;
using System.Collections.Generic;
using UnityEngine;

namespace AstralMesh.Geometry
{
    public enum FigureMode { Upright, Facing }

    /// <summary>What a generator produces: any of lines, points (haze / flakes) and a solid body.</summary>
    public sealed class FigureData
    {
        public Mesh Lines, Points, Body;
        public float MinY;      // lowest point, to stand the figure on the floor
        public float Radius;    // for touch hit areas
    }

    public sealed class FigureDef
    {
        public string Name;
        public Func<int, FigureData> Build;
        public FigureMode Mode;
        public int Palette;        // default palette index (see SceneBuilder.CreatePalettes)
        public float PointSize;
        public Vector4 Stripe;     // bands, scroll speed, spiral twist, rim gain (bands 0 = rim only)
        public bool Dance, Wing, Sway;
    }

    /// <summary>The ten figures, ported from docs/js/figures.js (same shapes and parameters).</summary>
    public static class Figures
    {
        const float TAU = Mathf.PI * 2f;
        const float GOLDEN = 2.39996323f;

        public static readonly FigureDef[] All =
        {
            new FigureDef { Name = "Criatura de bandas", Build = BandedCreature, Mode = FigureMode.Upright, Palette = 6, PointSize = 6, Stripe = new Vector4(16, 0.5f, 0, 0.6f), Dance = true },
            new FigureDef { Name = "Araña de tinta", Build = InkSpider, Mode = FigureMode.Upright, Palette = 5, PointSize = 6, Stripe = new Vector4(0, 0, 0, 1.4f), Dance = true },
            new FigureDef { Name = "Mancha de curvas de nivel", Build = ContourBlob, Mode = FigureMode.Upright, Palette = 4, PointSize = 6, Stripe = new Vector4(14, 0.25f, 0, 0.5f) },
            new FigureDef { Name = "Erizo de mar", Build = Urchin, Mode = FigureMode.Upright, Palette = 3, PointSize = 5 },
            new FigureDef { Name = "Mariposa de contornos", Build = Butterfly, Mode = FigureMode.Upright, Palette = 1, PointSize = 6, Wing = true, Sway = true },
            new FigureDef { Name = "Salpicadura de tinta", Build = Splatter, Mode = FigureMode.Upright, Palette = 5, PointSize = 6 },
            new FigureDef { Name = "Anillo punteado", Build = RingMandala, Mode = FigureMode.Facing, Palette = 5, PointSize = 6 },
            new FigureDef { Name = "Mandala radial", Build = RadialMandala, Mode = FigureMode.Facing, Palette = 0, PointSize = 6 },
            new FigureDef { Name = "Tetraedro de Sierpinski", Build = Sierpinski, Mode = FigureMode.Upright, Palette = 3, PointSize = 6 },
            new FigureDef { Name = "Red de filotaxis", Build = Phyllotaxis, Mode = FigureMode.Facing, Palette = 2, PointSize = 6 },
        };

        public static string[] Names
        {
            get { var n = new string[All.Length]; for (int i = 0; i < n.Length; i++) n[i] = All[i].Name; return n; }
        }

        // sin() can come out as -1e-7 at pi in float; Pow(negative, 0.8) would then be NaN
        static float SinPos(float x) => Mathf.Max(0f, Mathf.Sin(x));

        static Vector3 MirrorX(Vector3 p) => new Vector3(-p.x, p.y, p.z);
        static int Clamp(int v, int a, int b) => Mathf.Clamp(v, a, b);

        static FigureData OfLines(LineBuilder L, string name, int fuzz, float jitter, uint seed, Mesh flakes = null)
        {
            var lines = L.BuildLines(name + " lines");
            float r = 0.6f;
            foreach (var v in lines.vertices) r = Mathf.Max(r, v.magnitude);
            return new FigureData { Lines = lines, Points = flakes ?? L.BuildFuzz(name + " haze", fuzz, jitter, seed), MinY = L.MinY(), Radius = r };
        }

        static Vector3[] Line3(Vector3 a, Vector3 b, int n)
        {
            var o = new Vector3[n];
            for (int i = 0; i < n; i++) o[i] = Vector3.Lerp(a, b, (float)i / (n - 1));
            return o;
        }

        static Vector3[] Catmull(Vector3[] pts, int perSeg)
        {
            var o = new List<Vector3>();
            for (int i = 0; i < pts.Length - 1; i++)
            {
                Vector3 p0 = pts[Mathf.Max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Mathf.Min(pts.Length - 1, i + 2)];
                for (int s = 0; s < perSeg; s++)
                {
                    float t = (float)s / perSeg, t2 = t * t, t3 = t2 * t;
                    o.Add(0.5f * ((2f * p1) + (-p0 + p2) * t + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2 + (-p0 + 3f * p1 - 3f * p2 + p3) * t3));
                }
            }
            o.Add(pts[pts.Length - 1]);
            return o.ToArray();
        }

        // organic limb: walk along dir, bending by a constant curl plus a little noise
        static Vector3[] LimbSpine(Rng rng, Vector3 start, Vector3 dir, float len, int steps, Vector3 curl)
        {
            var pts = new Vector3[steps + 1];
            pts[0] = start;
            Vector3 d = dir.normalized, p = start;
            float h = len / steps;
            for (int i = 0; i < steps; i++)
            {
                float k = 0.6f + 0.9f * i / steps;
                d = (d + curl * k + new Vector3(rng.Next() - 0.5f, rng.Next() - 0.5f, rng.Next() - 0.5f) * 0.05f).normalized;
                p += d * h;
                pts[i + 1] = p;
            }
            return pts;
        }

        static Mesh Flakes(Rng rng, int count, float radius, Vector3 centre)
        {
            var p = new List<Vector3>(); var u = new List<Vector2>();
            for (int i = 0; i < count; i++)
            {
                float uu = rng.Next() * 2f - 1f, th = rng.Next() * TAU, rr = Mathf.Sqrt(1f - uu * uu);
                float r = radius * (0.35f + 0.65f * rng.Next());
                p.Add(centre + new Vector3(Mathf.Cos(th) * rr * r, uu * r * 0.8f, Mathf.Sin(th) * rr * r));
                u.Add(new Vector2(rng.Next(), 1000 + i));
            }
            return LineBuilder.MeshOf("flakes", p, u, MeshTopology.Points);
        }

        // ------------------------------------------------------------ line figures

        static FigureData RadialMandala(int density)
        {
            int levels = Clamp(density, 2, 6);
            var L = new LineBuilder(2);
            void Rec(float ox, float oz, float angle, float len, int level)
            {
                if (level >= levels) return;
                float d = (float)level / (levels - 1);
                float ex = ox + Mathf.Cos(angle) * len, ez = oz + Mathf.Sin(angle) * len;
                L.Seg(new Vector3(ox, 0, oz), new Vector3(ex, 0, ez), d, d); L.Next();
                for (int s = -1; s <= 1; s += 2) Rec(ex, ez, angle + s * Mathf.PI / 5f, len * 0.58f, level + 1);
            }
            for (int k = 0; k < 12; k++) Rec(0, 0, k * TAU / 12f, 0.25f, 0);
            return OfLines(L, "radial", 2500, 0.015f, 1);
        }

        static FigureData Sierpinski(int density)
        {
            int levels = Clamp(density, 1, 5);
            var L = new LineBuilder(2);
            const float k = 0.8165f;
            Vector3[] corners = { new Vector3(1, 1, 1), new Vector3(1, -1, -1), new Vector3(-1, 1, -1), new Vector3(-1, -1, 1) };
            void Tetra(Vector3 c, float s, int level)
            {
                if (level == levels)
                {
                    var v = new Vector3[4];
                    for (int i = 0; i < 4; i++) v[i] = c + corners[i] * s * k;
                    for (int i = 0; i < 4; i++) for (int j = i + 1; j < 4; j++) L.Seg(v[i], v[j], 0, 0, L.Id, 2, 0.004f);
                    L.Next();
                    return;
                }
                foreach (var cr in corners) Tetra(c + cr * s * k * 0.5f, s * 0.5f, level + 1);
            }
            Tetra(Vector3.zero, 0.5f, 0);
            L.NormalizeDepthByRadius();
            return OfLines(L, "sierpinski", 2000, 0.01f, 2);
        }

        static FigureData Phyllotaxis(int density)
        {
            int count = Clamp(density, 1, 6) * 150;
            var pts = new Vector3[count];
            for (int i = 0; i < count; i++)
            {
                float r = 0.55f * Mathf.Sqrt((float)i / count);
                pts[i] = new Vector3(Mathf.Cos(i * GOLDEN) * r, 0, Mathf.Sin(i * GOLDEN) * r);
            }
            var L = new LineBuilder(2);
            for (int i = 0; i < count; i++)
                foreach (int step in new[] { 8, 13, 21 })
                    if (i + step < count) L.Seg(pts[i], pts[i + step], 0, 0, i % 21, 2, 0.003f);
            L.NormalizeDepthByRadius();
            return OfLines(L, "phyllotaxis", 2500, 0.01f, 3);
        }

        // Sea urchin: golden-spiral sphere, long forked spines in strands, glowing lattice core.
        static FigureData Urchin(int density)
        {
            var rng = new Rng(11);
            int n = 70 + Clamp(density, 2, 6) * 34;
            const float r0 = 0.16f;
            var L = new LineBuilder(3);
            var dirs = new Vector3[n];
            for (int i = 0; i < n; i++)
            {
                float y = 1f - 2f * (i + 0.5f) / n, rr = Mathf.Sqrt(1f - y * y), th = i * GOLDEN;
                dirs[i] = new Vector3(Mathf.Cos(th) * rr, y, Mathf.Sin(th) * rr);
            }
            foreach (var d in dirs)
            {
                float len = 0.16f + rng.Next() * rng.Next() * 0.5f;
                L.Seg(d * r0, d * (r0 + len), 0, 1, L.Id, 3, 0.006f);
                Vector3 m = d * (r0 + len * 0.78f);
                for (int s = 0; s < 3; s++)
                {
                    float ang = (float)s / 3 * TAU + rng.Next();
                    var side = new Vector3(Mathf.Cos(ang), Mathf.Sin(ang * 1.7f), Mathf.Sin(ang));
                    L.Seg(m, d * (r0 + len * 1.08f) + side * 0.045f, 0.85f, 1, L.Id, 2, 0.004f);
                }
                L.Next();
            }
            for (int i = 0; i < n; i++)
                foreach (int step in new[] { 3, 5, 8, 13 })
                    if (i + step < n) L.Seg(dirs[i] * r0, dirs[i + step] * r0, 0, 0, i, 2, 0.003f);
            return OfLines(L, "urchin", 5000, 0.03f, 4);
        }

        // Butterfly: Temple Fay's curve as nested contour layers plus veins; folds on bass.
        static FigureData Butterfly(int density)
        {
            int layers = 3 + Clamp(density, 2, 6);
            const int N = 260; const float scale = 0.115f;
            var L = new LineBuilder(3);
            Vector2 Pt(float t)
            {
                float r = Mathf.Exp(Mathf.Cos(t)) - 2f * Mathf.Cos(4f * t) + Mathf.Pow(Mathf.Sin((2f * t - Mathf.PI) / 24f), 5f);
                return new Vector2(Mathf.Sin(t) * r, Mathf.Cos(t) * r);
            }
            for (int k = 0; k < layers; k++)
            {
                float s = scale * (1f - (float)k / layers * 0.88f);
                float depth = (float)k / (layers - 1);
                bool has = false; Vector3 prev = Vector3.zero;
                for (int i = 0; i <= N; i++)
                {
                    var q = Pt((float)i / N * 12f * Mathf.PI);
                    var p = new Vector3(q.x * s, q.y * s, k * 0.004f);
                    if (has) L.Seg(prev, p, depth, depth, k * 100 + i / 5, 3, 0.004f);
                    prev = p; has = true;
                }
            }
            for (int i = 0; i < 90; i++)
            {
                var q = Pt((float)i / 90 * 12f * Mathf.PI);
                L.Seg(Vector3.zero, new Vector3(q.x * scale, q.y * scale, 0), 0, 1, 5000 + i, 2, 0.003f);
            }
            return OfLines(L, "butterfly", 6000, 0.012f, 5);
        }

        // Ink splatter: curved streaks with drops, thrown outward and drooping.
        static FigureData Splatter(int density)
        {
            var rng = new Rng(5);
            int M = 50 + Clamp(density, 2, 6) * 22;
            var L = new LineBuilder(3);
            for (int i = 0; i < M; i++)
            {
                float u = rng.Next() * 2f - 1f, th = rng.Next() * TAU, rr = Mathf.Sqrt(1f - u * u);
                var dir = new Vector3(Mathf.Cos(th) * rr, u * 0.7f, Mathf.Sin(th) * rr);
                float len = 0.12f + rng.Next() * rng.Next() * 0.55f;
                const int segs = 5;
                Vector3 prev = Vector3.zero;
                for (int s = 1; s <= segs; s++)
                {
                    float t = (float)s / segs;
                    var p = new Vector3(dir.x * len * t, dir.y * len * t - 0.35f * len * t * t, dir.z * len * t);
                    L.Seg(prev, p, (float)(s - 1) / segs, t, i, 3, 0.004f);
                    prev = p;
                }
                L.Seg(prev, prev + new Vector3(dir.x * 0.035f, -0.02f, dir.z * 0.035f), 1, 1, i, 2, 0.003f);
                L.Next();
            }
            return OfLines(L, "splatter", 4000, 0.03f, 6);
        }

        // Dashed ring with a three-petal rose and a concentric eye (flat, faces the viewer).
        static FigureData RingMandala(int density)
        {
            var L = new LineBuilder(3);
            int dashes = 36 + Clamp(density, 2, 6) * 6;
            for (int i = 0; i < dashes; i++)
            {
                float a0 = (float)i / dashes * TAU, a1 = a0 + TAU / dashes * 0.55f, R = 0.62f;
                L.Seg(new Vector3(Mathf.Cos(a0) * R, 0, Mathf.Sin(a0) * R), new Vector3(Mathf.Cos(a1) * R, 0, Mathf.Sin(a1) * R), 1, 1, i, 3, 0.004f);
            }
            const int steps = 160;
            foreach (var (petals, size, depth) in new[] { (3, 0.46f, 0.35f), (3, 0.3f, 0.7f) })
            {
                bool has = false; Vector3 prev = Vector3.zero;
                for (int i = 0; i <= steps; i++)
                {
                    float th = (float)i / steps * TAU, r = size * Mathf.Cos(petals * th);
                    var p = new Vector3(Mathf.Cos(th) * r, 0, Mathf.Sin(th) * r);
                    if (has) L.Seg(prev, p, depth, depth, 200 + (i >> 3), 3, 0.004f);
                    prev = p; has = true;
                }
            }
            foreach (var (r, d) in new[] { (0.05f, 0f), (0.09f, 0.1f), (0.14f, 0.2f) })
            {
                bool has = false; Vector3 prev = Vector3.zero;
                for (int i = 0; i <= 28; i++)
                {
                    float th = (float)i / 28 * TAU;
                    var p = new Vector3(Mathf.Cos(th) * r, 0, Mathf.Sin(th) * r);
                    if (has) L.Seg(prev, p, d, d, 500 + i, 2, 0.002f);
                    prev = p; has = true;
                }
            }
            return OfLines(L, "ring", 3000, 0.012f, 7);
        }

        // ------------------------------------------------------------ solid figures

        // Bilaterally symmetric bulb: only cosines of the angle from +Z, so x mirrors exactly.
        public static Vector3 BlobPoint(float h, float th)
        {
            float bulb = Mathf.Pow(SinPos(Mathf.PI * Mathf.Clamp01(h)), 0.7f);
            float R = 0.04f + 0.46f * bulb;
            float lobe = 0.38f * Mathf.Sin(h * 7f) * bulb;
            float w = 1f + 0.32f * Mathf.Cos(2f * th) + 0.2f * Mathf.Cos(3f * th) + lobe * Mathf.Cos(5f * th) + 0.12f * Mathf.Cos(th);
            float r = R * w;
            return new Vector3(Mathf.Sin(th) * r, (h - 0.5f) * 0.95f, Mathf.Cos(th) * r * 0.55f);
        }

        static FigureData ContourBlob(int density)
        {
            int NT = 72 + Clamp(density, 2, 6) * 8, NH = 60 + Clamp(density, 2, 6) * 6;
            var B = new BodyBuilder();
            const float e = 1e-3f;
            for (int iy = 0; iy <= NH; iy++)
            {
                float h = (float)iy / NH;
                for (int ix = 0; ix <= NT; ix++)
                {
                    float th = (float)ix / NT * TAU;
                    Vector3 p = BlobPoint(h, th);
                    Vector3 dth = BlobPoint(h, th + e) - BlobPoint(h, th - e);
                    Vector3 dh = BlobPoint(Mathf.Clamp01(h + e), th) - BlobPoint(Mathf.Clamp01(h - e), th);
                    // scale first: Vector3.normalized returns zero for magnitudes below 1e-5, and these differences are ~1e-3
                    Vector3 n = Vector3.Cross(dth / (2f * e), dh / (2f * e)).normalized;
                    if (Vector3.Dot(n, new Vector3(p.x, 0, p.z)) < 0) n = -n;
                    B.AddVertex(p, n, h, (float)ix / NT, 0);
                }
            }
            for (int iy = 0; iy < NH; iy++)
                for (int ix = 0; ix < NT; ix++)
                {
                    int a = iy * (NT + 1) + ix, b = a + 1, c = a + NT + 1, d = c + 1;
                    B.AddTri(a, c, b); B.AddTri(b, c, d);
                }
            return new FigureData { Body = B.Build("blob"), Points = Flakes(new Rng(8), 120, 0.9f, Vector3.zero), MinY = B.MinY, Radius = 0.7f };
        }

        // Banded creature: torso + mirrored legs and arms as ribbed tubes.
        static FigureData BandedCreature(int density)
        {
            var rng = new Rng(21);
            var B = new BodyBuilder();
            const int J = 10;
            int steps = 22 + Clamp(density, 2, 6) * 3;
            B.AddTube(Line3(new Vector3(0, -0.12f, 0), new Vector3(0, 0.42f, 0), 12), t => 0.035f + 0.1f * Mathf.Pow(SinPos(Mathf.PI * (0.12f + 0.76f * t)), 0.8f), J, 0);
            int armPairs = 2 + Clamp(density, 2, 6) / 2;
            var specs = new List<(Vector3 start, Vector3 dir, float len, Vector3 curl, float r0)>
            {
                (new Vector3(0.05f, -0.1f, 0), new Vector3(0.55f, -0.8f, 0.2f), 0.64f, new Vector3(0.01f, 0.05f, -0.02f), 0.062f),
                (new Vector3(0.05f, -0.08f, 0), new Vector3(0.3f, -0.9f, -0.3f), 0.66f, new Vector3(0f, 0.04f, 0.02f), 0.056f),
            };
            for (int i = 0; i < armPairs; i++)
            {
                float a = (float)i / armPairs * 1.6f - 0.2f;
                specs.Add((new Vector3(0.06f, 0.3f + i * 0.03f, 0), new Vector3(0.9f - a * 0.4f, 0.5f + a * 0.9f, 0.5f * Mathf.Sin(i * 2.1f)),
                    0.62f + rng.Next() * 0.35f, new Vector3(-0.02f, 0.06f + rng.Next() * 0.04f, 0.03f * (rng.Next() - 0.5f)), 0.05f));
            }
            int id = 1;
            foreach (var s in specs)
            {
                var spine = LimbSpine(rng, s.start, s.dir, s.len, steps, s.curl);
                float r0 = s.r0;
                Func<float, float> radius = t => r0 * (1f - 0.8f * t) * (1f + 0.2f * Mathf.Sin(t * 22f));
                B.AddTube(spine, radius, J, id++);
                var mirrored = new Vector3[spine.Length];
                for (int i = 0; i < spine.Length; i++) mirrored[i] = MirrorX(spine[i]);
                B.AddTube(mirrored, radius, J, id++);
            }
            return new FigureData { Body = B.Build("creature"), Points = Flakes(rng, 140, 1.0f, new Vector3(0, 0.2f, 0)), MinY = B.MinY, Radius = 1.0f };
        }

        // Ink spider: thin jointed legs and a small bulb body, black with a white rim and no stripes.
        static FigureData InkSpider(int density)
        {
            var rng = new Rng(77);
            var B = new BodyBuilder();
            B.AddTube(Line3(new Vector3(0, -0.3f, 0), new Vector3(0, -0.08f, 0), 12), t => 0.02f + 0.1f * Mathf.Pow(SinPos(Mathf.PI * t), 0.8f), 14, 0);
            int pairs = 3 + Clamp(density, 2, 6) / 2;
            int id = 1;
            for (int i = 0; i < pairs; i++)
            {
                float z = -0.3f + 0.6f * i / (pairs - 1);
                var start = new Vector3(0.05f, -0.17f, z * 0.25f);
                var knee = new Vector3(0.32f + 0.1f * rng.Next(), 0.05f + 0.1f * rng.Next(), z * 0.9f);
                var foot = new Vector3(0.7f + 0.15f * rng.Next(), -0.62f, z * 1.5f);
                var spine = Catmull(new[] { start, knee, foot }, 12);
                Func<float, float> radius = t => 0.024f * (1f - 0.65f * t);
                B.AddTube(spine, radius, 8, id++);
                var mirrored = new Vector3[spine.Length];
                for (int k = 0; k < spine.Length; k++) mirrored[k] = MirrorX(spine[k]);
                B.AddTube(mirrored, radius, 8, id++);
            }
            return new FigureData { Body = B.Build("spider"), Points = Flakes(rng, 40, 0.8f, new Vector3(0, -0.2f, 0)), MinY = B.MinY, Radius = 0.9f };
        }
    }
}

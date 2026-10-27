using NUnit.Framework;
using UnityEngine;
using AstralMesh.Geometry;

public class FigureTests
{
    static Mesh[] Meshes(FigureData d) => new[] { d.Lines, d.Points, d.Body };

    [Test]
    public void EveryFigure_BuildsFiniteMeshesAtEveryDensity()
    {
        foreach (var def in Figures.All)
            foreach (int density in new[] { 2, 4, 6 })
            {
                var d = def.Build(density);
                Assert.IsTrue(d.Lines != null || d.Body != null, def.Name + " has nothing to draw");
                foreach (var m in Meshes(d))
                {
                    if (m == null) continue;
                    foreach (var v in m.vertices)
                        Assert.IsTrue(!float.IsNaN(v.x + v.y + v.z) && !float.IsInfinity(v.x + v.y + v.z), def.Name + " " + m.name);
                }
                Assert.IsFalse(float.IsInfinity(d.MinY), def.Name + " has no lowest point");
            }
    }

    [Test]
    public void SolidFigures_AreMirrorSymmetricInX()
    {
        foreach (var name in new[] { "Criatura de bandas", "Araña de tinta" })
        {
            var def = System.Array.Find(Figures.All, f => f.Name == name);
            var verts = def.Build(4).Body.vertices;
            string Key(Vector3 v) => $"{Mathf.Round(v.x * 1e3f)},{Mathf.Round(v.y * 1e3f)},{Mathf.Round(v.z * 1e3f)}";
            var set = new System.Collections.Generic.HashSet<string>();
            foreach (var v in verts) set.Add(Key(v));
            int missing = 0, total = 0;
            foreach (var v in verts)
            {
                if (Mathf.Abs(v.x) < 1e-5f) continue;
                total++;
                if (!set.Contains(Key(new Vector3(-v.x, v.y, v.z)))) missing++;
            }
            Assert.AreEqual(0, missing, name + ": " + missing + " of " + total + " vertices have no mirror");
        }
    }

    [Test]
    public void ContourBlob_IsMirrorSymmetric()
    {
        for (int i = 0; i < 100; i++)
        {
            float h = (i % 10) / 10f + 0.03f, th = i * 0.37f;
            var a = Figures.BlobPoint(h, th); var b = Figures.BlobPoint(h, -th);
            Assert.AreEqual(-a.x, b.x, 1e-5f); Assert.AreEqual(a.y, b.y, 1e-5f); Assert.AreEqual(a.z, b.z, 1e-5f);
        }
    }

    [Test]
    public void SolidFigures_HaveUnitNormals()
    {
        foreach (var def in Figures.All)
        {
            var b = def.Build(4).Body;
            if (b == null) continue;
            foreach (var n in b.normals)
                Assert.AreEqual(1f, n.magnitude, 1e-3f, def.Name + ": a zero normal makes the shader output NaN");
        }
    }

    [Test]
    public void BodyIndices_StayInRange()
    {
        foreach (var def in Figures.All)
        {
            var b = def.Build(4).Body;
            if (b == null) continue;
            int n = b.vertexCount;
            foreach (int i in b.triangles) Assert.Less(i, n, def.Name);
        }
    }
}

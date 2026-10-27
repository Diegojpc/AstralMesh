using NUnit.Framework;
using AstralMesh.Audio;

public class OnsetDetectorTests
{
    [Test]
    public void SuddenBassHit_TriggersKick()
    {
        var d = new OnsetDetector();
        var quiet = new float[1024];
        for (int i = 0; i < 30; i++) d.Process(quiet, 12);
        var hit = new float[1024];
        for (int i = 0; i < 12; i++) hit[i] = 0.8f;
        Assert.AreEqual(1f, d.Process(hit, 12));
    }

    [Test]
    public void Silence_NoKick()
    {
        var d = new OnsetDetector();
        Assert.AreEqual(0f, d.Process(new float[1024], 12));
    }
}

using NUnit.Framework;
using AstralMesh.Audio;

public class LevelNormalizerTests
{
    const float Dt = 1f / 60f;
    static float Lin(float db) => UnityEngine.Mathf.Pow(10f, db / 20f);

    // a quiet beat: bass pulses of -66 dB over a -98 dB floor, every 30 frames (2 per second)
    static (float min, float max, int kicks) RunBeat(float gainDb)
    {
        var n = new LevelNormalizer();
        float min = 1f, max = 0f; int kicks = 0;
        for (int f = 0; f < 60 * 8; f++)
        {
            bool pulse = f % 30 < 4;
            float bass = Lin((pulse ? -66f : -98f) + gainDb);
            var feat = n.Process(bass, Lin(-90f + gainDb), Lin(-95f + gainDb), Dt);
            if (f > 60 * 3)
            {
                min = UnityEngine.Mathf.Min(min, feat.Bass);
                max = UnityEngine.Mathf.Max(max, feat.Bass);
                if (f % 30 == 1 && feat.Kick > 0.9f) kicks++;
            }
        }
        return (min, max, kicks);
    }

    [Test]
    public void QuietBeat_StillSpansTheFullRange()
    {
        var (min, max, _) = RunBeat(0f);
        Assert.Less(min, 0.3f, "valleys between beats should come back down");
        Assert.Greater(max, 0.9f, "beats should reach the top");
    }

    [Test]
    public void Result_DoesNotDependOnMicGain()
    {
        var quiet = RunBeat(0f);
        var loud = RunBeat(30f);
        Assert.AreEqual(quiet.min, loud.min, 0.1f);
        Assert.AreEqual(quiet.max, loud.max, 0.1f);
    }

    [Test]
    public void Beats_TriggerKick()
    {
        Assert.GreaterOrEqual(RunBeat(0f).kicks, 6);
    }

    [Test]
    public void Silence_NoKick()
    {
        var n = new LevelNormalizer();
        AudioFeatures f = default;
        for (int i = 0; i < 200; i++) f = n.Process(Lin(-100f), Lin(-100f), Lin(-100f), Dt);
        Assert.Less(f.Kick, 0.05f);
    }
}

using NUnit.Framework;
using AstralMesh.Audio;

public class BandExtractorTests
{
    const float SampleRate = 48000f;

    static float[] Tone(float hz)
    {
        var s = new float[1024];
        s[(int)(hz / (SampleRate * 0.5f / s.Length))] = 1f;
        return s;
    }

    [Test]
    public void LowTone_LandsInBass()
    {
        var s = Tone(60f);
        Assert.Greater(BandExtractor.Band(s, SampleRate, 20, 250), BandExtractor.Band(s, SampleRate, 4000, 16000));
    }

    [Test]
    public void HighTone_LandsInHighs()
    {
        var s = Tone(8000f);
        Assert.Greater(BandExtractor.Band(s, SampleRate, 4000, 16000), BandExtractor.Band(s, SampleRate, 20, 250));
    }
}

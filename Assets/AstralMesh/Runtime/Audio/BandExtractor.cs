using UnityEngine;

namespace AstralMesh.Audio
{
    /// <summary>Averages FFT magnitudes over a frequency range. Pure function so it is unit-testable.</summary>
    public static class BandExtractor
    {
        public static float Band(float[] spectrum, float sampleRate, float loHz, float hiHz)
        {
            float hzPerBin = sampleRate * 0.5f / spectrum.Length;
            int a = Mathf.Max(1, (int)(loHz / hzPerBin));
            int b = Mathf.Min(spectrum.Length - 1, (int)(hiHz / hzPerBin));
            if (b < a) return 0f;
            float sum = 0f;
            for (int i = a; i <= b; i++) sum += spectrum[i];
            return sum / (b - a + 1);
        }
    }
}

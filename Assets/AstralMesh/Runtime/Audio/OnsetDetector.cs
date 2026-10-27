using UnityEngine;

namespace AstralMesh.Audio
{
    /// <summary>Spectral-flux onset detector over the low bins; returns a decaying 0..1 impulse.</summary>
    public sealed class OnsetDetector
    {
        readonly float threshold, decay, minFlux;
        float[] prev = new float[0];
        float fluxAvg, impulse;

        public OnsetDetector(float threshold = 1.6f, float decay = 0.9f, float minFlux = 1e-4f)
        {
            this.threshold = threshold; this.decay = decay; this.minFlux = minFlux;
        }

        public float Process(float[] spectrum, int binCount)
        {
            if (prev.Length != binCount) prev = new float[binCount];
            float flux = 0f;
            for (int i = 0; i < binCount; i++)
            {
                flux += Mathf.Max(0f, spectrum[i] - prev[i]);
                prev[i] = spectrum[i];
            }
            fluxAvg = Mathf.Lerp(fluxAvg, flux, 0.05f);
            impulse = flux > fluxAvg * threshold && flux > minFlux ? 1f : impulse * decay;
            return impulse;
        }
    }
}

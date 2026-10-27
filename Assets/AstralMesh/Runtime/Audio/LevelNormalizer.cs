using UnityEngine;

namespace AstralMesh.Audio
{
    /// <summary>
    /// Band levels in dB, measured against the sound's own slow moving average and recent peak, so the
    /// result (0..1) does not depend on the microphone gain. Same algorithm as docs/js/audio.js.
    /// Pure C# (no Unity audio calls) so it can be unit-tested with synthetic levels.
    /// </summary>
    public sealed class LevelNormalizer
    {
        readonly float[] avg = new float[3], peak = new float[3], floor = new float[3], env = new float[3];
        bool primed;
        float bassAvg = -100f, kick;

        public float Sensitivity = 1.4f;   // >1 reacts to quieter sound
        public float Release = 0.88f;      // per frame at 60 fps
        public float BassDb { get; private set; } = -100f;

        public void Reset() { primed = false; kick = 0f; bassAvg = -100f; }

        public static float ToDb(float linear) => 20f * Mathf.Log10(linear + 1e-9f);

        /// <param name="bass">linear band average, 20-250 Hz</param>
        public AudioFeatures Process(float bass, float mid, float high, float dt)
        {
            float k = Mathf.Max(dt, 1e-4f) * 60f;    // frame-rate independent smoothing
            var L = new[] { ToDb(bass), ToDb(mid), ToDb(high) };
            BassDb = L[0];
            if (!primed)
            {
                for (int i = 0; i < 3; i++) { floor[i] = peak[i] = avg[i] = L[i]; }
                bassAvg = L[0];
                primed = true;
            }
            for (int i = 0; i < 3; i++)
            {
                avg[i] += (L[i] - avg[i]) * (1f - Mathf.Pow(0.97f, k));
                peak[i] = Mathf.Max(L[i], peak[i] - 0.12f * k);
                floor[i] = Mathf.Min(L[i], floor[i] + 0.03f * k);
                float range = Mathf.Max(10f, peak[i] - avg[i]);
                float v = Mathf.Clamp01(((L[i] - avg[i]) / range + 0.15f) * Sensitivity);
                env[i] = v > env[i] ? v : v + (env[i] - v) * Mathf.Pow(Release, k);
            }
            // onset: bass level jumps well above its recent average
            bassAvg += (L[0] - bassAvg) * (1f - Mathf.Pow(0.92f, k));
            bool onset = L[0] - bassAvg > 4.5f && L[0] > floor[0] + 8f;
            kick = onset ? 1f : kick * Mathf.Pow(0.9f, k);
            return new AudioFeatures(env[0], env[1], env[2], kick);
        }
    }
}

using UnityEngine;

namespace AstralMesh.Audio
{
    [DefaultExecutionOrder(-100)]
    public sealed class AudioReactiveEngine : MonoBehaviour
    {
        const int N = 1024;
        static readonly int AudioId = Shader.PropertyToID("_Audio"); // x=bass y=mid z=high w=kick

        [SerializeField] AudioSource source;
        [SerializeField, Range(0.5f, 0.99f)] float release = 0.88f;
        [SerializeField, Range(0.9f, 0.9999f)] float gainDecay = 0.995f;

        readonly float[] spectrum = new float[N];
        readonly OnsetDetector onset = new OnsetDetector();
        Vector3 env, peak = Vector3.one * 1e-4f;

        public AudioFeatures Current { get; private set; }
        public AudioSource Source { get => source; set => source = value; }

        void Update()
        {
            if (source == null) return;
            source.GetSpectrumData(spectrum, 0, FFTWindow.BlackmanHarris);
            float sr = AudioSettings.outputSampleRate;
            var raw = new Vector3(
                BandExtractor.Band(spectrum, sr, 20, 250),
                BandExtractor.Band(spectrum, sr, 250, 4000),
                BandExtractor.Band(spectrum, sr, 4000, 16000));

            // AutoGain against a decaying peak so the reaction is volume-independent
            for (int i = 0; i < 3; i++)
            {
                peak[i] = Mathf.Max(raw[i], peak[i] * gainDecay);
                float v = raw[i] / peak[i];
                env[i] = v > env[i] ? v : Mathf.Lerp(v, env[i], release); // instant attack, smooth release
            }

            int bassBins = Mathf.CeilToInt(250f / (sr * 0.5f / N));
            float kick = onset.Process(spectrum, bassBins);

            Current = new AudioFeatures(env.x, env.y, env.z, kick);
            Shader.SetGlobalVector(AudioId, new Vector4(env.x, env.y, env.z, kick));
        }
    }
}

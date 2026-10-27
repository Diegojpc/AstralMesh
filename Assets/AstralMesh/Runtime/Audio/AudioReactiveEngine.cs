using UnityEngine;

namespace AstralMesh.Audio
{
    [DefaultExecutionOrder(-100)]
    public sealed class AudioReactiveEngine : MonoBehaviour
    {
        const int N = 1024;
        static readonly int AudioId = Shader.PropertyToID("_Audio"); // x=bass y=mid z=high w=kick

        [SerializeField] AudioSource source;

        readonly float[] spectrum = new float[N];
        readonly LevelNormalizer levels = new LevelNormalizer();

        public AudioFeatures Current { get; private set; }
        public AudioSource Source { get => source; set => source = value; }
        public float Sensitivity { get => levels.Sensitivity; set => levels.Sensitivity = value; }

        void Update()
        {
            if (source == null) return;
            source.GetSpectrumData(spectrum, 0, FFTWindow.BlackmanHarris);
            float sr = AudioSettings.outputSampleRate;
            Current = levels.Process(
                BandExtractor.Band(spectrum, sr, 20, 250),
                BandExtractor.Band(spectrum, sr, 250, 4000),
                BandExtractor.Band(spectrum, sr, 4000, 16000),
                Time.unscaledDeltaTime);
            Shader.SetGlobalVector(AudioId, new Vector4(Current.Bass, Current.Mid, Current.High, Current.Kick));
        }
    }
}

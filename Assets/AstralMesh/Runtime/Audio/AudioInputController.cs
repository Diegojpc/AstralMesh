using System.Collections;
using UnityEngine;

namespace AstralMesh.Audio
{
    /// <summary>Owns the AudioSource and switches between microphone and file input.</summary>
    public sealed class AudioInputController : MonoBehaviour
    {
        [SerializeField] AudioSource source;
        IAudioSourceProvider active;
        Coroutine routine;

        void Start() => UseMicrophone();

        public void UseMicrophone() => Switch(new MicrophoneProvider(), silenceOutput: true);

        public void UseFile(string path) => Switch(new FileAudioProvider(path), silenceOutput: false);

        public void PickFile()
        {
            if (NativeFilePicker.IsFilePickerBusy()) return;
            NativeFilePicker.PickFile(path => { if (!string.IsNullOrEmpty(path)) UseFile(path); },
                NativeFilePicker.ConvertExtensionToFileType("mp3"),
                NativeFilePicker.ConvertExtensionToFileType("wav"));
        }

        void Switch(IAudioSourceProvider next, bool silenceOutput)
        {
            if (routine != null) StopCoroutine(routine);
            active?.End(source);
            active = next;
            // Mic input must not play back through the speaker (feedback). The spectrum is read
            // at the source, upstream of the listener, so silencing the listener keeps analysis alive.
            AudioListener.volume = silenceOutput ? 0f : 1f;
            routine = StartCoroutine(next.Begin(source));
        }
    }
}

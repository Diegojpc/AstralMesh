using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace AstralMesh.Audio
{
    public sealed class FileAudioProvider : IAudioSourceProvider
    {
        readonly string path;
        public FileAudioProvider(string path) { this.path = path; }

        public IEnumerator Begin(AudioSource target)
        {
            var type = path.EndsWith(".wav", System.StringComparison.OrdinalIgnoreCase) ? AudioType.WAV : AudioType.MPEG;
            using var req = UnityWebRequestMultimedia.GetAudioClip("file://" + path, type);
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[AstralMesh] audio load failed: {req.error}");
                yield break;
            }
            target.clip = DownloadHandlerAudioClip.GetContent(req);
            target.loop = true;
            target.Play();
        }

        public void End(AudioSource target) => target.Stop();
    }
}

using System.Collections;
using UnityEngine;
#if UNITY_ANDROID
using UnityEngine.Android;
#endif

namespace AstralMesh.Audio
{
    public sealed class MicrophoneProvider : IAudioSourceProvider
    {
        string device;

        public IEnumerator Begin(AudioSource target)
        {
#if UNITY_ANDROID
            if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                Permission.RequestUserPermission(Permission.Microphone);
                yield return new WaitUntil(() => Permission.HasUserAuthorizedPermission(Permission.Microphone));
            }
#else
            yield return Application.RequestUserAuthorization(UserAuthorization.Microphone);
#endif
            if (Microphone.devices.Length == 0) yield break;
            device = Microphone.devices[0];
            target.clip = Microphone.Start(device, true, 1, 48000);
            target.loop = true;
            yield return new WaitUntil(() => Microphone.GetPosition(device) > 0);
            target.Play();
        }

        public void End(AudioSource target)
        {
            if (device != null) Microphone.End(device);
            target.Stop();
        }
    }
}

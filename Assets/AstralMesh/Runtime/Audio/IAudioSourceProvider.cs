using System.Collections;
using UnityEngine;

namespace AstralMesh.Audio
{
    public interface IAudioSourceProvider
    {
        IEnumerator Begin(AudioSource target);
        void End(AudioSource target);
    }
}

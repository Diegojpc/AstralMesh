namespace AstralMesh.Audio
{
    public readonly struct AudioFeatures
    {
        public readonly float Bass, Mid, High, Kick;
        public AudioFeatures(float bass, float mid, float high, float kick)
        {
            Bass = bass; Mid = mid; High = high; Kick = kick;
        }
    }
}

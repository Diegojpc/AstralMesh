using UnityEngine;

namespace AstralMesh.Control
{
    [CreateAssetMenu(menuName = "AstralMesh/Palette")]
    public sealed class PaletteSO : ScriptableObject
    {
        [ColorUsage(false, true)] public Color colorA = new Color(1f, 0f, 0.8f) * 2f;   // neon magenta
        [ColorUsage(false, true)] public Color colorB = new Color(0.1f, 1f, 0.3f) * 2f; // glowing green
        [ColorUsage(false, true)] public Color colorC = new Color(0.1f, 0.4f, 1f) * 2f; // third band colour
        [Tooltip("Colour comes from a hue ramp over the figure's depth instead of the colour set")]
        public bool rainbow;
    }
}

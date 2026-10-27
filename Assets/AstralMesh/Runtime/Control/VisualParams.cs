using UnityEngine;

namespace AstralMesh.Control
{
    [System.Serializable]
    public struct VisualParams
    {
        [Range(0f, 2f)] public float expand;   // bass -> radial expansion gain
        [Range(0f, 4f)] public float twist;    // mid  -> twist gain
        [Range(0f, 3f)] public float speed;    // animation speed
        [Range(0f, 2f)] public float deform;   // surface deformation
        [Range(2, 6)] public int density;      // recursion level / lattice density

        public static VisualParams Default => new VisualParams { expand = 0.6f, twist = 1.5f, speed = 1f, deform = 0.5f, density = 4 };
    }
}

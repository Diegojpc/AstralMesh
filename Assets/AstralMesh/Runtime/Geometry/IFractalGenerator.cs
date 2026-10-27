using UnityEngine;

namespace AstralMesh.Geometry
{
    /// <summary>
    /// Builds a line-topology mesh once. uv2 = (normalized recursion depth, ring index, node id)
    /// so the shader can animate by depth without the CPU touching vertices again.
    /// </summary>
    public interface IFractalGenerator
    {
        string Name { get; }
        Mesh Build(int density);
    }
}

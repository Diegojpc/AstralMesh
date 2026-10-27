using UnityEngine;
using UnityEngine.InputSystem.EnhancedTouch;
using Touch = UnityEngine.InputSystem.EnhancedTouch.Touch;

namespace AstralMesh.Control
{
    /// <summary>Two-finger pinch scales, two-finger twist rotates the content.</summary>
    public sealed class GestureController : MonoBehaviour
    {
        [SerializeField] Transform content;

        void OnEnable() => EnhancedTouchSupport.Enable();

        void Update()
        {
            if (Touch.activeTouches.Count != 2) return;
            var a = Touch.activeTouches[0]; var b = Touch.activeTouches[1];
            Vector2 prevA = a.screenPosition - a.delta, prevB = b.screenPosition - b.delta;
            float prevDist = (prevA - prevB).magnitude, dist = (a.screenPosition - b.screenPosition).magnitude;
            if (prevDist > 1f) content.localScale *= Mathf.Clamp(dist / prevDist, 0.9f, 1.1f);
            float angle = Vector2.SignedAngle(prevA - prevB, a.screenPosition - b.screenPosition);
            content.Rotate(0f, -angle, 0f, Space.World);
        }
    }
}

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem.EnhancedTouch;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Touch = UnityEngine.InputSystem.EnhancedTouch.Touch;

namespace AstralMesh.AR
{
    /// <summary>Tap -> plane raycast -> move content. Falls back to 1.5 m in front of the camera.</summary>
    public sealed class ARPlacementController : MonoBehaviour
    {
        [SerializeField] ARRaycastManager raycaster;
        [SerializeField] Transform content;
        [SerializeField] Camera arCamera;
        static readonly List<ARRaycastHit> Hits = new List<ARRaycastHit>();

        void OnEnable() => EnhancedTouchSupport.Enable();
        void OnDisable() => EnhancedTouchSupport.Disable();

        void Start() => PlaceInFront();

        void Update()
        {
            if (Touch.activeTouches.Count != 1) return;
            var t = Touch.activeTouches[0];
            if (t.phase != UnityEngine.InputSystem.TouchPhase.Began) return;
            if (raycaster.Raycast(t.screenPosition, Hits, TrackableType.PlaneWithinPolygon))
                Place(Hits[0].pose.position + Vector3.up * 0.3f);
        }

        void PlaceInFront() => Place(arCamera.transform.position + FlatForward() * 1.5f);

        Vector3 FlatForward()
        {
            var f = arCamera.transform.forward; f.y = 0f;
            return f.sqrMagnitude < 1e-4f ? Vector3.forward : f.normalized;
        }

        // The mandala meshes lie in the local XZ plane (normal = local Y), so point that normal back at
        // the viewer; otherwise a mandala placed at eye height is seen edge-on and looks invisible.
        void Place(Vector3 position)
        {
            content.position = position;
            var toCamera = arCamera.transform.position - position; toCamera.y = 0f;
            if (toCamera.sqrMagnitude < 1e-4f) toCamera = -FlatForward();
            content.rotation = Quaternion.FromToRotation(Vector3.up, toCamera.normalized);
        }
    }
}

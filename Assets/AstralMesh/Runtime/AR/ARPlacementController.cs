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
                content.position = Hits[0].pose.position + Vector3.up * 0.3f;
        }

        void PlaceInFront() =>
            content.position = arCamera.transform.position + arCamera.transform.forward * 1.5f;
    }
}

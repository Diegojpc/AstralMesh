using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem.EnhancedTouch;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using AstralMesh.Geometry;
using Touch = UnityEngine.InputSystem.EnhancedTouch.Touch;

namespace AstralMesh.AR
{
    /// <summary>
    /// Tap the floor to stand the figure there, held by an ARAnchor so it stays put in the room
    /// while you walk around it. Starts 3 m ahead of the camera. With no AR (emulator) only the
    /// initial placement happens.
    /// </summary>
    public sealed class ARPlacementController : MonoBehaviour
    {
        [SerializeField] ARRaycastManager raycaster;
        [SerializeField] ARAnchorManager anchors;
        [SerializeField] MandalaRenderer mandala;
        [SerializeField] Camera arCamera;
        const float StartDistance = 3f;
        static readonly List<ARRaycastHit> Hits = new List<ARRaycastHit>();
        ARAnchor anchor;
        float lastGround = float.NaN;

        void OnEnable() => EnhancedTouchSupport.Enable();
        void OnDisable() => EnhancedTouchSupport.Disable();

        void Start() => PlaceInFront();

        void PlaceInFront()
        {
            var f = arCamera.transform.forward; f.y = 0f;
            f = f.sqrMagnitude < 1e-4f ? Vector3.forward : f.normalized;
            var p = arCamera.transform.position + f * StartDistance;
            mandala.PlaceAt(new Vector3(p.x, AstralEnvironment.GroundY, p.z), arCamera.transform.position);
        }

        void Update()
        {
            // a detected plane may move the floor: keep the feet on it
            if (!Mathf.Approximately(lastGround, AstralEnvironment.GroundY)) { lastGround = AstralEnvironment.GroundY; mandala.Stand(); }

            if (Touch.activeTouches.Count != 1) return;
            var t = Touch.activeTouches[0];
            if (t.phase != UnityEngine.InputSystem.TouchPhase.Ended) return;
            if (raycaster == null || !raycaster.Raycast(t.screenPosition, Hits, TrackableType.PlaneWithinPolygon)) return;

            var pose = Hits[0].pose;
            AstralEnvironment.SetGround(pose.position.y);
            mandala.PlaceAt(pose.position, arCamera.transform.position);
            Anchor(pose);
        }

        // parent the figure to an anchor so the tracking system keeps it fixed in the room
        async void Anchor(Pose pose)
        {
            if (anchors == null) return;
            var result = await anchors.TryAddAnchorAsync(pose);
            if (!result.status.IsSuccess()) return;
            if (anchor != null) { mandala.transform.SetParent(null, true); Destroy(anchor.gameObject); }
            anchor = result.value;
            mandala.transform.SetParent(anchor.transform, true);
        }
    }
}

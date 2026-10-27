using UnityEngine;
using AstralMesh.Control;

namespace AstralMesh.Geometry
{
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class MandalaRenderer : MonoBehaviour
    {
        [SerializeField] ReactiveParameterBus bus;
        [SerializeField] Material wireMaterial;

        readonly IFractalGenerator[] generators =
        {
            new RadialMandalaGenerator(), new SierpinskiWireGenerator(), new PhyllotaxisLatticeGenerator()
        };
        int current;
        MeshFilter filter;

        public string[] GeneratorNames
        {
            get { var n = new string[generators.Length]; for (int i = 0; i < n.Length; i++) n[i] = generators[i].Name; return n; }
        }

        void Awake()
        {
            filter = GetComponent<MeshFilter>();
            GetComponent<MeshRenderer>().sharedMaterial = wireMaterial;
        }

        void OnEnable() { bus.DensityCommitted += Rebuild; Rebuild(bus.Params.density); }
        void OnDisable() => bus.DensityCommitted -= Rebuild;

        public void SelectGeometry(int index) { current = Mathf.Clamp(index, 0, generators.Length - 1); Rebuild(bus.Params.density); }

        void Rebuild(int density)
        {
            if (filter.sharedMesh != null) Destroy(filter.sharedMesh);
            filter.sharedMesh = generators[current].Build(density);
        }

        void Update()
        {
            // mid-band rotation is also applied on the CPU transform; shader handles per-depth twist
            transform.Rotate(0f, 20f * bus.Params.speed * Time.deltaTime, 0f, Space.Self);
        }
    }
}

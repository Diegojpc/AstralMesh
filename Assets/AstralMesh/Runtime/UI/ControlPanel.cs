using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;
using AstralMesh.Audio;
using AstralMesh.Control;
using AstralMesh.Geometry;

namespace AstralMesh.UI
{
    /// <summary>Builds the overlay in code, so there is no UXML to keep in sync.</summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class ControlPanel : MonoBehaviour
    {
        [SerializeField] ReactiveParameterBus bus;
        [SerializeField] MandalaRenderer mandala;
        [SerializeField] AudioInputController audioInput;
        [SerializeField] AudioReactiveEngine engine;

        DropdownField geoDropdown, palDropdown;

        void OnEnable()
        {
            var root = GetComponent<UIDocument>().rootVisualElement;
            root.Clear();
            var panel = new VisualElement { style = { position = Position.Absolute, bottom = 16, left = 16, right = 16,
                backgroundColor = new Color(0, 0, 0, 0.45f), paddingBottom = 8, paddingTop = 8, paddingLeft = 12, paddingRight = 12 } };
            root.Add(panel);

            var row = new VisualElement { style = { flexDirection = FlexDirection.Row } };
            row.Add(new Button(audioInput.UseMicrophone) { text = "Mic", style = { flexGrow = 1 } });
#if !UNITY_IOS // UIDocumentPicker needs a paid-account entitlement; free-signed builds cannot use it
            row.Add(new Button(audioInput.PickFile) { text = "File", style = { flexGrow = 1 } });
#endif
            panel.Add(row);

            geoDropdown = new DropdownField("Geometry", new List<string>(mandala.GeneratorNames), mandala.Current);
            geoDropdown.RegisterValueChangedCallback(e => mandala.SelectGeometry(geoDropdown.index));
            panel.Add(geoDropdown);

            var names = new List<string>();
            foreach (var p in bus.Palettes) names.Add(p.name);
            palDropdown = new DropdownField("Palette", names, Mathf.Max(0, bus.PaletteIndex));
            palDropdown.RegisterValueChangedCallback(e => bus.SelectPalette(palDropdown.index));
            panel.Add(palDropdown);

            Slider(panel, "Expand", 0, 2, bus.Params.expand, v => bus.Params.expand = v);
            Slider(panel, "Twist", 0, 4, bus.Params.twist, v => bus.Params.twist = v);
            Slider(panel, "Speed", 0, 3, bus.Params.speed, v => bus.Params.speed = v);
            Slider(panel, "Deform", 0, 2, bus.Params.deform, v => bus.Params.deform = v);
            Slider(panel, "Sensitivity", 0.5f, 3f, engine != null ? engine.Sensitivity : 1.4f, v => { if (engine != null) engine.Sensitivity = v; });

            var density = new SliderInt("Density", 2, 6) { value = bus.Params.density };
            density.RegisterValueChangedCallback(e => bus.Params.density = e.newValue);
            density.RegisterCallback<PointerCaptureOutEvent>(_ => bus.CommitDensity());
            panel.Add(density);

            bus.PaletteChanged += OnPaletteChanged;
            mandala.GeometryChanged += OnGeometryChanged;
        }

        void OnDisable()
        {
            bus.PaletteChanged -= OnPaletteChanged;
            mandala.GeometryChanged -= OnGeometryChanged;
        }

        // keep the dropdowns in step when the figure or palette changes from code / the launch intent
        void OnPaletteChanged(int i) { if (palDropdown != null) palDropdown.SetValueWithoutNotify(palDropdown.choices[i]); }
        void OnGeometryChanged(int i) { if (geoDropdown != null) geoDropdown.SetValueWithoutNotify(geoDropdown.choices[i]); }

        static void Slider(VisualElement parent, string label, float min, float max, float value, System.Action<float> set)
        {
            var s = new UnityEngine.UIElements.Slider(label, min, max) { value = value };
            s.RegisterValueChangedCallback(e => set(e.newValue));
            parent.Add(s);
        }
    }
}

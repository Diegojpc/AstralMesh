using UnityEngine;
using UnityEngine.UIElements;
using AstralMesh.Control;
using AstralMesh.Geometry;
using AstralMesh.Audio;

namespace AstralMesh.UI
{
    /// <summary>Builds the overlay in code so there is no UXML dependency to keep in sync.</summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class ControlPanel : MonoBehaviour
    {
        [SerializeField] ReactiveParameterBus bus;
        [SerializeField] MandalaRenderer mandala;
        [SerializeField] PaletteSO[] palettes;
        [SerializeField] AudioInputController audioInput;

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

            var geo = new DropdownField("Geometry", new System.Collections.Generic.List<string>(mandala.GeneratorNames), 0);
            geo.RegisterValueChangedCallback(e => mandala.SelectGeometry(geo.index));
            panel.Add(geo);

            if (palettes != null && palettes.Length > 0)
            {
                var names = new System.Collections.Generic.List<string>();
                foreach (var p in palettes) names.Add(p.name);
                var pal = new DropdownField("Palette", names, 0);
                bus.Palette = palettes[0];
                pal.RegisterValueChangedCallback(e => bus.Palette = palettes[pal.index]);
                panel.Add(pal);
            }

            Slider(panel, "Expand", 0, 2, bus.Params.expand, v => bus.Params.expand = v);
            Slider(panel, "Twist", 0, 4, bus.Params.twist, v => bus.Params.twist = v);
            Slider(panel, "Speed", 0, 3, bus.Params.speed, v => bus.Params.speed = v);
            Slider(panel, "Deform", 0, 2, bus.Params.deform, v => bus.Params.deform = v);

            var density = new SliderInt("Density", 2, 6) { value = bus.Params.density };
            density.RegisterValueChangedCallback(e => bus.Params.density = e.newValue);
            density.RegisterCallback<PointerCaptureOutEvent>(_ => bus.CommitDensity());
            panel.Add(density);
        }

        static void Slider(VisualElement parent, string label, float min, float max, float value, System.Action<float> set)
        {
            var s = new UnityEngine.UIElements.Slider(label, min, max) { value = value };
            s.RegisterValueChangedCallback(e => set(e.newValue));
            parent.Add(s);
        }
    }
}

// Line and point figures: additive neon over the AR camera, with Bloom giving the glow.
Shader "AstralMesh/MandalaWire"
{
    Properties
    {
        _PointSize ("Point size (px)", Float) = 6
        [Toggle] _Flake ("Flakes (palette-coloured, blinking)", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+1" "RenderPipeline"="UniversalPipeline" }
        Blend One One
        ZWrite Off
        ZTest Always
        Cull Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "MandalaCommon.hlsl"

            float _PointSize;
            float _Flake;

            struct Attributes { float3 positionOS : POSITION; float2 uv2 : TEXCOORD1; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 color : TEXCOORD0; float psize : PSIZE; };

            Varyings vert(Attributes v)
            {
                float depth = v.uv2.x, node = v.uv2.y;
                float3 p = DisplaceLine(v.positionOS, depth);
                float shimmer = step(0.7, Hash(node + frac(depth) + floor(_Time.y * 30.0)));

                float3 baseC = lerp(_ColorA.rgb, _ColorB.rgb, depth);
                if (_Rainbow > 0.5) baseC = Hue(depth * 0.9 + _Time.y * 0.04);
                float3 col = baseC * (0.75 + _Audio.x * 0.5 + _Audio.z * 2.5 * shimmer);

                float size = _PointSize * (1.0 + _Audio.z * shimmer * 1.5);
                if (_Flake > 0.5)
                {
                    // flakes drift on their own and take a palette colour each
                    float n = node;
                    p = v.positionOS + 0.05 * float3(sin(_Time.y * 0.9 + n), cos(_Time.y * 0.7 + n * 1.3), sin(_Time.y * 0.8 + n * 0.7));
                    p *= 1.0 + _Audio.x * _Params.x * 0.12;
                    float pick = Hash(n);
                    float3 b = pick < 0.5 ? _ColorA.rgb : (pick < 0.8 ? _ColorB.rgb : _ColorC.rgb);
                    if (_Rainbow > 0.5) b = Hue(pick);
                    float blink = 0.55 + 0.45 * step(0.5, Hash(n + floor(_Time.y * 8.0)));
                    col = b * blink * (0.8 + _Audio.z * 1.5);
                    size = _PointSize * 0.7;
                }

                Varyings o;
                o.positionCS = TransformObjectToHClip(p);
                o.color = col;
                o.psize = size;
                return o;
            }

            half4 frag(Varyings i) : SV_Target { return half4(min(i.color, 1.5), 1); }
            ENDHLSL
        }
    }
}

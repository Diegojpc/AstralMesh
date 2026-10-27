// Solid figures: near-black body with neon bands that wrap the limbs and a palette-tinted rim.
Shader "AstralMesh/MandalaBody"
{
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }
        ZWrite On
        ZTest LEqual
        Cull Back

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "MandalaCommon.hlsl"

            struct Attributes { float3 positionOS : POSITION; float3 normalOS : NORMAL; float2 uvT : TEXCOORD1; float2 uvA : TEXCOORD2; };
            struct Varyings { float4 positionCS : SV_POSITION; float t : TEXCOORD0; float ang : TEXCOORD1; float node : TEXCOORD2; float3 nrm : TEXCOORD3; float3 world : TEXCOORD4; };

            Varyings vert(Attributes v)
            {
                float3 p = DisplaceMesh(v.positionOS, v.uvT.x, v.uvT.y);
                Varyings o;
                o.world = TransformObjectToWorld(p);
                o.positionCS = TransformWorldToHClip(o.world);
                o.nrm = TransformObjectToWorldNormal(v.normalOS);
                o.t = v.uvT.x; o.node = v.uvT.y; o.ang = v.uvA.x;
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float3 N = normalize(i.nrm + 1e-5);   // a zero normal would turn the pixel white (NaN)
                float3 V = normalize(_WorldSpaceCameraPos - i.world);
                float rim = pow(1.0 - abs(dot(N, V)), 2.2);
                float3 neon = 0; float stripeMask = 0;
                if (_Stripe.x > 0.0)
                {
                    float band = i.t * _Stripe.x + i.ang * _Stripe.z - _Time.y * _Stripe.y;
                    float f = frac(band);
                    stripeMask = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.4, 0.5, f));
                    float idx = floor(band);
                    float m = idx - 3.0 * floor(idx / 3.0);
                    neon = m < 1.0 ? _ColorA.rgb : (m < 2.0 ? _ColorB.rgb : _ColorC.rgb);
                    if (_Rainbow > 0.5) neon = Hue(i.t * 0.8 + idx * 0.13 + _Time.y * 0.03);
                }
                float flash = step(0.6, Hash(i.node + floor(_Time.y * 20.0)));
                float glow = 0.75 + _Audio.x * 0.7 + _Audio.z * 0.6 * flash;
                float lit = max(dot(N, normalize(_AstralLightDir.xyz)), 0.0) * _AstralLightStrength;
                float3 col = float3(0.01, 0.012, 0.02) + float3(0.05, 0.06, 0.09) * lit;
                col += neon * stripeMask * glow * 1.1;
                col += lerp(_ColorA.rgb, _ColorB.rgb, 0.5) * rim * _Stripe.w * 0.55 * glow;
                return half4(min(col, 1.5), 1);
            }
            ENDHLSL
        }
    }
}

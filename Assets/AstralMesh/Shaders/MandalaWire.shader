Shader "AstralMesh/MandalaWire"
{
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float4 _Audio;   // x=bass y=mid z=high w=kick
            float4 _Params;  // x=expand y=twist z=speed w=deform
            float4 _ColorA;
            float4 _ColorB;

            struct Attributes { float3 positionOS : POSITION; float2 uv2 : TEXCOORD1; };
            struct Varyings  { float4 positionCS : SV_POSITION; float3 color : TEXCOORD0; };

            float hash(float n) { return frac(sin(n * 12.9898) * 43758.5453); }

            Varyings vert(Attributes v)
            {
                float depth = v.uv2.x;
                float wave = saturate(1.0 - abs(depth - frac(_Time.y * _Params.z)) * 6.0) * _Audio.w;
                float3 p = v.positionOS * (1.0 + _Audio.x * _Params.x + wave * 0.3);

                float ang = _Audio.y * _Params.y * depth;
                float s, c; sincos(ang, s, c);
                p.xz = float2(c * p.x - s * p.z, s * p.x + c * p.z);
                p.y += sin(depth * 20.0 + _Time.y * _Params.z) * _Params.w * _Audio.y * 0.05;

                float shimmer = step(0.7, hash(v.uv2.y + frac(depth) + floor(_Time.y * 30.0)));
                Varyings o;
                o.positionCS = TransformObjectToHClip(p);
                o.color = lerp(_ColorA.rgb, _ColorB.rgb, depth) * (1.0 + _Audio.z * 4.0 * shimmer);
                return o;
            }

            half4 frag(Varyings i) : SV_Target { return half4(i.color, 1); }
            ENDHLSL
        }
    }
}

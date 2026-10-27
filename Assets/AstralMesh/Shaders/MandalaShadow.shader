// Ground shadow: the figure's displaced vertices slid along the light direction onto the floor.
// Solid bodies use a stencil test so overlapping projected triangles darken the pixel only once
// (one even, hard-edged silhouette); lines and points are drawn as a softer, lighter shadow.
Shader "AstralMesh/MandalaShadow"
{
    Properties
    {
        _Kind ("0 line, 1 solid body, 2 point", Float) = 0
        _Alpha ("Alpha", Range(0, 1)) = 0.4
        _PointSize ("Point size (px)", Float) = 8
        [Enum(UnityEngine.Rendering.CompareFunction)] _StencilComp ("Stencil comparison", Float) = 8
        [Enum(UnityEngine.Rendering.StencilOp)] _StencilPass ("Stencil pass", Float) = 0
    }
    SubShader
    {
        // drawn in the opaque pass, before the body, so it never covers the figure
        Tags { "RenderType"="Opaque" "Queue"="Geometry-10" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        ZTest Always
        Cull Off

        Pass
        {
            Stencil { Ref 1 Comp [_StencilComp] Pass [_StencilPass] }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "MandalaCommon.hlsl"

            float _Kind, _Alpha, _PointSize;

            struct Attributes { float3 positionOS : POSITION; float2 uv2 : TEXCOORD1; };
            struct Varyings { float4 positionCS : SV_POSITION; float alpha : TEXCOORD0; float psize : PSIZE; };

            Varyings vert(Attributes v)
            {
                float3 p = (_Kind > 0.5 && _Kind < 1.5) ? DisplaceMesh(v.positionOS, v.uv2.x, v.uv2.y) : DisplaceLine(v.positionOS, v.uv2.x);
                float3 wp = TransformObjectToWorld(p);
                float height = max(0.0, wp.y - _AstralGround);
                Varyings o;
                o.positionCS = TransformWorldToHClip(ToGround(wp));
                o.alpha = _Alpha * saturate(0.6 + 0.6 * _AstralLightStrength - height * 0.15);
                o.psize = _PointSize * (1.0 + height * 1.2);   // penumbra grows with height
                return o;
            }

            half4 frag(Varyings i) : SV_Target { return half4(0, 0, 0, i.alpha); }
            ENDHLSL
        }
    }
}

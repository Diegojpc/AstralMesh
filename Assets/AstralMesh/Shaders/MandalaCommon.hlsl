#ifndef ASTRALMESH_COMMON_INCLUDED
#define ASTRALMESH_COMMON_INCLUDED

// Globals published by the C# side (ReactiveParameterBus, MandalaRenderer, AstralEnvironment).
float4 _Audio;               // bass mid high kick
float4 _Params;              // expand twist speed deform
float4 _Stripe;              // bands, scroll speed, spiral twist, rim gain
float4 _ColorA, _ColorB, _ColorC;
float _Rainbow, _Wing, _Dance;
float _AstralGround;         // world y of the floor
float4 _AstralLightDir;      // xyz: direction towards the light
float _AstralLightStrength;

float Hash(float n) { return frac(sin(n * 12.9898) * 43758.5453); }
float3 Hue(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + float3(0.0, 0.33, 0.67))); }

// line / point figures: expansion on bass, kick wave, twist on mid, wobble, wings fold on bass
float3 DisplaceLine(float3 position, float depth)
{
    float wave = saturate(1.0 - abs(depth - frac(_Time.y * _Params.z)) * 6.0) * _Audio.w;
    float3 p = position * (1.0 + _Audio.x * _Params.x + wave * 0.3);
    float ang = _Audio.y * _Params.y * depth;
    float s, c; sincos(ang, s, c);
    p.xz = float2(c * p.x - s * p.z, s * p.x + c * p.z);
    p.y += sin(depth * 20.0 + _Time.y * _Params.z) * _Params.w * _Audio.y * 0.05;
    p.z += abs(p.x) * _Wing * (0.25 + _Audio.x * 0.9);
    return p;
}

// solid bodies: bass swells them and reaches the limbs outward, mid makes mirrored limbs dance
float3 DisplaceMesh(float3 position, float t, float limb)
{
    float wave = saturate(1.0 - abs(t - frac(_Time.y * _Params.z * 0.6)) * 5.0) * _Audio.w;
    float3 p = position * (1.0 + _Audio.x * _Params.x * 0.18 + wave * 0.06);
    p.xz *= 1.0 + _Audio.x * _Params.x * 0.5 * t;
    float ang = _Audio.y * _Params.y * 0.5 * t;
    float s, c; sincos(ang, s, c);
    p.xz = float2(c * p.x - s * p.z, s * p.x + c * p.z);
    if (_Dance > 0.5)
    {
        float side = frac(limb * 0.5) > 0.25 ? 1.0 : -1.0;   // odd ids are the right side, even the mirrored left
        float ph = floor((limb + 1.0) * 0.5) * 1.7;
        float amp = (0.05 + _Audio.y * _Params.w * 0.22) * t * t * step(0.5, limb);
        float a = sin(_Time.y * (1.5 + _Params.z * 1.5) + ph - t * 5.0);
        float b = cos(_Time.y * (1.2 + _Params.z) + ph * 0.7 - t * 4.0);
        p += float3(side * a * amp, b * amp * 0.8, a * b * amp * 0.6);
    }
    else
    {
        p.y += sin(t * 18.0 + _Time.y * _Params.z) * _Params.w * _Audio.y * 0.03;
    }
    return p;
}

// slide a world point along the light direction until it reaches the floor plane
float3 ToGround(float3 wp)
{
    float3 L = normalize(_AstralLightDir.xyz);
    float ly = max(L.y, 0.28);
    float k = clamp((wp.y - _AstralGround) / ly, 0.0, 6.0);
    return float3(wp.x - L.x * k, _AstralGround, wp.z - L.z * k);
}

#endif

// Materials for the three figure layers (solid body, lines, points) and their ground shadows.

export function makeUniforms(THREE) {
  return {
    uAudio: { value: new THREE.Vector4() },        // bass mid high kick
    uParams: { value: new THREE.Vector4() },       // expand twist speed deform
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uColorC: { value: new THREE.Color() },
    uRainbow: { value: 0 },
    uWing: { value: 0 },
    uDance: { value: 0 },
    uStripe: { value: new THREE.Vector4() },       // bands, scroll speed, spiral twist, rim gain
    uGround: { value: -1.15 },                     // world y of the floor
    uLightDir: { value: new THREE.Vector3(0.25, 0.9, 0.35).normalize() }, // towards the light
    uLightStrength: { value: 0.4 },
    uShadowLuma: { value: 0.08 },                  // shadow brightness for the min-blend variant
    uSize: { value: 8 },
    uPixelRatio: { value: 1 },
  };
}

// shared GLSL: audio-reactive displacement for line/point figures and for solid bodies
const COMMON = /* glsl */ `
  uniform vec4 uAudio; uniform vec4 uParams; uniform float uTime;
  uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC; uniform float uRainbow;
  uniform float uWing; uniform float uDance; uniform vec4 uStripe;
  uniform float uGround; uniform vec3 uLightDir; uniform float uLightStrength;
  uniform float uSize; uniform float uPixelRatio;
  attribute float aDepth; attribute float aNode; attribute float aAng;
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

  vec3 displaceLine(vec3 position, float depth) {
    float wave = clamp(1.0 - abs(depth - fract(uTime * uParams.z)) * 6.0, 0.0, 1.0) * uAudio.w;
    vec3 p = position * (1.0 + uAudio.x * uParams.x + wave * 0.3);
    float ang = uAudio.y * uParams.y * depth;
    float s = sin(ang), c = cos(ang);
    p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
    p.y += sin(depth * 20.0 + uTime * uParams.z) * uParams.w * uAudio.y * 0.05;
    p.z += abs(p.x) * uWing * (0.25 + uAudio.x * 0.9);   // wings fold toward the viewer on bass
    return p;
  }

  // solid body: bass swells it and reaches the limbs outward, mid makes mirrored limbs dance
  vec3 displaceMesh(vec3 position, float t, float limb) {
    float wave = clamp(1.0 - abs(t - fract(uTime * uParams.z * 0.6)) * 5.0, 0.0, 1.0) * uAudio.w;
    vec3 p = position * (1.0 + uAudio.x * uParams.x * 0.18 + wave * 0.06);
    p.xz *= 1.0 + uAudio.x * uParams.x * 0.5 * t;
    float ang = uAudio.y * uParams.y * 0.5 * t;
    float s = sin(ang), c = cos(ang);
    p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
    if (uDance > 0.5) {
      float side = mod(limb, 2.0) > 0.5 ? 1.0 : -1.0;       // odd ids are the right side, even the mirrored left
      float ph = floor((limb + 1.0) * 0.5) * 1.7;
      float amp = (0.05 + uAudio.y * uParams.w * 0.22) * t * t * step(0.5, limb);
      float a = sin(uTime * (1.5 + uParams.z * 1.5) + ph - t * 5.0);
      float b = cos(uTime * (1.2 + uParams.z) + ph * 0.7 - t * 4.0);
      p += vec3(side * a * amp, b * amp * 0.8, a * b * amp * 0.6);
    } else {
      p.y += sin(t * 18.0 + uTime * uParams.z) * uParams.w * uAudio.y * 0.03;
    }
    return p;
  }

  // slide a world point along the light direction until it reaches the floor plane
  vec3 toGround(vec3 wp) {
    vec3 L = normalize(uLightDir);
    float ly = max(L.y, 0.28);
    float k = clamp((wp.y - uGround) / ly, 0.0, 6.0);
    return vec3(wp.x - L.x * k, uGround, wp.z - L.z * k);
  }
`;

const VERT_LINE = /* glsl */ `
  ${COMMON}
  varying vec3 vColor;
  void main() {
    vec3 p = displaceLine(position, aDepth);
    float shimmer = step(0.7, hash(aNode + fract(aDepth) + floor(uTime * 30.0)));
    vec3 base = mix(uColorA, uColorB, aDepth);
    if (uRainbow > 0.5) base = 0.5 + 0.5 * cos(6.28318 * (aDepth * 0.9 + uTime * 0.04 + vec3(0.0, 0.33, 0.67)));
    vColor = base * (0.75 + uAudio.x * 0.5 + uAudio.z * 2.5 * shimmer);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 + uAudio.z * shimmer * 1.5) / max(0.3, -mv.z);
  }
`;
const FRAG_LINE = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // premultiplied-alpha canvas over the camera feed: alpha follows brightness so dark
    // pixels let the video through instead of painting black
    vec3 c = min(vColor, vec3(1.0));
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;
const FRAG_POINT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    vec3 c = min(vColor * a * a, vec3(1.0));
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;

// flakes floating around solid figures (own motion, coloured by the palette)
const VERT_FLAKE = /* glsl */ `
  ${COMMON}
  varying vec3 vColor;
  void main() {
    float n = aNode;
    vec3 p = position + 0.05 * vec3(sin(uTime * 0.9 + n), cos(uTime * 0.7 + n * 1.3), sin(uTime * 0.8 + n * 0.7));
    p *= 1.0 + uAudio.x * uParams.x * 0.12;
    float pick = hash(n);
    vec3 base = pick < 0.5 ? uColorA : (pick < 0.8 ? uColorB : uColorC);
    if (uRainbow > 0.5) base = 0.5 + 0.5 * cos(6.28318 * (pick + vec3(0.0, 0.33, 0.67)));
    float blink = 0.55 + 0.45 * step(0.5, hash(n + floor(uTime * 8.0)));
    vColor = base * blink * (0.8 + uAudio.z * 1.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * 0.7 * uPixelRatio / max(0.3, -mv.z);
  }
`;

// solid body: near-black with neon bands that wrap the limbs, plus a palette-tinted rim
const VERT_MESH = /* glsl */ `
  ${COMMON}
  varying float vT; varying float vAng; varying float vNode; varying vec3 vN; varying vec3 vWorld;
  void main() {
    vec3 p = displaceMesh(position, aDepth, aNode);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vT = aDepth; vAng = aAng; vNode = aNode;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const FRAG_MESH = /* glsl */ `
  uniform vec4 uAudio; uniform float uTime;
  uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC; uniform float uRainbow;
  uniform vec4 uStripe; uniform vec3 uLightDir; uniform float uLightStrength;
  varying float vT; varying float vAng; varying float vNode; varying vec3 vN; varying vec3 vWorld;
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  vec3 hue(float x) { return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - abs(dot(N, V)), 2.2);
    vec3 neon = vec3(0.0);
    float line = 0.0;
    if (uStripe.x > 0.0) {
      float band = vT * uStripe.x + vAng * uStripe.z - uTime * uStripe.y;
      float f = fract(band);
      line = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.4, 0.5, f));
      float idx = floor(band);
      float m = mod(idx, 3.0);
      neon = m < 1.0 ? uColorA : (m < 2.0 ? uColorB : uColorC);
      if (uRainbow > 0.5) neon = hue(vT * 0.8 + idx * 0.13 + uTime * 0.03);
    }
    float flash = step(0.6, hash(vNode + floor(uTime * 20.0)));
    float glow = 0.75 + uAudio.x * 0.7 + uAudio.z * 0.6 * flash;
    float lit = max(dot(N, normalize(uLightDir)), 0.0) * uLightStrength;
    vec3 col = vec3(0.01, 0.012, 0.02) + vec3(0.05, 0.06, 0.09) * lit;
    col += neon * line * glow * 1.1;
    col += mix(uColorA, uColorB, 0.5) * rim * uStripe.w * 0.55 * glow;
    gl_FragColor = vec4(min(col, vec3(1.5)), 1.0);
  }
`;

// ground shadows
const VERT_SHADOW_LINE = /* glsl */ `
  ${COMMON}
  varying float vAlpha;
  void main() {
    vec3 p = displaceLine(position, aDepth);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    float height = max(0.0, wp.y - uGround);
    vec4 mv = viewMatrix * vec4(toGround(wp.xyz), 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = clamp((0.3 + 0.5 * uLightStrength) - height * 0.2, 0.1, 0.8);
    gl_PointSize = uSize * (1.2 + height * 1.2) * uPixelRatio / max(0.3, -mv.z); // penumbra grows with height
  }
`;
const FRAG_SHADOW_LINE = /* glsl */ `
  varying float vAlpha;
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha * 0.5); }
`;
const FRAG_SHADOW_POINT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha * smoothstep(0.5, 0.05, d) * 0.5);
  }
`;
const VERT_SHADOW_MESH = /* glsl */ `
  ${COMMON}
  void main() {
    vec3 p = displaceMesh(position, aDepth, aNode);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(toGround(wp.xyz), 1.0);
  }
`;
const FRAG_SHADOW_MESH = /* glsl */ `
  uniform float uLightStrength;
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.4 + 0.3 * uLightStrength); }
`;

// Shadow variant for renderers with no stencil buffer (the engine's): every pixel is darkened to
// one level with min-blending, so overlapping projected triangles do not stack.
const FRAG_SHADOW_MESH_MIN = /* glsl */ `
  uniform float uShadowLuma;
  void main() { gl_FragColor = vec4(vec3(uShadowLuma), 1.0); }
`;

export function createMaterials(THREE, uniforms) {
  const additive = {
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  };
  const alpha = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending };
  const sm = (vertexShader, fragmentShader, extra) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, ...extra });

  const shadowMesh = sm(VERT_SHADOW_MESH, FRAG_SHADOW_MESH, alpha);
  // the projected triangles overlap: let only the first fragment per pixel through so the
  // silhouette is one even, hard-edged shadow instead of darker where triangles stack
  shadowMesh.stencilWrite = true;
  shadowMesh.stencilRef = 1;
  shadowMesh.stencilFunc = THREE.NotEqualStencilFunc;
  shadowMesh.stencilZPass = THREE.ReplaceStencilOp;

  // fuzz haze: same shader as the node points but its own, smaller size
  const fuzzUniforms = { ...uniforms, uSize: { value: 2.6 } };
  const shadowMeshMin = sm(VERT_SHADOW_MESH, FRAG_SHADOW_MESH_MIN, {
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendEquation: THREE.MinEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });

  return {
    shadowMeshMin,
    fuzz: new THREE.ShaderMaterial({ uniforms: fuzzUniforms, vertexShader: VERT_LINE, fragmentShader: FRAG_POINT, ...additive }),
    line: sm(VERT_LINE, FRAG_LINE, additive),
    point: sm(VERT_LINE, FRAG_POINT, additive),
    flake: sm(VERT_FLAKE, FRAG_POINT, additive),
    mesh: sm(VERT_MESH, FRAG_MESH, { transparent: false, depthWrite: true, depthTest: true }),
    shadowLine: sm(VERT_SHADOW_LINE, FRAG_SHADOW_LINE, alpha),
    shadowPoint: sm(VERT_SHADOW_LINE, FRAG_SHADOW_POINT, alpha),
    shadowMesh,
  };
}

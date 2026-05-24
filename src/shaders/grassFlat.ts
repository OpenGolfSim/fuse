import * as THREE from 'three';

/**
 * FlatGrassShaderMaterial
 *
 * Extends MeshStandardMaterial with three anti-tiling techniques injected
 * via onBeforeCompile. Preserves all PBR lighting, shadows, env maps, fog.
 *
 * Techniques (in order of visual impact):
 *
 *  1. UV Distortion — warps texture coordinates with world-space noise so the
 *     tiling grid becomes irregular/wobbly. This is the most visible change.
 *     Look for: the straight repeating grid lines becoming curved and broken up.
 *
 *  2. Dual-Sample Blend — samples the texture a second time at rotated UVs and
 *     blends between the two. Breaks the repeating pattern by mixing orientations.
 *     Look for: areas where the texture "grain" shifts direction subtly.
 *
 *  3. Color Variation — procedural warm/cool tinting and brightness jitter.
 *     Look for: broad patches of slightly warmer or cooler grass color.
 *
 * Usage:
 *   child.material = new FlatGrassShaderMaterial(child.material);
 *
 *   // Or with overrides — defaults are intentionally visible so you can
 *   // confirm the effect, then dial back to taste:
 *   child.material = new FlatGrassShaderMaterial(child.material, {
 *     uvDistortStrength: 0.03,   // subtler distortion
 *     antiTileBlend: 0.3,        // gentler blend
 *   });
 */

// ── GLSL chunks ─────────────────────────────────────────────────────────────

const uniformDeclarations = /* glsl */ `
  // UV distortion
  uniform float uUvDistortScale;
  uniform float uUvDistortStrength;

  // Anti-tile blending
  uniform float uAntiTileRotation;
  uniform float uAntiTileBlend;
  uniform float uBlendNoiseScale;

  // Color variation
  uniform float uNoiseScale;
  uniform float uDetailScale;
  uniform float uNoiseStrength;
  uniform float uDetailStrength;
  uniform vec3  uWarmShift;
  uniform vec3  uCoolShift;
`;

const varyingDecl = /* glsl */ `
  varying vec3 vFGWorldPos;
`;

const vertexInjection = /* glsl */ `
  vFGWorldPos = worldPosition.xyz;
`;

const noiseFunctions = /* glsl */ `
  float fg_hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float fg_valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = fg_hash(i);
    float b = fg_hash(i + vec2(1., 0.));
    float c = fg_hash(i + vec2(0., 1.));
    float d = fg_hash(i + vec2(1., 1.));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Two-octave FBM — richer than single noise, cheap enough for realtime
  float fg_fbm(vec2 p) {
    return 0.65 * fg_valueNoise(p)
         + 0.35 * fg_valueNoise(p * 2.13 + vec2(5.2, 1.3));
  }

  vec2 fg_rotate(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }
`;

// Replaces #include <map_fragment>
const customMapFragment = /* glsl */ `
  #ifdef USE_MAP
    vec2 wxz = vFGWorldPos.xz;

    // 1) UV Distortion — warp the lookup coords so the grid isn't rectangular
    vec2 uvWarp = vec2(
      fg_fbm(wxz * uUvDistortScale),
      fg_fbm(wxz * uUvDistortScale + vec2(43.0, 17.0))
    ) * 2.0 - 1.0;
    vec2 warpedUv = vMapUv + uvWarp * uUvDistortStrength;

    // 2) Dual-sample blend — second sample at rotated UVs
    vec2 rotatedUv = fg_rotate(warpedUv, uAntiTileRotation);

    vec4 texA = texture2D(map, warpedUv);
    vec4 texB = texture2D(map, rotatedUv);

    float blendNoise = fg_fbm(wxz * uBlendNoiseScale);
    float blendFactor = smoothstep(0.2, 0.8, blendNoise) * uAntiTileBlend;

    vec4 sampledDiffuseColor = mix(texA, texB, blendFactor);

    #ifdef DECODE_VIDEO_TEXTURE
      sampledDiffuseColor = vec4(
        mix(
          pow(sampledDiffuseColor.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)),
          sampledDiffuseColor.rgb * 0.0773993808,
          vec3(lessThanEqual(sampledDiffuseColor.rgb, vec3(0.04045)))
        ),
        sampledDiffuseColor.w
      );
    #endif

    diffuseColor *= sampledDiffuseColor;

    // 3) Color variation — warm/cool tinting + brightness jitter
    float patchVal  = fg_fbm(wxz * uNoiseScale);
    vec3 tint       = mix(uCoolShift, uWarmShift, patchVal);
    float detailVar = fg_fbm(wxz * uDetailScale) * 2.0 - 1.0;

    diffuseColor.rgb *= 1.0 + tint * uNoiseStrength;
    diffuseColor.rgb *= 1.0 + detailVar * uDetailStrength;
  #endif
`;

// Replaces #include <normal_fragment_maps> — same distortion + blend for normals
const customNormalFragment = /* glsl */ `
  #ifdef USE_NORMALMAP_OBJECTSPACE
    normal = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
    #ifdef FLIP_SIDED
      normal = -normal;
    #endif
    #ifdef DOUBLE_SIDED
      normal = normal * faceDirection;
    #endif
    normal = normalize(normalMatrix * normal);

  #elif defined(USE_NORMALMAP_TANGENTSPACE)
    vec2 nWxz = vFGWorldPos.xz;

    vec2 nUvWarp = vec2(
      fg_fbm(nWxz * uUvDistortScale),
      fg_fbm(nWxz * uUvDistortScale + vec2(43.0, 17.0))
    ) * 2.0 - 1.0;
    vec2 nWarpedUv  = vNormalMapUv + nUvWarp * uUvDistortStrength;
    vec2 nRotatedUv = fg_rotate(nWarpedUv, uAntiTileRotation);

    vec3 nmapA = texture2D(normalMap, nWarpedUv).xyz * 2.0 - 1.0;
    vec3 nmapB = texture2D(normalMap, nRotatedUv).xyz * 2.0 - 1.0;

    float nBlend = smoothstep(0.2, 0.8, fg_fbm(nWxz * uBlendNoiseScale)) * uAntiTileBlend;
    vec3 mapN = mix(nmapA, nmapB, nBlend);
    mapN.xy *= normalScale;

    normal = normalize(tbn * mapN);

  #elif defined(USE_BUMPMAP)
    normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);
  #endif
`;

// ── Material class ───────────────────────────────────────────────────────────

type FlatGrassShaderMaterialOptions = {
  uvDistortScale?: number;
  uvDistortStrength?: number;
  antiTileRotation?: number;
  antiTileBlend?: number;
  blendNoiseScale?: number;
  noiseScale?: number;
  detailScale?: number;
  noiseStrength?: number;
  detailStrength?: number;
  warmShift?: THREE.Vector3;
  coolShift?: THREE.Vector3;
}

export class FlatGrassShaderMaterial extends THREE.MeshStandardMaterial {
  _noiseUniforms: Record<string, { value: any }>;
  baseMaterial: THREE.Material;
  _shader?: THREE.WebGLProgramParametersWithUniforms;

  constructor(baseMaterial: THREE.Material, options: FlatGrassShaderMaterialOptions = {}) {
    super();
    this.copy(baseMaterial);

    this.name = `${baseMaterial.name || 'grass'}_flatGrass`;
    this.baseMaterial = baseMaterial;

    this._noiseUniforms = {
      // UV distortion — warp strength is in UV units, so small values go a long way.
      // At 0.05 you'll clearly see the grid warp; dial to 0.02–0.03 for subtle.
      uUvDistortScale:    { value: options.uvDistortScale    ?? 0.02 },
      uUvDistortStrength: { value: options.uvDistortStrength ?? 0.05 },

      // Dual-sample blend
      uAntiTileRotation: { value: options.antiTileRotation ?? 0.6  },
      uAntiTileBlend:    { value: options.antiTileBlend    ?? 0.5  },
      uBlendNoiseScale:  { value: options.blendNoiseScale  ?? 0.08 },

      // Color variation
      uNoiseScale:     { value: options.noiseScale     ?? 0.04 },
      uDetailScale:    { value: options.detailScale    ?? 0.02  },
      uNoiseStrength:  { value: options.noiseStrength  ?? 0.15 },
      uDetailStrength: { value: options.detailStrength ?? 0.1 },
      uWarmShift:      { value: options.warmShift ?? new THREE.Vector3( 0.06,  0.04, -0.03) },
      uCoolShift:      { value: options.coolShift ?? new THREE.Vector3(-0.04, -0.02,  0.03) },
    };

    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this._noiseUniforms);

      // Vertex
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\n' + varyingDecl
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n' + vertexInjection
      );

      // Fragment
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + uniformDeclarations + varyingDecl + noiseFunctions
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        customMapFragment
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        customNormalFragment
      );

      this._shader = shader;
    };

    this.defines = this.defines || {};
    this.defines['USE_ENVMAP'] = '';
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get uvDistortScale()    { return this._noiseUniforms.uUvDistortScale.value; }
  set uvDistortScale(v)   { this._noiseUniforms.uUvDistortScale.value = v; }

  get uvDistortStrength() { return this._noiseUniforms.uUvDistortStrength.value; }
  set uvDistortStrength(v){ this._noiseUniforms.uUvDistortStrength.value = v; }

  get antiTileRotation()  { return this._noiseUniforms.uAntiTileRotation.value; }
  set antiTileRotation(v) { this._noiseUniforms.uAntiTileRotation.value = v; this.needsUpdate = true; }

  get antiTileBlend()     { return this._noiseUniforms.uAntiTileBlend.value; }
  set antiTileBlend(v)    { this._noiseUniforms.uAntiTileBlend.value = v; }

  get blendNoiseScale()   { return this._noiseUniforms.uBlendNoiseScale.value; }
  set blendNoiseScale(v)  { this._noiseUniforms.uBlendNoiseScale.value = v; }

  get noiseScale()        { return this._noiseUniforms.uNoiseScale.value; }
  set noiseScale(v)       { this._noiseUniforms.uNoiseScale.value = v; }

  get noiseStrength()     { return this._noiseUniforms.uNoiseStrength.value; }
  set noiseStrength(v)    { this._noiseUniforms.uNoiseStrength.value = v; }

  get detailScale()       { return this._noiseUniforms.uDetailScale.value; }
  set detailScale(v)      { this._noiseUniforms.uDetailScale.value = v; }

  get detailStrength()    { return this._noiseUniforms.uDetailStrength.value; }
  set detailStrength(v)   { this._noiseUniforms.uDetailStrength.value = v; }
}
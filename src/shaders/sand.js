import * as THREE from 'three';

const DEFAULTS = {
  colorTint: new THREE.Color(0.9, 0.88, 0.749),

  // sandColorDark:  new THREE.Color(0.9, 0.88, 0.749),
  // edgeTint:       new THREE.Color(0.6, 0.576, 0.4),
  // edgeWidth:      0.05,
  // edgeDarkness:   0.15,
  // noiseScale:     10.0,
  // noiseBreakup:   0.01,
  // grainScale:     20.0,
};

const VERT = /* glsl */ `
  varying float vTint;

  void main() {
    // Pull the red channel from the vertex color you painted
    vTint = color.r;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSandColor;
  uniform vec3 uEdgeColor;
  uniform float uTintStrength;

  varying float vTint;

  void main() {
    // Mix from sand → dark edge based on the red vertex color
    float t = clamp(vTint * uTintStrength, 0.0, 1.0);
    vec3 finalColor = mix(uSandColor, uEdgeColor, t);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;



function buildVertex(base) {
  return base
    .replace(
      'void main() {',
      `attribute float aTint;
        varying float vTint;
        varying vec2 vDetailUv;
        void main() {`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
        vTint = aTint;
        vDetailUv = uv;`
    );
}

function buildFragment(base) {
  return base
    .replace(
      'void main() {',
      `uniform vec3 uEdgeColor;
        uniform float uTintStrength;
        uniform sampler2D uDetailMap;
        uniform float uDetailScale;
        varying float vTint;
        varying vec2 vDetailUv;
        void main() {`
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
        // float t = clamp(vTint * uTintStrength, 0.0, 1.0);

        // Future: grass-to-sand breakup
        // vec4 detail = texture2D(uDetailMap, vDetailUv * uDetailScale);
        // gl_FragColor.rgb = mix(gl_FragColor.rgb, detail.rgb, t * detail.a);

        // gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, t);
        float t = clamp(vTint * uTintStrength, 0.0, 1.0);
        t = smoothstep(0.0, 1.0, t);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, t);`
    );
}

export class SandShaderMaterial extends THREE.ShaderMaterial {
  constructor(baseMaterial, options = {}) {
    const map = baseMaterial.map;
    const normalMap = baseMaterial.normalMap;

    const {
      // edgeColor = new THREE.Color(0.478, 0.463, 0.333),
      edgeColor = new THREE.Color('#372813'),
      tintStrength = 0.5,
      exposure = 1.08,
    } = options;

    super({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
        THREE.UniformsLib.shadowmap,
        {
          uMap: { value: map },
          uNormalMap: { value: normalMap },
          uNormalScale: { value: baseMaterial.normalScale || new THREE.Vector2(1, 1) },
          uTileScale: { value: map?.repeat?.clone() || new THREE.Vector2(1, 1) },
          uTileOffset: { value: map?.offset?.clone() || new THREE.Vector2(0, 0) },
          uRoughness: { value: baseMaterial.roughness ?? 0.8 },
          uEdgeColor: { value: edgeColor },
          uTintStrength: { value: tintStrength },
          uExposure: { value: exposure },
          directionalShadowMap: { value: [] },
          directionalShadowMatrix: { value: [] },
          pointShadowMap: { value: [] },
          pointShadowMatrix: { value: [] },
          spotShadowMap: { value: [] },
          spotLightMatrix: { value: [] },
          spotLightMap: { value: [] },

        }
      ]),
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vColor = color;
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        #include <common>
        #include <lights_pars_begin>

        uniform sampler2D uMap;
        uniform sampler2D uNormalMap;
        uniform vec2 uNormalScale;
        uniform vec2 uTileScale;
        uniform vec2 uTileOffset;
        uniform float uRoughness;
        uniform vec3 uEdgeColor;
        uniform float uTintStrength;
        uniform float uExposure;

        varying vec3 vColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vec2 tiledUv = vUv * uTileScale + uTileOffset;

          vec4 texColor = texture2D(uMap, tiledUv);
          vec3 normalTex = texture2D(uNormalMap, tiledUv).rgb * 2.0 - 1.0;
          normalTex.xy *= uNormalScale;
          vec3 normal = normalize(vNormal + normalTex);

          // Ambient from scene
          vec3 lighting = ambientLightColor;

          // Directional lights from scene
          #if NUM_DIR_LIGHTS > 0
            for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
              float diff = max(dot(normal, directionalLights[i].direction), 0.0);
              lighting += directionalLights[i].color * diff * RECIPROCAL_PI;
            }
          #endif

          // Point lights from scene
          #if NUM_POINT_LIGHTS > 0
            for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
              vec3 lightVec = pointLights[i].position - vViewPosition;
              float dist = length(lightVec);
              vec3 lightDir = normalize(lightVec);
              float diff = max(dot(normal, lightDir), 0.0);
              float attenuation = 1.0 / (1.0 + dist * dist * 0.01);
              lighting += pointLights[i].color * diff * attenuation * RECIPROCAL_PI;
            }
          #endif

          // Vertex color tint
          float t = 1.0 - min(min(vColor.r, vColor.g), vColor.b);
          t = smoothstep(0.0, 1.0, t * uTintStrength);

          vec3 finalColor = mix(texColor.rgb, uEdgeColor, t);
          finalColor *= lighting * uExposure;

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      lights: true,
    });
  }

  get edgeColor() { return this.uniforms.uEdgeColor.value; }
  set edgeColor(c) { this.uniforms.uEdgeColor.value = c; }

  get tintStrength() { return this.uniforms.uTintStrength.value; }
  set tintStrength(v) { this.uniforms.uTintStrength.value = v; }

  get tileScale() { return this.uniforms.uTileScale.value; }
  set tileScale(v) { this.uniforms.uTileScale.value = v; }

  get tileOffset() { return this.uniforms.uTileOffset.value; }
  set tileOffset(v) { this.uniforms.uTileOffset.value = v; }

  get normalScale() { return this.uniforms.uNormalScale.value; }
  set normalScale(v) { this.uniforms.uNormalScale.value = v; }

  get roughness() { return this.uniforms.uRoughness.value; }
  set roughness(v) { this.uniforms.uRoughness.value = v; }

  get exposure() { return this.uniforms.uExposure.value; }
  set exposure(v) { this.uniforms.uExposure.value = v; }
}

export class SandShaderMaterial2 extends THREE.ShaderMaterial {
  constructor(baseMaterial, options = {}) {
    const standardShader = THREE.ShaderLib.standard;

    const {
      edgeColor = new THREE.Color(0.35, 0.30, 0.20),
      tintStrength = 10.0,
      detailMap = null,
      detailScale = 10.0,
    } = options;

    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsUtils.clone(standardShader.uniforms),
      {
        uEdgeColor: { value: edgeColor },
        uTintStrength: { value: tintStrength },
        uDetailMap: { value: detailMap },
        uDetailScale: { value: detailScale },
      }
    ]);

    // Transfer textures + their transform matrices
    if (baseMaterial.map) {
      uniforms.map.value = baseMaterial.map;
      uniforms.mapTransform.value = baseMaterial.map.matrix;
    }
    if (baseMaterial.normalMap) {
      uniforms.normalMap.value = baseMaterial.normalMap;
      uniforms.normalMapTransform.value = baseMaterial.normalMap.matrix;
    }
    if (baseMaterial.roughnessMap) {
      uniforms.roughnessMap.value = baseMaterial.roughnessMap;
      uniforms.roughnessMapTransform.value = baseMaterial.roughnessMap.matrix;
    }
    uniforms.roughness.value = baseMaterial.roughness ?? 1.0;
    uniforms.metalness.value = baseMaterial.metalness ?? 0.0;

    // Defines: each map needs both a USE_ flag and a _UV channel
    const defines = { USE_UV: '' };
    if (baseMaterial.map) {
      defines.USE_MAP = '';
      defines.MAP_UV = 'uv';
    }
    if (baseMaterial.normalMap) {
      defines.USE_NORMALMAP = '';
      defines.NORMALMAP_UV = 'uv';
    }
    if (baseMaterial.roughnessMap) {
      defines.USE_ROUGHNESSMAP = '';
      defines.ROUGHNESSMAP_UV = 'uv';
    }

    super({
      uniforms,
      vertexShader: buildVertex(standardShader.vertexShader),
      fragmentShader: buildFragment(standardShader.fragmentShader),
      lights: true,
      fog: true,
      defines,
    });
  }

  // --- Public accessors for runtime control ---

  get edgeColor() { return this.uniforms.uEdgeColor.value; }
  set edgeColor(c) { this.uniforms.uEdgeColor.value = c; }

  get tintStrength() { return this.uniforms.uTintStrength.value; }
  set tintStrength(v) { this.uniforms.uTintStrength.value = v; }

  get detailMap() { return this.uniforms.uDetailMap.value; }
  set detailMap(t) { this.uniforms.uDetailMap.value = t; }

  get detailScale() { return this.uniforms.uDetailScale.value; }
  set detailScale(v) { this.uniforms.uDetailScale.value = v; }


}

// const newMaterial = new SandShaderMaterial(child.material);
// child.material = newMaterial;





// // ── GLSL helpers ───────────────────────────────────────────────────
// const NOISE_GLSL = /* glsl */ `
//   vec3 mod289(vec3 x)  { return x - floor(x * (1.0/289.0)) * 289.0; }
//   vec2 mod289v(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
//   vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

//   float snoise(vec2 v) {
//     const vec4 C = vec4(0.211324865405187, 0.366025403784439,
//                        -0.577350269189626, 0.024390243902439);
//     vec2 i  = floor(v + dot(v, C.yy));
//     vec2 x0 = v - i + dot(i, C.xx);
//     vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
//     vec4 x12 = x0.xyxy + C.xxzz;
//     x12.xy -= i1;
//     i = mod289v(i);
//     vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
//                             + i.x + vec3(0.0, i1.x, 1.0));
//     vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
//                              dot(x12.zw,x12.zw)), 0.0);
//     m = m * m; m = m * m;
//     vec3 x  = 2.0 * fract(p * C.www) - 1.0;
//     vec3 h  = abs(x) - 0.5;
//     vec3 ox = floor(x + 0.5);
//     vec3 a0 = x - ox;
//     m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
//     vec3 g;
//     g.x  = a0.x * x0.x  + h.x * x0.y;
//     g.yz = a0.yz * x12.xz + h.yz * x12.yw;
//     return 130.0 * dot(m, g);
//   }

//   float fbm(vec2 p) {
//     float f = 0.0;
//     f += 0.5000 * snoise(p); p *= 2.02;
//     f += 0.2500 * snoise(p); p *= 2.03;
//     f += 0.1250 * snoise(p); p *= 2.01;
//     f += 0.0625 * snoise(p);
//     return f / 0.9375;
//   }

//   // Voronoi — returns vec2(distance to nearest cell center, random cell ID)
//   vec2 voronoi(vec2 p) {
//     vec2 n = floor(p);
//     vec2 f = fract(p);
//     float minDist = 1.0;
//     float cellId  = 0.0;
//     for (int j = -1; j <= 1; j++) {
//       for (int i = -1; i <= 1; i++) {
//         vec2 neighbor = vec2(float(i), float(j));
//         // pseudo-random point within each grid cell
//         vec2 offset = n + neighbor;
//         vec2 pt = vec2(
//           fract(sin(dot(offset, vec2(127.1, 311.7))) * 43758.5453),
//           fract(sin(dot(offset, vec2(269.5, 183.3))) * 43758.5453)
//         );
//         vec2 diff = neighbor + pt - f;
//         float d = dot(diff, diff);
//         if (d < minDist) {
//           minDist = d;
//           cellId  = fract(sin(dot(offset, vec2(419.2, 371.9))) * 43758.5453);
//         }
//       }
//     }
//     return vec2(sqrt(minDist), cellId);
//   }

// `;

// const VERT = /* glsl */ `
//   attribute float aEdgeDist;
//   varying vec3  vWorldPos;
//   varying vec3  vNormal;
//   varying float vEdgeDist;

//   void main() {
//     vEdgeDist = aEdgeDist;
//     vNormal   = normalize(normalMatrix * normal);
//     vec4 wp   = modelMatrix * vec4(position, 1.0);
//     vWorldPos = wp.xyz;
//     gl_Position = projectionMatrix * viewMatrix * wp;
//   }
// `;

// const FRAG = /* glsl */ `
//   precision highp float;
//   varying vec3  vWorldPos;
//   varying vec3  vNormal;
//   varying float vEdgeDist;

//   uniform vec3  uSandColorLight;
//   uniform vec3  uSandColorDark;
//   uniform vec3  uEdgeTint;
//   uniform float uEdgeWidth;
//   uniform float uEdgeDarkness;
//   uniform float uNoiseScale;
//   uniform float uNoiseBreakup;
//   uniform float uGrainScale;

//   ${NOISE_GLSL}

//   void main() {
//     vec2 wUV = vWorldPos.xz;

//     // 1. Sand base with anti-aliased grain
//     float screenGrain = length(fwidth(wUV)) * uGrainScale;
//     float grainFade   = 1.0 - smoothstep(0.4, 1.2, screenGrain);

//     float grain = snoise(wUV * uGrainScale) * 0.5 + 0.5;
//     vec3 sand = mix(uSandColorDark, uSandColorLight, grain * 0.7 * grainFade + 0.3);
//     sand += snoise(wUV * uGrainScale * 4.0) * 0.08 * grainFade;

//     // 2. Edge factor with noise breakup
//     float edgeScreenScale = length(fwidth(wUV)) * uNoiseScale;
//     float edgeFade = 1.0 - smoothstep(0.5, 1.5, edgeScreenScale);

//     // float edge     = vEdgeDist + fbm(wUV * uNoiseScale) * uNoiseBreakup * edgeFade;
    
//     float cell = voronoi(wUV * uNoiseScale).x;  // distance to nearest cell center
//     float edge = vEdgeDist + (cell - 0.4) * uNoiseBreakup * edgeFade;    
//     float edgeMask = smoothstep(0.0, uEdgeWidth, edge);

//     // 3. Dense outer ring — driven by raw vEdgeDist, not noise-shifted edge
//     float outerRing = smoothstep(0.0, uEdgeWidth * 0.15, vEdgeDist);
//     float blendToSand = outerRing * edgeMask;

//     vec3 rimColor = mix(uEdgeTint, sand, 0.05);
//     vec3 color    = mix(rimColor, sand, blendToSand);

//     float darken = mix(uEdgeDarkness * 1.3, 0.0, blendToSand);
//     color *= 1.0 - clamp(darken, 0.0, 1.0);

//     // 4. Flecks in the mid-transition zone
//     float fleck     = snoise(wUV * uNoiseScale * 3.0);
//     float fleckZone = (1.0 - edgeMask) * edgeMask * 4.0;
//     float fleckMask = fleckZone * smoothstep(0.3, 0.6, fleck) * edgeFade;
//     color = mix(color, uEdgeTint * 0.5, fleckMask * 0.4);

//     // 5. Lighting
//     vec3 L = normalize(vec3(0.5, 1.0, 0.3));
//     color *= 0.45 + 0.55 * max(dot(vNormal, L), 0.0);

//     gl_FragColor = vec4(color, 1.0);
//   }
// `;


// // ── Defaults ───────────────────────────────────────────────────────
// const DEFAULTS = {
//   sandColorLight: new THREE.Color(0.9, 0.88, 0.749),
//   sandColorDark:  new THREE.Color(0.9, 0.88, 0.749),
//   edgeTint:       new THREE.Color(0.6, 0.576, 0.4),
//   edgeWidth:      0.05,
//   edgeDarkness:   0.15,
//   noiseScale:     10.0,
//   noiseBreakup:   0.01,
//   grainScale:     20.0,
// };

// // ── Class ──────────────────────────────────────────────────────────
// export class SandShaderMaterialOld extends THREE.ShaderMaterial {

//   constructor(opts = {}) {
//     const o = { ...DEFAULTS, ...opts };

//     super({
//       vertexShader:   VERT,
//       fragmentShader: FRAG,
//       side: THREE.DoubleSide,
//       uniforms: {
//         uSandColorLight: { value: o.sandColorLight.clone() },
//         uSandColorDark:  { value: o.sandColorDark.clone() },
//         uEdgeTint:       { value: o.edgeTint.clone() },
//         uEdgeWidth:      { value: o.edgeWidth },
//         uEdgeDarkness:   { value: o.edgeDarkness },
//         uNoiseScale:     { value: o.noiseScale },
//         uNoiseBreakup:   { value: o.noiseBreakup },
//         uGrainScale:     { value: o.grainScale },
//       },
//     });
//   }

//   // ── convenience setters so you can tweak at runtime ──

//   get edgeWidth()            { return this.uniforms.uEdgeWidth.value; }
//   set edgeWidth(v)           { this.uniforms.uEdgeWidth.value = v; }

//   get edgeDarkness()         { return this.uniforms.uEdgeDarkness.value; }
//   set edgeDarkness(v)        { this.uniforms.uEdgeDarkness.value = v; }

//   get noiseScale()           { return this.uniforms.uNoiseScale.value; }
//   set noiseScale(v)          { this.uniforms.uNoiseScale.value = v; }

//   get noiseBreakup()         { return this.uniforms.uNoiseBreakup.value; }
//   set noiseBreakup(v)        { this.uniforms.uNoiseBreakup.value = v; }

//   get grainScale()           { return this.uniforms.uGrainScale.value; }
//   set grainScale(v)          { this.uniforms.uGrainScale.value = v; }

  
//   static addEdgeDist(geometry) {
//     const pos   = geometry.attributes.position;
//     const index = geometry.index;

//     // 1. Find boundary edges (edges belonging to only one triangle)
//     const edgeCounts = new Map();
//     const triCount   = index ? index.count / 3 : pos.count / 3;

//     for (let t = 0; t < triCount; t++) {
//       const a = index ? index.getX(t * 3)     : t * 3;
//       const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
//       const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;

//       for (const [i, j] of [[a,b], [b,c], [c,a]]) {
//         const key = Math.min(i,j) + ':' + Math.max(i,j);
//         edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
//       }
//     }

//     // 2. Collect boundary vertex positions (xz only for flat meshes)
//     const boundaryPts = [];
//     const seen = new Set();
//     for (const [key, count] of edgeCounts) {
//       if (count !== 1) continue;
//       const [i, j] = key.split(':').map(Number);
//       for (const vi of [i, j]) {
//         if (seen.has(vi)) continue;
//         seen.add(vi);
//         boundaryPts.push(pos.getX(vi), pos.getZ(vi));
//       }
//     }

//     // 3. For each vertex, find min distance to any boundary vertex
//     const buf   = new Float32Array(pos.count);
//     let maxDist = 0;

//     for (let i = 0; i < pos.count; i++) {
//       const vx = pos.getX(i);
//       const vz = pos.getZ(i);
//       let minD = Infinity;

//       for (let b = 0; b < boundaryPts.length; b += 2) {
//         const dx = vx - boundaryPts[b];
//         const dz = vz - boundaryPts[b + 1];
//         const d  = dx * dx + dz * dz;       // skip sqrt until the end
//         if (d < minD) minD = d;
//       }

//       buf[i] = Math.sqrt(minD);
//       if (buf[i] > maxDist) maxDist = buf[i];
//     }

//     // 4. Normalize: 0 at boundary, 1 at deepest interior point
//     if (maxDist > 0) {
//       for (let i = 0; i < buf.length; i++) {
//         buf[i] /= maxDist;
//       }
//     }

//     geometry.setAttribute('aEdgeDist', new THREE.BufferAttribute(buf, 1));

//   }
//   // /** Bake the aEdgeDist attribute onto a geometry in-place. */
//   // static addEdgeDist(geometry, centerX, centerZ, radiusX, radiusZ) {
//   //   const pos = geometry.attributes.position;
//   //   const buf = new Float32Array(pos.count);
//   //   for (let i = 0; i < pos.count; i++) {
//   //     const nx = (pos.getX(i) - centerX) / radiusX;
//   //     const nz = (pos.getZ(i) - centerZ) / radiusZ;
//   //     buf[i] = Math.max(0.0, 1.0 - Math.sqrt(nx * nx + nz * nz));
//   //   }
//   //   geometry.setAttribute('aEdgeDist', new THREE.BufferAttribute(buf, 1));
//   // }

//   // static addEdgeDistFromCentroid(geometry) {
//   //   const pos = geometry.attributes.position;
//   //   let cx = 0, cz = 0;
//   //   for (let i = 0; i < pos.count; i++) {
//   //     cx += pos.getX(i);
//   //     cz += pos.getZ(i);
//   //   }
//   //   cx /= pos.count;
//   //   cz /= pos.count;

//   //   // find max distance from centroid to use as radius
//   //   let maxR = 0;
//   //   for (let i = 0; i < pos.count; i++) {
//   //     const dx = pos.getX(i) - cx;
//   //     const dz = pos.getZ(i) - cz;
//   //     maxR = Math.max(maxR, Math.sqrt(dx * dx + dz * dz));
//   //   }

//   //   const buf = new Float32Array(pos.count);
//   //   for (let i = 0; i < pos.count; i++) {
//   //     const dx = pos.getX(i) - cx;
//   //     const dz = pos.getZ(i) - cz;
//   //     const r = Math.sqrt(dx * dx + dz * dz) / maxR;
//   //     buf[i] = Math.max(0.0, 1.0 - r);
//   //   }
//   //   geometry.setAttribute('aEdgeDist', new THREE.BufferAttribute(buf, 1));
//   // }
// }

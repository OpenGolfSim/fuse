import * as THREE from 'three';

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



function buildVertex(base: string) {
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

function buildFragment(base: string) {
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

type SandShaderMaterialOptions = {
  edgeColor?: THREE.Color,
  tintStrength?: number,
  exposure?: number
}

export class SandShaderMaterial extends THREE.ShaderMaterial {
  
  constructor(baseMaterial: THREE.MeshStandardMaterial, options: SandShaderMaterialOptions = {}) {
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
        // @ts-expect-error
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

import { GolfBall } from '@/objects/golfBall';
import * as THREE from 'three';

export type TargetShaderMaterialOptions = {
  inner?: number,
  middle?: number,
  outer?: number,
  ringWidth?: number
};

export class TargetShaderMaterial {
  holeWorldPos: THREE.Vector3;
  ringSizes: THREE.Vector3;
  currentActive: THREE.Vector3;
  // higher = faster response, lower = smoother
  lerpSpeed = 4.0;
  customUniforms: Record<string, { value: any }>;
  material?: THREE.Material;

  constructor(object: THREE.Object3D, holeWorldPos: THREE.Vector3, options: TargetShaderMaterialOptions = {}) {
    this.holeWorldPos = holeWorldPos;

    this.currentActive = new THREE.Vector3(0, 0, 0);

    const inner = options.inner ?? 2;
    const middle = options.middle ?? 4;
    const outer = options.outer ?? 80;
    const ringWidth = options.ringWidth ?? 0.1;

    this.ringSizes = new THREE.Vector3(inner, middle, outer);
    // Store uniform refs so we can update them later
    this.customUniforms = {
      holePos:       { value: new THREE.Vector3(holeWorldPos.x, 0, holeWorldPos.z) },
      holeRadius:    { value: 0.054 },   // 108mm diameter
      ringRadii:     { value: this.ringSizes },
      ringWidth:     { value: ringWidth },
      ringActive:    { value: new THREE.Vector3(0, 0, 0) },
      activeColor:   { value: new THREE.Vector4(1.0, 0.95, 0.0, 0.15) },
      inactiveColor: { value: new THREE.Vector4(1.0, 1.0, 1.0, 0.6) },
    };
    // Clone the existing GLTF material so we keep all its properties
    if (object instanceof THREE.Mesh) {
      const mat = object.material.clone() as THREE.MeshStandardMaterial;

      mat.alphaToCoverage = true;
      // mat.transparent = true;
      mat.customProgramCacheKey = () => 'green-hole-rings-v1';
      mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
        // Inject our uniforms into the shader program
        Object.assign(shader.uniforms, this.customUniforms);

        // Add varyings + uniforms to the vertex shader
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vWorldPos;
          `
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          /* glsl */ `
            #include <worldpos_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          `
        );

        // Add uniforms/varyings to the fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vWorldPos;
            uniform vec3 holePos;
            uniform vec3 ringRadii;
            uniform float ringWidth;
            uniform vec3 ringActive;
            uniform vec4 activeColor;
            uniform vec4 inactiveColor;
            uniform float holeRadius;

            float ringOutline(float dist, float radius, float width) {
              float hw = width * 0.5;
              float fw = fwidth(dist);  // how much dist changes across this pixel
              float edge = max(fw, 0.01); // clamp so it doesn't collapse at close range
              return smoothstep(radius - hw - edge, radius - hw + edge, dist)
                  * (1.0 - smoothstep(radius + hw - edge, radius + hw + edge, dist));
            }

            float zoneFill(float dist, float lo, float hi) {
              float fw = fwidth(dist);
              float edge = max(fw, 0.01);
              return smoothstep(lo - edge, lo + edge, dist)
                  * (1.0 - smoothstep(hi - edge, hi + edge, dist));
            }

          `
        );

        // Inject ring compositing right after the diffuse map is applied
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          /* glsl */ `
            #include <map_fragment>
            
            float dist = distance(vWorldPos.xz, holePos.xz);
            // knock out hole
            // if (dist < holeRadius) discard;
            // diffuseColor.a *= smoothstep(holeRadius, holeRadius + fwidth(dist), dist);
            float g = length(vec2(dFdx(dist), dFdy(dist))); // screen-space gradient of dist
            g = clamp(g, 0.0008, 0.02);                      // floor stops sub-pixel shimmer; ceil stops over-blur
            float holeMask = smoothstep(holeRadius - g, holeRadius + g, dist);
            diffuseColor.a *= holeMask;                       // 0 inside the hole, 1 outside

            // --- Ring 1 (inner: 0 → ringRadii.x) ---
            float outline1 = ringOutline(dist, ringRadii.x, ringWidth);
            float fill1    = zoneFill(dist, 0.0, ringRadii.x);
            // When inactive: white outline only. When active: filled yellow zone.
            float mask1 = mix(outline1, fill1, ringActive.x);
            vec4 col1   = mix(inactiveColor, activeColor, ringActive.x);

            // --- Ring 2 (middle: ringRadii.x → ringRadii.y) ---
            float outline2 = ringOutline(dist, ringRadii.y, ringWidth);
            float fill2    = zoneFill(dist, ringRadii.x, ringRadii.y);
            float mask2 = mix(outline2, fill2, ringActive.y);
            vec4 col2   = mix(inactiveColor, activeColor, ringActive.y);

            // --- Ring 3 (outer: ringRadii.y → ringRadii.z) ---
            float outline3 = ringOutline(dist, ringRadii.z, ringWidth);
            float fill3    = zoneFill(dist, ringRadii.y, ringRadii.z);
            float mask3 = mix(outline3, fill3, ringActive.z);
            vec4 col3   = mix(inactiveColor, activeColor, ringActive.z);

            // White outlines — always visible
            diffuseColor.rgb = mix(diffuseColor.rgb, inactiveColor.rgb, outline1 * inactiveColor.a);
            diffuseColor.rgb = mix(diffuseColor.rgb, inactiveColor.rgb, outline2 * inactiveColor.a);
            diffuseColor.rgb = mix(diffuseColor.rgb, inactiveColor.rgb, outline3 * inactiveColor.a);

            // Yellow fill — fades in/out with ringActive
            diffuseColor.rgb = mix(diffuseColor.rgb, activeColor.rgb, fill1 * activeColor.a * ringActive.x);
            diffuseColor.rgb = mix(diffuseColor.rgb, activeColor.rgb, fill2 * activeColor.a * ringActive.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, activeColor.rgb, fill3 * activeColor.a * ringActive.z);
          `
        );
      };

      // Force recompilation
      mat.needsUpdate = true;
      object.material = mat;
      this.material = mat;
    }
  }

  setPosition(position: THREE.Vector3) {
    this.customUniforms.holePos.value = new THREE.Vector3(position.x, 0, position.z);
    if (this.material) this.material.needsUpdate = true;
  }
  dispose() {
    if (this.material) {
      this.material.dispose();
      this.material = undefined;
    }
  }
  update(golfBall: GolfBall, dt: number) {
    if (!golfBall.object) {
      return;
    }
    const target = new THREE.Vector3(0, 0, 0);
    if (golfBall.isOnGreen()) {
      const dist = Math.hypot(
        golfBall.object.position.x - this.holeWorldPos.x,
        golfBall.object.position.z - this.holeWorldPos.z
      );
      
      target.set(
        dist <= this.ringSizes.x ? 1.0 : 0.0,
        dist > this.ringSizes.x && dist <= this.ringSizes.y ? 1.0 : 0.0,
        dist > this.ringSizes.y ? 1.0 : 0.0
      );
    }
    // Smooth toward target — never snaps
    const t = 1.0 - Math.exp(-this.lerpSpeed * dt);
    this.currentActive.lerp(target, t);

    this.customUniforms.ringActive.value.copy(this.currentActive);
  }
}
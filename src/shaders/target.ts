import { GolfBall } from '@/objects/golfBall';
import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial, type Node, type UniformNode } from 'three/webgpu';
import {
  vec3, vec4, float,
  uniform as tslUniform,
  positionWorld, materialColor,
  smoothstep as tslSmoothstep, mix, max,
  fwidth, Fn, Discard,
} from 'three/tsl';
import { GrassSurface, GrassSurfaceOptions } from './grassSurface';

export type TargetShaderMaterialOptions = {
  gimmeDistances: number[],
  ringWidth?: number,
  puttingEnabled?: boolean,
  surfaceOptions?: GrassSurfaceOptions,
};

// --- TSL helper: anti-aliased ring outline ---
const ringOutline = Fn(([dist, radius, width]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {

  const hw = width.mul(0.5);
  const fw = fwidth(dist);
  const edge = max(fw, float(0.01));
  const inner = tslSmoothstep(radius.sub(hw).sub(edge), radius.sub(hw).add(edge), dist);
  const outer = float(1.0).sub(
    tslSmoothstep(radius.add(hw).sub(edge), radius.add(hw).add(edge), dist)
  );
  return inner.mul(outer);
});

// --- TSL helper: anti-aliased zone fill between two radii ---
const zoneFill = Fn(([dist, lo, hi]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const fw = fwidth(dist);
  const edge = max(fw, float(0.01));
  const inner = tslSmoothstep(lo.sub(edge), lo.add(edge), dist);
  const outer = float(1.0).sub(
    tslSmoothstep(hi.sub(edge), hi.add(edge), dist)
  );
  return inner.mul(outer);
});

export class TargetShaderMaterial {
  holeWorldPos: THREE.Vector3;
  ringSizes: THREE.Vector3;
  currentActive: THREE.Vector3;
  lerpSpeed = 4.0;
  holePosUniform: any;
  ringActiveUniform: any;
  visibleUniform: UniformNode<'float', number>;
  glowIntensityUniform: any;

  material?: MeshStandardNodeMaterial;

  constructor(object: THREE.Object3D, holeWorldPos: THREE.Vector3, options: TargetShaderMaterialOptions) {
    this.holeWorldPos = holeWorldPos;
    this.currentActive = new THREE.Vector3(0, 0, 0);

    const [inner, middle, outer] = options.gimmeDistances;
    const ringWidth = options.ringWidth ?? 0.05;
    this.ringSizes = new THREE.Vector3(inner, middle, outer);

    // Dynamic uniforms (updated at runtime)
    this.holePosUniform = tslUniform(new THREE.Vector3(holeWorldPos.x, 0, holeWorldPos.z));
    this.ringActiveUniform = tslUniform(new THREE.Vector3(0, 0, 0));
    this.visibleUniform = tslUniform(1.0); // 0 = hidden, 1 = shown
    // this.glowIntensityUniform = tslUniform(1.5); // > 1.0 so bloom picks it up
    const glowIntensity = float(3.0); // baked into the shader

    // Static values
    const holeRadius = float(0.054);
    const ringRadii = vec3(inner, middle, outer);
    const ringW = float(ringWidth);
    const activeColor = new THREE.Color('#ffd900');
    const inactiveColor = new THREE.Color('#ffffff');
    const activeColorRGB = vec3(...activeColor.toArray());
    const activeColorA = float(0.01);
    const inactiveColorRGB = vec3(...inactiveColor.toArray());
    const inactiveColorA = float(0.8);

    if (object instanceof THREE.Mesh) {
      const origMat = object.material as THREE.MeshStandardMaterial;

      // const mat = new MeshStandardNodeMaterial({
      //   // alphaToCoverage: true,
      // });

      // // Copy properties from the original GLTF material
      // if (origMat.color) mat.color = origMat.color.clone();
      // if (origMat.map) mat.map = origMat.map;
      // if (origMat.normalMap) mat.normalMap = origMat.normalMap;
      // mat.roughness = origMat.roughness ?? 1.0;
      // mat.metalness = origMat.metalness ?? 0.0;
      // if (origMat.roughnessMap) mat.roughnessMap = origMat.roughnessMap;
      // if (origMat.metalnessMap) mat.metalnessMap = origMat.metalnessMap;
      // // if (origMat.emissive) mat.emissive = origMat.emissive.clone();
      // // if (origMat.emissiveMap) mat.emissiveMap = origMat.emissiveMap;
      // // mat.emissiveIntensity = origMat.emissiveIntensity ?? 1.0;
      // if (origMat.aoMap) mat.aoMap = origMat.aoMap;
      // mat.aoMapIntensity = origMat.aoMapIntensity ?? 1.0;
      // mat.envMapIntensity = origMat.envMapIntensity ?? 1.0;
      // if (origMat.lightMap) mat.lightMap = origMat.lightMap;
      // mat.lightMapIntensity = origMat.lightMapIntensity ?? 1.0;
      // mat.side = origMat.side;
      // mat.toneMapped = origMat.toneMapped;
      // if (origMat.normalScale) mat.normalScale = origMat.normalScale.clone();

      // Turf base: fade/discolor/terrain shading from the shared green preset
      const mat = new GrassSurface(origMat, options.surfaceOptions ?? {});
      // --- Distance from fragment to hole (XZ plane) ---
      const dist: any = positionWorld.xz.sub(this.holePosUniform.xz).length();

      // --- Hole mask: fade to transparent inside the hole ---
      const g = fwidth(dist).clamp(0.0008, 0.02);
      const holeMask = tslSmoothstep(holeRadius.sub(g), holeRadius.add(g), dist);
      // Discard(holeMask.lessThan(1));

      // --- Ring 1 (inner: 0 → ringRadii.x) ---
      const outline1 = ringOutline(dist, ringRadii.x, ringW);
      const fill1 = zoneFill(dist, float(0), ringRadii.x);

      // --- Ring 2 (middle: ringRadii.x → ringRadii.y) ---
      const outline2 = ringOutline(dist, ringRadii.y, ringW);
      const fill2 = zoneFill(dist, ringRadii.x, ringRadii.y);

      // --- Ring 3 (outer: ringRadii.y → ringRadii.z) ---
      const outline3 = ringOutline(dist, ringRadii.z, ringW);
      const fill3 = zoneFill(dist, ringRadii.y, ringRadii.z);

      // --- Composite rings onto the base color ---
      // Start with the material's base color (includes .color * .map)
      // let color: any = materialColor;
      // Start from the turf shader's output instead of the raw material color
      let color: any = mat.colorNode;
      
      // // White outlines — always visible
      // color = mix(color, inactiveColorRGB, outline1.mul(inactiveColorA));
      // color = mix(color, inactiveColorRGB, outline2.mul(inactiveColorA));
      // color = mix(color, inactiveColorRGB, outline3.mul(inactiveColorA));
      // White outlines — only on the active hole
      const vis = this.visibleUniform;
      color = mix(color, inactiveColorRGB, outline1.mul(inactiveColorA).mul(vis));
      color = mix(color, inactiveColorRGB, outline2.mul(inactiveColorA).mul(vis));
      color = mix(color, inactiveColorRGB, outline3.mul(inactiveColorA).mul(vis));

      // Yellow fill — fades in/out with ringActive
      const active = this.ringActiveUniform;

      const mask1: any = float(fill1).mul(activeColorA).mul(active.x);
      const mask2: any = float(fill2).mul(activeColorA).mul(active.y);
      const mask3: any = float(fill3).mul(activeColorA).mul(active.z);
      color = mix(color, activeColorRGB, mask1);
      color = mix(color, activeColorRGB, mask2);
      color = mix(color, activeColorRGB, mask3);

      // --- Emissive glow for the active ring (HDR, drives bloom) ---
      const glow1 = float(fill1).mul(active.x);
      const glow2 = float(fill2).mul(active.y);
      const glow3 = float(fill3).mul(active.z);

      const outlineGlow = float(outline1).mul(active.x)
        .add(float(outline2).mul(active.y))
        .add(float(outline3).mul(active.z));

      const glowMask = glow1.add(glow2).add(glow3)
        .mul(0.04)                    // soft fill glow
        .add(outlineGlow)            // bright ring edge
        .clamp(0.0, 1.0);

      mat.emissiveNode = activeColorRGB.mul(glowMask.mul(glowIntensity).mul(vis));
      
      // Discard must live inside an Fn() that is wired into the
      // material, otherwise the statement never enters the node graph.
      const finalColor = color;
      mat.colorNode = Fn(() => {
        Discard(holeMask.lessThan(0.5));
        return vec4(finalColor.rgb, 1.0);
      })();
      mat.transparent = false;

      mat.needsUpdate = true;
      object.material = mat;
      this.material = mat;
    }
  }

  setPosition(position: THREE.Vector3) {
    this.holePosUniform.value.set(position.x, 0, position.z);
  }

  dispose() {
    if (this.material) {
      this.material.dispose();
      this.material = undefined;
    }
  }

  update(golfBall: GolfBall, dt: number) {
    if (!golfBall.object) {
      console.warn('No golfball object!');
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

    const t = 1.0 - Math.exp(-this.lerpSpeed * dt);
    this.currentActive.lerp(target, t);
    this.ringActiveUniform.value.copy(this.currentActive);
  }

  setVisible(visible: boolean) {
    this.visibleUniform.value = visible ? 1.0 : 0.0;
    if (!visible) {
      this.currentActive.set(0, 0, 0);
      this.ringActiveUniform.value.set(0, 0, 0);
    }
  }
}
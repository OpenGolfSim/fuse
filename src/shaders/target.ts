import { GolfBall } from '@/objects/golfBall';
import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  vec4, float,
  uniform as tslUniform,
  positionWorld,
  smoothstep as tslSmoothstep,
  fwidth, Fn, Discard,
} from 'three/tsl';
import { GrassSurface, GrassSurfaceOptions } from './grassSurface';
import { GimmeRings } from './gimmeRings';

export type TargetShaderMaterialOptions = {
  gimmeDistances: number[],
  ringWidth?: number,
  puttingEnabled?: boolean,
  surfaceOptions?: GrassSurfaceOptions,
};


export class TargetShaderMaterial {
  holeWorldPos: THREE.Vector3;
  holePosUniform: any;
  rings: GimmeRings;
  material?: MeshStandardNodeMaterial;

  constructor(object: THREE.Object3D, holeWorldPos: THREE.Vector3, options: TargetShaderMaterialOptions) {
    this.holeWorldPos = holeWorldPos;
    this.rings = new GimmeRings(options.gimmeDistances, options.ringWidth);

    // Dynamic uniforms (updated at runtime)
    this.holePosUniform = tslUniform(new THREE.Vector3(holeWorldPos.x, 0, holeWorldPos.z));

    // Static values
    const holeRadius = float(0.054);

    if (object instanceof THREE.Mesh) {
      const origMat = object.material as THREE.MeshStandardMaterial;

      // Turf base: fade/discolor/terrain shading from the shared green preset
      const mat = new GrassSurface(origMat, options.surfaceOptions ?? {});

      // --- Distance from fragment to hole (XZ plane) ---
      const dist: any = positionWorld.xz.sub(this.holePosUniform.xz).length();

      // --- Hole mask: fade to transparent inside the hole ---
      const g = fwidth(dist).clamp(0.0008, 0.02);
      const holeMask = tslSmoothstep(holeRadius.sub(g), holeRadius.add(g), dist);

      // --- Gimme rings over the turf color ---
      const { color, emissive } = this.rings.build(mat.surfaceColor, dist);
      mat.emissiveNode = emissive;
      
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
    this.rings.update(golfBall, this.holePosUniform.value, dt);
  }

  setVisible(visible: boolean) {
    this.rings.setVisible(visible);
  }
}
import * as THREE from 'three/webgpu';
import { EXRLoader } from 'three/examples/jsm/Addons.js';

export interface SkyBoxOptions {
  rotation?: number;   // degrees
  environmentIntensity?: number;
  backgroundIntensity?: number;  // visible sky brightness; independent of lighting
}

export class SkyBox {
  exrLoader: EXRLoader;
  texture: THREE.DataTexture | null = null;
  private scene: THREE.Scene | null = null;

  constructor() {
    this.exrLoader = new EXRLoader();
    this.exrLoader.setDataType(THREE.HalfFloatType);
  }

  async load(scene: THREE.Scene, exrBuffer: ArrayBuffer, options: SkyBoxOptions = {}) {
    this.dispose();
    this.scene = scene;

    const texture = this.exrLoader.createDataTexture(exrBuffer);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    this.texture = texture;

    // Screen-space background: immune to camera near/far, no mesh, no depth.
    scene.background = texture;
    scene.environment = texture;

    this.setRotation(options.rotation ?? 0);
    this.setEnvironmentIntensity(options.environmentIntensity ?? 0.15);
    this.setBackgroundIntensity(options.backgroundIntensity ?? 1);
  }

  // Cheap per-keystroke updates — property writes only
  setRotation(degrees: number) {
    if (!this.scene) return;
    const rad = THREE.MathUtils.degToRad(degrees);
    this.scene.environmentRotation.y = rad;
    this.scene.backgroundRotation.y = rad;
  }

  setEnvironmentIntensity(intensity: number) {
    if (!this.scene) return;
    this.scene.environmentIntensity = intensity;
  }

  setBackgroundIntensity(intensity: number) {
    if (!this.scene) return;
    this.scene.backgroundIntensity = intensity;
  }

  dispose() {
    if (this.scene) {
      if (this.scene.background === this.texture) this.scene.background = null;
      if (this.scene.environment === this.texture) this.scene.environment = null;
    }
    this.texture?.dispose();
    this.texture = null;
    this.scene = null;
  }
}
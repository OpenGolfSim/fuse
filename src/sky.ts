import * as THREE from 'three/webgpu';
import { texture as textureNode, equirectUV, positionWorldDirection, normalize, uniform, cos, sin, vec3 } from 'three/tsl';
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
  private uRotation = uniform(0);           // radians
  private uBackgroundIntensity = uniform(1);

  constructor() {
    this.exrLoader = new EXRLoader();
    this.exrLoader.setDataType(THREE.HalfFloatType);
  }

  async load(scene: THREE.Scene, exrBuffer: ArrayBuffer, options: SkyBoxOptions = {}) {
    this.dispose();
    this.scene = scene;

    const texture = this.exrLoader.createDataTexture(exrBuffer);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.texture = texture;

    // Screen-space background: immune to camera near/far, no mesh, no depth.
    // scene.background = texture;
    // Direct equirect sampling — bypasses WebGPU's PMREM-backed background path,
    // which prefilters to low res and blurs the sky.
    // const d = normalize(normalWorld);
    const d = normalize(positionWorldDirection);
    const rx = d.x.mul(cos(this.uRotation)).sub(d.z.mul(sin(this.uRotation)));
    const rz = d.x.mul(sin(this.uRotation)).add(d.z.mul(cos(this.uRotation)));
    // scene.backgroundNode = textureNode(texture, equirectUV(normalize(vec3(rx, d.y.negate(), rz))))
    scene.backgroundNode = textureNode(texture, equirectUV(normalize(vec3(rx, d.y, rz))))

      .mul(this.uBackgroundIntensity);

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
    // this.scene.backgroundRotation.y = rad;
    this.uRotation.value = rad;   // backgroundRotation doesn't apply to a custom node

  }

  setEnvironmentIntensity(intensity: number) {
    if (!this.scene) return;
    this.scene.environmentIntensity = intensity;
  }

  setBackgroundIntensity(intensity: number) {
    if (!this.scene) return;
    // this.scene.backgroundIntensity = intensity;
    this.uBackgroundIntensity.value = intensity;
  }

  dispose() {
    if (this.scene) {
      this.scene.backgroundNode = null;
      if (this.scene.background === this.texture) this.scene.background = null;
      if (this.scene.environment === this.texture) this.scene.environment = null;
    }
    this.texture?.dispose();
    this.texture = null;
    this.scene = null;
  }
}
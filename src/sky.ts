import * as THREE from 'three/webgpu';
import { pmremTexture, normalWorld, vec3 } from 'three/tsl';
import { EXRLoader } from 'three/examples/jsm/Addons.js';

export class SkyBox {
  exrLoader: EXRLoader;

  constructor() {
    this.exrLoader = new EXRLoader();
    this.exrLoader.setDataType(THREE.HalfFloatType);
  }

  async load(scene: THREE.Scene, exrBuffer: ArrayBuffer) {

    // const texture = this.exrLoader.parse(exrBuffer) as unknown as THREE.DataTexture;
    const texture = this.exrLoader.createDataTexture(exrBuffer);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    
    const skyScale = 0.5; // <1 zooms in on the sky, >1 zooms out
    scene.backgroundNode = pmremTexture(
      texture,
      normalWorld.mul(vec3(skyScale, -1, skyScale))
    );

    scene.environment = texture;
    scene.environmentIntensity = 0.1;
  }
}

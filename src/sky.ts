import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { PMREMGenerator } from 'three/webgpu';
import { EXRLoader } from 'three/examples/jsm/Addons.js';

// ============================================================
// SkyBox
// ============================================================

export class SkyBox {
  pmremGenerator: PMREMGenerator;
  exrLoader: EXRLoader;
  sky: THREE.Mesh | null;

  constructor(renderer: THREE.WebGPURenderer) {
    this.pmremGenerator = new PMREMGenerator(renderer);
    this.exrLoader = new EXRLoader();
    this.sky = null;
  }

  async load(scene: THREE.Scene, exrPath: string) {
    const texture = await this.exrLoader.loadAsync(exrPath);
    texture.mapping = THREE.EquirectangularReflectionMapping;

    const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    this.pmremGenerator.dispose();

    const skyGeo = new THREE.SphereGeometry(400, 60, 40);
    const skyMat = new MeshBasicNodeMaterial({
      map: texture,
      depthWrite: false,
      fog: false,
    });

    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.geometry.scale(-1, 1, 1);
    this.sky.scale.set(2, 1, 2);
    this.sky.position.set(0, 50, 0);
    this.sky.rotation.y = -0.5;

    return this.sky;
  }
}

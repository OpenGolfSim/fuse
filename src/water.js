import normals from './images/waternormals.jpg';

const defaultOptions = {
  speed: 0.3,
  offsetY: 0,
  waterOptions: {},
};
export class WaterSurface {
  constructor(waterObject, options = {}) {
    const { speed, waterOptions } = { ...defaultOptions, ...options };
    this.speed = speed;

    const textureLoader = new THREE.TextureLoader();
    const waterNormals = textureLoader.load(
      normals,
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    );

    this.water = new Water(waterObject.geometry.clone(), {
      textureWidth: 512,
      textureHeight: 512,
      alpha: 0.4,
      // sunColor: 0xfffbde,
      waterColor: 0x1071ad,
      distortionScale: 1.7,
      sunDirection: new THREE.Vector3(0, 2, 0.70707),
      waterNormals,
      ...waterOptions,
    });
    
    this.water.material.transparent = true;
    // this.water.rotation.x = -Math.PI / 2;
    // this.water.position.z = -50;

  }

  update() {
    if (this.water?.material) {
      this.water.material.uniforms['time'].value += this.speed / 60.0;
    }
  }
}
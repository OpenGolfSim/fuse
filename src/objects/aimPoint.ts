import * as THREE from 'three';

export class AimPoint {
  scaleFactor: number;
  opacity: number;
  mesh: THREE.Mesh;
  object: THREE.Group;

  constructor() {
    this.scaleFactor = 0.005;
    this.opacity = 0.6;
    const height = 4;
    const geometry = new THREE.ConeGeometry( 2, height, 16 );
    const color = new THREE.Color('rgb(255, 74, 68)');
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.opacity });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.z = 180 * (Math.PI / 180); // rotate 180
    this.mesh.position.y = (height / 2) + 1;
    this.mesh.name = 'AimPointMesh';
    
    this.object = new THREE.Group();
    this.object.layers.set(2);
    this.object.add(this.mesh);
    this.object.name = 'AimPointGroup';

  }

  update(aimPoint: THREE.Vector3, camera: THREE.Camera, isShotActive: boolean) {
    this.object.visible = !isShotActive;
    if (isShotActive) {
      return;
    }
    this.object.position.copy(aimPoint);

    const distance = camera.position.distanceTo(this.object.position);
    const desiredScale = distance * this.scaleFactor; // tweak this factor to taste
    this.object.scale.setScalar(desiredScale);
    

    const fadeStart = 50;
    const fadeEnd = 10;
    const opacity = THREE.MathUtils.clamp(
      (distance - fadeEnd) / (fadeStart - fadeEnd),
      0,
      1
    );
    //@ts-expect-error
    this.mesh.material.opacity = this.opacity * opacity;
  }
}
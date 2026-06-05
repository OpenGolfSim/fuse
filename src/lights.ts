import * as THREE from 'three';

export class CourseLight extends THREE.Group {
  ambient: THREE.AmbientLight;
  overhead: THREE.DirectionalLight;

  constructor(color: THREE.ColorRepresentation | undefined = 0xffffff) {
    super();
    // Bright warm ambient
    this.ambient = new THREE.AmbientLight(color, 0.8);
    this.add(this.ambient);
    
    // Main overhead light for shadows
    this.overhead = new THREE.DirectionalLight(color, 1.1);
    this.overhead.position.set(600, 300, 600);
    this.overhead.castShadow = true;
    this.overhead.shadow.mapSize.width = 2048; // Higher = crisper shadows
    this.overhead.shadow.mapSize.height = 2048;
    this.overhead.shadow.camera.near = 1;
    // Adjust these to match the size of your scene
    this.overhead.shadow.camera.far = 700;
    this.overhead.shadow.camera.left = -500;
    this.overhead.shadow.camera.right = 500;
    this.overhead.shadow.camera.top = 500;
    this.overhead.shadow.camera.bottom = -500;

    // center of world
    this.overhead.target.position.set(500, 0, 500);

    this.add(this.overhead.target);
    this.add(this.overhead);
  }
}
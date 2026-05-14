export class CourseLight {
  constructor(color = 0xfcfbf5) {

    this.group = new THREE.Group();
    // Bright warm ambient
    this.ambient = new THREE.AmbientLight(color, 1.0);
    this.group.add(this.ambient);
    
    // Main overhead light for shadows
    this.overhead = new THREE.DirectionalLight(color, 1.0);
    this.overhead.position.set(600, 200, 600);
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

    this.group.add(this.overhead.target);
    this.group.add(this.overhead);
    return this.group;
  }
}
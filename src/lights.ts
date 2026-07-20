import * as THREE from 'three';
import { QualityMode } from '@/utils/quality';

export type CourseLightOptions = {
  color?: THREE.ColorRepresentation | undefined,
  qualityLevel?: QualityMode,
  ambient?: {
    enabled?: boolean,
    intensity?: number
  },
  directional?: {
    enabled?: boolean,
    intensity?: number
  }
}
export class CourseLight extends THREE.Group {
  ambient?: THREE.AmbientLight;
  overhead?: THREE.DirectionalLight;

  constructor(options: CourseLightOptions = {}) {
    super();
    const color = options.color ?? new THREE.Color('#ffffee');
    
    const ambientEnabled = options.ambient?.enabled !== false;
    const ambientIntensity = options.ambient?.intensity ?? 0.9;
    if (ambientEnabled) {
      // Bright warm ambient
      this.ambient = new THREE.AmbientLight(color, ambientIntensity);
      this.add(this.ambient);
    }

    const directionalEnabled = options.directional?.enabled !== false;
    const directionalIntensity = options.directional?.intensity ?? 1.1;
    if (directionalEnabled) {
      // Main overhead light for shadows
      this.overhead = new THREE.DirectionalLight(color, directionalIntensity);
      this.overhead.position.set(600, 300, 600);
      this.overhead.castShadow = true;
      
      let shadowMapSize = 256;
      if (options.qualityLevel === QualityMode.Medium) {
        shadowMapSize = 2048;
      } else if (options.qualityLevel === QualityMode.High) {
        shadowMapSize = 4096;
      }
      this.overhead.shadow.mapSize.width = shadowMapSize; // Higher = crisper shadows
      this.overhead.shadow.mapSize.height = shadowMapSize;
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
}
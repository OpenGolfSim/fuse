import * as THREE from 'three';
import { QualityMode } from '@/utils/quality';
import { sunDirectionFromAngles, SunSettings } from '@/utils/sun';

export type CourseLightOptions = {
  color?: THREE.ColorRepresentation | undefined,
  qualityLevel?: QualityMode,
  sun?: SunSettings,
  worldSize?: number,

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
    console.log('light-options', options);
    const ambientEnabled = options.ambient?.enabled !== false;
    const ambientIntensity = options.ambient?.intensity ?? 0.35;
    if (ambientEnabled) {
      // Bright warm ambient
      this.ambient = new THREE.AmbientLight(color, ambientIntensity);
      this.add(this.ambient);
    }

    const directionalEnabled = options.directional?.enabled !== false;
    const directionalIntensity = options.directional?.intensity ?? 1.3;
    if (directionalEnabled) {
      // Main overhead light for shadows
      this.overhead = new THREE.DirectionalLight(color, directionalIntensity);
      // this.overhead.position.set(900, 300, 900);
      // this.overhead.castShadow = true;
      const center = (options.worldSize ?? 1000) / 2;
      // const dir = sunDirectionFromAngles(options.sun?.elevation, options.sun?.azimuth);
      const dir = new THREE.Vector3(...sunDirectionFromAngles(options.sun?.elevation, options.sun?.azimuth));

      // Directional lights only use position→target direction; distance is arbitrary
      this.overhead.target.position.set(center, 0, center);
      this.overhead.position.copy(this.overhead.target.position).addScaledVector(dir, -1000);
      this.overhead.castShadow = false; // shadows come from the baked lightmap      

      this.add(this.overhead.target);
      this.add(this.overhead);
    }
  }

}
import * as THREE from 'three';
import { WaterSurface, type WaterSurfaceOptions } from './';

export class LakeSurface extends WaterSurface {
  constructor(
    waterObject: THREE.Mesh,
    options: WaterSurfaceOptions = {}
  ) {
    super(waterObject, undefined, {
      speed: 0.25,
      flowStrength: 0.8,
      sideFlowStrength: 0.35,
      uvTiling: [6, 6],
      normalStrength: 0.8,
      shallowColor: new THREE.Color('#27383b'),
      deepColor: new THREE.Color('#050d0f'),
      depthRange: 5,
      roughness: 0.05,
      // shallowColor: new THREE.Color('#88ccbb'),
      // roughness: 0.8,
      opacity: 0.9,
      yOffset: 0,
      envMapIntensity: 0.1,
      ...options,
    });
  }
}